import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { PiPublicEvent, PiTaskOptions, WorkspaceProvider } from "./types.js";

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

function publicPiEvent(event: RawPiEvent): PiPublicEvent {
  const result: PiPublicEvent = { type: event.type };
  if (event.message?.role) result.role = event.message.role;
  if (event.toolName) result.toolName = event.toolName;
  if (event.toolCallId) result.toolCallId = event.toolCallId;
  if (event.isError !== undefined) result.isError = Boolean(event.isError);
  if (event.assistantMessageEvent?.type) {
    result.assistantMessageEvent = {
      type: event.assistantMessageEvent.type,
      deltaLength: event.assistantMessageEvent.delta?.length || 0,
    };
  }
  return result;
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
        if (process.env.DRAFTLY_PI_PROVIDER) args.push('--provider', process.env.DRAFTLY_PI_PROVIDER);
        if (process.env.DRAFTLY_PI_MODEL) args.push('--model', process.env.DRAFTLY_PI_MODEL);
        if (process.env.DRAFTLY_PI_THINKING) args.push('--thinking', process.env.DRAFTLY_PI_THINKING);
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
}

export function createPiHarnessProvider(options?: { command?: string }): PiHarnessProvider {
  return new PiHarnessProvider(options);
}
