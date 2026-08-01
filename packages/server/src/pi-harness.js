import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function dataUrlToImage(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new Error("Pi harness received an invalid image data URL");
  const extension = match[1].split("/")[1].replace("jpeg", "jpg").replace(/[^a-zA-Z0-9]/g, "") || "png";
  return { buffer: Buffer.from(match[2].replace(/\s/g, ""), "base64"), extension };
}

function assistantText(message) {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("");
}

function publicPiEvent(event) {
  const result = { type: event.type };
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

function runPi({ command, args, input, cwd, onEvent }) {
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

    const consumeLine = (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
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
    child.on("error", (error) => {
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

export class PiHarnessProvider {
  constructor({
    command = process.env.DRAFTLY_PI_COMMAND || "pi",
  } = {}) {
    this.command = command;
  }

  async runTask({
      cwd,
      instruction,
      images = [],
      systemPrompt = '',
      onEvent,
    }) {
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
          const imagePath = path.join(tempDir, `image-${index + 1}.${image.extension}`);
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

export function createPiHarnessProvider(options) {
  return new PiHarnessProvider(options);
}
