import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  PI_THINKING_LEVELS,
  type PiModelInfo,
  type PiPublicEvent,
  type PiRunConfig,
  type PiTaskOptions,
  type WorkspaceProvider,
} from "./types.js";

type PiMessage = {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type RawPiEvent = {
  type: string;
  message?: PiMessage;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  args?: Record<string, unknown>;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
};

function dataUrlToImage(dataUrl: string): { buffer: Buffer; extension: string } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new Error("Pi harness received an invalid image data URL");
  const extension = match[1].split("/")[1].replace("jpeg", "jpg").replace(/[^a-zA-Z0-9]/g, "") || "png";
  return { buffer: Buffer.from(match[2].replace(/\s/g, ""), "base64"), extension };
}

function assistantText(message: PiMessage | undefined): string {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("");
}

function collapse(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function basename(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.split(/[/\\]/).filter(Boolean).pop() || text;
}

// Distill a tool call's arguments into a short, human-readable trace label so
// the UI can show *what* the agent did (e.g. which file, which command) rather
// than only how many times a tool ran.
function summarizeTool(toolName: string | undefined, args: Record<string, unknown> | undefined): string {
  if (!args || typeof args !== "object") return "";
  switch (toolName) {
    case "bash":
      return collapse(String(args.command ?? ""), 72);
    case "read":
    case "write":
    case "edit":
      return basename(args.file_path ?? args.path);
    case "find":
    case "grep":
      return collapse(String(args.pattern ?? args.query ?? ""), 48);
    case "ls":
      return basename(args.path) || ".";
    default:
      return "";
  }
}

function publicPiEvent(event: RawPiEvent): PiPublicEvent {
  const result: PiPublicEvent = { type: event.type };
  if (event.message?.role) result.role = event.message.role;
  if (event.toolName) result.toolName = event.toolName;
  if (event.toolCallId) result.toolCallId = event.toolCallId;
  if (event.isError !== undefined) result.isError = Boolean(event.isError);
  if (event.type === "tool_execution_start") {
    const summary = summarizeTool(event.toolName, event.args);
    if (summary) result.toolSummary = summary;
  }
  if (event.assistantMessageEvent?.type) {
    result.assistantMessageEvent = {
      type: event.assistantMessageEvent.type,
      deltaLength: event.assistantMessageEvent.delta?.length || 0,
    };
  }
  return result;
}

// A conservative allowlist for values forwarded to the pi CLI so a request
// body can never smuggle extra flags into the child process argv.
const SAFE_CLI_VALUE = /^[a-zA-Z0-9._\/:-]{1,120}$/;

function safeCliValue(value: unknown): string {
  const text = String(value ?? "").trim();
  return SAFE_CLI_VALUE.test(text) ? text : "";
}

function normalizeThinking(value: unknown): string {
  const text = String(value ?? "").trim().toLowerCase();
  return (PI_THINKING_LEVELS as readonly string[]).includes(text) ? text : "";
}

function envDefaults(): PiRunConfig {
  const defaults: PiRunConfig = {};
  const provider = safeCliValue(process.env.DRAFTLY_PI_PROVIDER);
  const model = safeCliValue(process.env.DRAFTLY_PI_MODEL);
  const thinking = normalizeThinking(process.env.DRAFTLY_PI_THINKING);
  if (provider) defaults.provider = provider;
  if (model) defaults.model = model;
  if (thinking) defaults.thinking = thinking;
  return defaults;
}

// Parse the whitespace-aligned table emitted by `pi --list-models`:
//   provider        model             context  max-out  thinking  images
//   kimi-coding     k3                262.1K   262.1K   yes       yes
function parseModelList(output: string): PiModelInfo[] {
  const models: PiModelInfo[] = [];
  for (const line of output.split("\n")) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 2) continue;
    const [provider, id] = columns;
    if (provider === "provider" && id === "model") continue;
    models.push({
      provider,
      id,
      thinking: columns[4] === "yes",
      images: columns[5] === "yes",
    });
  }
  return models;
}

function runPi({
  command,
  args,
  input,
  cwd,
  onEvent,
}: {
  command: string;
  args: string[];
  input: string;
  cwd: string;
  onEvent?: (event: PiPublicEvent) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let output = "";

    const consumeLine = (line: string) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line) as RawPiEvent;
      } catch {
        stdout += line;
        return;
      }
      onEvent?.(publicPiEvent(event));
      if (event.type === "message_end") {
        const text = assistantText(event.message);
        if (text) output = text;
      }
    };

    child.stdout.on("data", (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";
      for (const line of lines) consumeLine(line);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error(`Pi CLI not found: ${command}. Install @earendil-works/pi-coding-agent first.`));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      consumeLine(lineBuffer);
      if (code !== 0) {
        reject(new Error(`Pi generation failed (${code}): ${(stderr || stdout).trim() || "unknown error"}`));
        return;
      }
      const result = output.trim();
      if (!result) {
        reject(new Error("Pi generation returned empty output"));
        return;
      }
      resolve(result);
    });

    child.stdin.end(input);
  });
}

export class PiHarnessProvider implements WorkspaceProvider {
  command: string;

  constructor({
    command = process.env.DRAFTLY_PI_COMMAND || "pi",
  }: { command?: string } = {}) {
    this.command = command;
  }

  async runTask({
      cwd,
      instruction,
      images = [],
      systemPrompt = '',
      config = {},
      onEvent,
    }: PiTaskOptions): Promise<string> {
      const normalizedImages = images.map(dataUrlToImage);
      const tempDir = normalizedImages.length
        ? await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-pi-'))
        : null;
      try {
        const args = [
          '--mode', 'json',
          '--print',
          '--no-session',
          '--tools', 'read,edit,write,bash',
          '--no-context-files',
          '--no-extensions',
          '--no-skills',
          '--no-prompt-templates',
          '--no-approve',
        ];
        if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
        const defaults = envDefaults();
        const provider = safeCliValue(config.provider) || defaults.provider;
        const model = safeCliValue(config.model) || defaults.model;
        const thinking = normalizeThinking(config.thinking) || defaults.thinking;
        if (provider) args.push('--provider', provider);
        if (model) args.push('--model', model);
        if (thinking) args.push('--thinking', thinking);
        for (let index = 0; index < normalizedImages.length; index += 1) {
          const image = normalizedImages[index];
          const imagePath = path.join(tempDir!, `image-${index + 1}.${image.extension}`);
          await fs.writeFile(imagePath, image.buffer);
          args.push(`@${imagePath}`);
        }
        return await runPi({
          command: this.command,
          args,
          input: String(instruction || ''),
          cwd: path.resolve(cwd),
          onEvent,
        });
      } finally {
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  async listModels(): Promise<{ models: PiModelInfo[]; defaults: PiRunConfig }> {
    const defaults = envDefaults();
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(this.command, ['--list-models'], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(new Error(`Pi CLI not found: ${this.command}`));
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`pi --list-models failed (${code}): ${stderr.trim() || 'unknown error'}`));
          return;
        }
        resolve(stdout);
      });
    });
    return { models: parseModelList(output), defaults };
  }
}

export function createPiHarnessProvider(options?: { command?: string }): PiHarnessProvider {
  return new PiHarnessProvider(options);
}
