#!/usr/bin/env node
import { loadEnv } from './load-env.js';
import { migrateLegacyDrafts } from './migration.js';
import { resolveDraftsDir } from './paths.js';
import { createPiHarnessProvider } from './pi-harness.js';

loadEnv();

const rootDir = resolveDraftsDir();
const results = await migrateLegacyDrafts({
  rootDir,
  provider: createPiHarnessProvider(),
  onProgress(event) {
    if (event.type === 'pipeline') {
      process.stdout.write(`[${event.id}] ${event.stage}\n`);
    }
  },
});

for (const result of results) {
  if (result.status === 'migrated') {
    console.log(`✓ ${result.id}: migrated to React source`);
  } else if (result.status === 'skipped') {
    console.log(`- ${result.id}: already migrated`);
  } else {
    console.error(`✗ ${result.id}: ${result.error}`);
  }
}

const failures = results.filter((result) => result.status === 'failed').length;
console.log(`Migration complete: ${results.length - failures} succeeded/skipped, ${failures} failed.`);
if (failures) process.exitCode = 1;
