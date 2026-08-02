#!/usr/bin/env node
import fs from 'node:fs';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createAuthService } from './auth.js';
import { readConfig } from './config.js';
import { assertDatabaseReady, createDatabase } from './db/client.js';
import { DraftStore } from './drafts.js';
import { DatabaseProjectStore } from './db-projects.js';
import { createApiApp } from './http.js';
import { loadEnv } from './load-env.js';
import { resolveDraftsDir } from './paths.js';
import { resolveProjectsDir } from './paths.js';
import { createPiHarnessProvider } from './pi-harness.js';
import { ProjectStore } from './projects.js';
import { PersistentDraftStore } from './persistent-drafts.js';
import { S3ObjectStore } from './storage/s3-object-store.js';
import { WorkspaceManager } from './storage/workspace-manager.js';
import { errorWithStatus } from './types.js';

loadEnv();

const config = readConfig();
const host = config.host;
const port = config.port;
const database = createDatabase(config.databaseUrl);
await assertDatabaseReady(database.db);
const auth = createAuthService(database.db, config);

fs.mkdirSync(config.workspacesDir, { recursive: true });
const objects = new S3ObjectStore(config.s3);
await objects.assertReady();
const workspaces = new WorkspaceManager({ rootDir: config.workspacesDir, objects });
const projects = new DatabaseProjectStore(database.db);
const drafts = new PersistentDraftStore({
  rootDir: config.workspacesDir,
  database: database.db,
  sql: database.client,
  workspaces,
  access: projects,
  npmRegistry: config.npmRegistry,
});
const { app, previewManager } = createApiApp({
  auth,
  provider: createPiHarnessProvider(),
  drafts,
  projects,
  readiness: async () => {
    await assertDatabaseReady(database.db);
    await objects.assertReady();
  },
});
const server = serve({
  fetch: app.fetch,
  hostname: host,
  port,
}, (address) => {
  console.log(`draftly is running at http://${host}:${address.port}`);
  console.log(`Workspace cache: ${config.workspacesDir}`);
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
  await workspaces.cleanup();
  await database.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
