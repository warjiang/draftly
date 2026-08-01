#!/usr/bin/env node
import fs from 'node:fs';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { DraftStore } from './drafts.js';
import { createApiApp } from './http.js';
import { loadEnv } from './load-env.js';
import { resolveDraftsDir } from './paths.js';
import { resolveProjectsDir } from './paths.js';
import { createPiHarnessProvider } from './pi-harness.js';
import { ProjectStore } from './projects.js';
import { errorWithStatus } from './types.js';

loadEnv();

const host = process.env.HOST || '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '4173', 10);
const draftsDir = resolveDraftsDir();
const projectsDir = resolveProjectsDir();

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

fs.mkdirSync(draftsDir, { recursive: true });
fs.mkdirSync(projectsDir, { recursive: true });

const drafts = new DraftStore({ rootDir: draftsDir });
const projects = new ProjectStore({ rootDir: projectsDir, drafts });
const { app, previewManager } = createApiApp({
  provider: createPiHarnessProvider(),
  drafts,
  projects,
});
const server = serve({
  fetch: app.fetch,
  hostname: host,
  port,
}, (address) => {
  console.log(`draftly is running at http://${host}:${address.port}`);
  console.log(`Drafts directory: ${draftsDir}`);
  console.log(`Projects directory: ${projectsDir}`);
  console.log(`Pi harness: ${process.env.DRAFTLY_PI_COMMAND || 'pi'}${process.env.DRAFTLY_PI_MODEL ? ` (${process.env.DRAFTLY_PI_MODEL})` : ''}`);
}) as Server;

server.on('error', (error: unknown) => {
  const knownError = errorWithStatus(error);
  if (knownError.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Set another one with PORT=<port> npm run dev.`);
  } else {
    console.error(knownError);
  }
  process.exitCode = 1;
});

let closing = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`\n${signal} received, shutting down...`);
  await previewManager.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
