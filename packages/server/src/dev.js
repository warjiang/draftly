#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createApiServer } from './http.js';
import { DraftStore } from './drafts.js';
import { loadEnv } from './load-env.js';
import { createPiHarnessProvider } from './pi-harness.js';

// Load local .env before reading any server or Pi configuration.
loadEnv();

const host = process.env.HOST || '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '4173', 10);
const draftsDir = path.resolve(process.env.DRAFTLY_DRAFTS_DIR || '.draftly/drafts');

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

fs.mkdirSync(draftsDir, { recursive: true });

const drafts = new DraftStore({ rootDir: draftsDir });
const server = createApiServer({ provider: createPiHarnessProvider(), drafts });

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
  console.log(`Drafts directory: ${draftsDir}`);
  console.log(`Pi harness: ${process.env.DRAFTLY_PI_COMMAND || 'pi'}${process.env.DRAFTLY_PI_MODEL ? ` (${process.env.DRAFTLY_PI_MODEL})` : ''}`);
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal} received, shutting down...`);
  await server.previewManager?.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
