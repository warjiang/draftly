#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readConfig } from '../config.js';
import { loadEnv } from '../load-env.js';
import { createDatabase } from './client.js';

loadEnv();
const config = readConfig();
const connection = createDatabase(config.databaseUrl, { max: 1 });
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

try {
  await migrate(connection.db, { migrationsFolder });
  console.log('Database migrations completed.');
} finally {
  await connection.close();
}
