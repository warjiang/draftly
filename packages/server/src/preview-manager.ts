import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { DraftStore } from './drafts.js';
import type { Preview, PreviewEntry, PreviewManagerLike } from './types.js';

function reservePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port !== null) resolve(port);
        else reject(new Error('failed to reserve preview port'));
      });
    });
  });
}

function requestReady(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      const status = response.statusCode ?? 500;
      resolve(status >= 200 && status < 500);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitUntilReady(
  url: string,
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  output: () => string,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Vite preview exited before it was ready:\n${output()}`);
    }
    if (await requestReady(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite preview did not become ready within ${timeoutMs}ms:\n${output()}`);
}

export class PreviewManager implements PreviewManagerLike {
  drafts: DraftStore;
  host: string;
  maxProcesses: number;
  idleMs: number;
  startTimeoutMs: number;
  entries = new Map<string, PreviewEntry>();
  pending = new Map<string, Promise<Preview>>();
  starting = new Map<string, ChildProcessWithoutNullStreams>();
  closed = false;
  timer: NodeJS.Timeout;

  constructor({
    drafts,
    host = '127.0.0.1',
    maxProcesses = 4,
    idleMs = 15 * 60_000,
    startTimeoutMs = 20_000,
  }: {
    drafts: DraftStore;
    host?: string;
    maxProcesses?: number;
    idleMs?: number;
    startTimeoutMs?: number;
  }) {
    this.drafts = drafts;
    this.host = host;
    this.maxProcesses = maxProcesses;
    this.idleMs = idleMs;
    this.startTimeoutMs = startTimeoutMs;
    this.timer = setInterval(() => this.sweep(), Math.min(idleMs, 60_000));
    this.timer.unref();
  }

  async ensure(id: string): Promise<Preview> {
    if (this.closed) throw new Error('preview manager is shut down');
    await this.drafts.meta(id);
    const existing = this.entries.get(id);
    if (existing && existing.child.exitCode === null) {
      existing.lastUsed = Date.now();
      return this.publicEntry(existing);
    }
    if (this.pending.has(id)) return this.pending.get(id)!;
    const pending = this.start(id).finally(() => this.pending.delete(id));
    this.pending.set(id, pending);
    return pending;
  }

  async start(id: string): Promise<Preview> {
    await this.evictIfNeeded();
    const port = await reservePort(this.host);
    const url = `http://${this.host}:${port}/`;
    const child = spawn(
      'npm',
      [
        'run',
        'dev',
        '--',
        '--host',
        this.host,
        '--port',
        String(port),
        '--strictPort',
        '--base',
        `/api/previews/${encodeURIComponent(id)}/`,
      ],
      {
        cwd: this.drafts.projectDir(id),
        env: { ...process.env, BABEL_ENV: 'development' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    child.stdin.end();
    this.starting.set(id, child);
    let output = '';
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-20_000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const entry: PreviewEntry = {
      id,
      child,
      port,
      url,
      token: crypto.randomBytes(18).toString('base64url'),
      lastUsed: Date.now(),
      output: () => output,
    };
    child.once('exit', () => {
      if (this.entries.get(id)?.child === child) this.entries.delete(id);
    });

    try {
      await waitUntilReady(url, child, this.startTimeoutMs, entry.output);
      if (this.closed) {
        await this.terminate(child);
        throw new Error('preview manager is shut down');
      }
      this.entries.set(id, entry);
      return this.publicEntry(entry);
    } catch (error) {
      await this.terminate(child);
      throw error;
    } finally {
      if (this.starting.get(id) === child) this.starting.delete(id);
    }
  }

  publicEntry(entry: PreviewEntry): Preview {
    return {
      url: entry.url,
      token: entry.token,
      status: 'ready',
    };
  }

  async evictIfNeeded(): Promise<void> {
    if (this.entries.size < this.maxProcesses) return;
    const oldest = [...this.entries.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (oldest) await this.stop(oldest.id);
  }

  sweep(): void {
    const threshold = Date.now() - this.idleMs;
    for (const entry of this.entries.values()) {
      if (entry.lastUsed < threshold) this.stop(entry.id);
    }
  }

  async stop(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    await this.terminate(entry.child);
  }

  async terminate(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2_000);
      timeout.unref();
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    await Promise.all([...this.starting.values()].map((child) => this.terminate(child)));
    await Promise.all([...this.entries.keys()].map((id) => this.stop(id)));
    await Promise.allSettled([...this.pending.values()]);
  }
}
