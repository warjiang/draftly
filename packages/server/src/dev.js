#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createProvider } from '../../shared/src/llm.js';
import { createApiServer } from './http.js';
import { SandboxManager } from './sandbox-manager.js';
import { DraftStore } from './drafts.js';
import { loadEnv } from './load-env.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '4173', 10);
const sandboxDir = path.resolve(process.env.DRAFTLY_SANDBOX_DIR || '.draftly/sandbox');

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

fs.mkdirSync(sandboxDir, { recursive: true });

// Load local .env (if present) before creating the LLM provider.
loadEnv();

const sandboxManager = new SandboxManager({ rootDir: sandboxDir });
const drafts = new DraftStore({ rootDir: path.resolve(sandboxDir, '..', 'drafts') });
const server = createApiServer({ sandboxManager, provider: createProvider(), drafts });

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Set another one with PORT=<port> npm run dev.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`draftly is running at http://${host}:${actualPort}`);
  console.log(`Sandbox directory: ${sandboxDir}`);
  if (!process.env.DRAFTLY_LLM_API_KEY || !process.env.DRAFTLY_LLM_BASE_URL) {
    console.log('LLM mode: offline mock (set DRAFTLY_LLM_BASE_URL and DRAFTLY_LLM_API_KEY for an OpenAI-compatible API)');
  }
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal} received, shutting down...`);
  await sandboxManager.sandbox().stop().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
