import { spawn } from 'node:child_process';
import type { CommandOptions, CommandResult } from './types.js';
import { errorWithStatus } from './types.js';

export function runCommand(command: string, args: string[], {
  cwd,
  env = process.env,
  input = null,
  onStdout,
  onStderr,
}: CommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onStdout?.(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onStderr?.(text);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0) {
        const detail = (stderr || stdout).trim();
        const error = errorWithStatus(new Error(
          `${command} ${args.join(' ')} failed (${signal || code})${detail ? `:\n${detail}` : ''}`,
        ));
        error.code = code ?? signal ?? undefined;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin.end(input ?? undefined);
  });
}
