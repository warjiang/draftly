import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>['db'];

export function createDatabase(databaseUrl: string, options: { max?: number } = {}) {
  const client = postgres(databaseUrl, {
    max: options.max ?? 10,
    prepare: false,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    async close(): Promise<void> {
      await client.end();
    },
  };
}

export async function assertDatabaseReady(database: Database): Promise<void> {
  await database.execute('select 1');
}
