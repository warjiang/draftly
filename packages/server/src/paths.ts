import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function resolveDraftsDir(
  configuredPath = process.env.DRAFTLY_DRAFTS_DIR || '.draftly/drafts',
): string {
  return path.resolve(PROJECT_ROOT, configuredPath);
}
