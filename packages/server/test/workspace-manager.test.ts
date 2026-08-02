import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import * as tar from 'tar';
import type { ObjectMetadata, ObjectStore } from '../src/storage/object-store.js';
import { WorkspaceManager } from '../src/storage/workspace-manager.js';

class MemoryObjectStore implements ObjectStore {
  values = new Map<string, { body: Uint8Array; metadata: ObjectMetadata }>();

  async assertReady() {}

  async get(key: string) {
    const value = this.values.get(key);
    if (!value) throw new Error(`missing object: ${key}`);
    return value.body;
  }

  async put(key: string, body: Uint8Array, checksum: string) {
    const metadata = { key, etag: `etag-${key}`, checksum, size: body.byteLength };
    this.values.set(key, { body: new Uint8Array(body), metadata });
    return metadata;
  }

  async delete(key: string) {
    this.values.delete(key);
  }

  async head(key: string) {
    return this.values.get(key)?.metadata ?? null;
  }
}

let root: string;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-workspaces-'));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('snapshots and restores a workspace without generated dependencies', async () => {
  const objects = new MemoryObjectStore();
  const manager = new WorkspaceManager({ rootDir: path.join(root, 'workspaces'), objects });
  const directory = await manager.createEmpty('draft-one');
  await fs.mkdir(path.join(directory, 'src'));
  await fs.mkdir(path.join(directory, 'node_modules'));
  await fs.writeFile(path.join(directory, 'src', 'App.tsx'), 'export default 1;\n');
  await fs.writeFile(path.join(directory, 'node_modules', 'ignored.js'), 'ignored');

  const saved = await manager.snapshot('draft-one', 'drafts/draft-one/one.tgz');
  await manager.remove('draft-one');
  const restored = await manager.ensure('draft-one', saved);

  assert.equal(await fs.readFile(path.join(restored, 'src', 'App.tsx'), 'utf8'), 'export default 1;\n');
  await assert.rejects(() => fs.access(path.join(restored, 'node_modules')));
  assert.equal((await objects.head(saved.key))?.checksum, saved.checksum);
});

test('rejects an archive containing path traversal', async () => {
  const objects = new MemoryObjectStore();
  const source = path.join(root, 'unsafe-source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'safe.txt'), 'safe');
  const archive = path.join(root, 'unsafe.tgz');
  await tar.c({ cwd: source, file: archive, gzip: true, prefix: '../escape' }, ['safe.txt']);
  const body = await fs.readFile(archive);
  const checksum = crypto.createHash('sha256').update(body).digest('hex');
  await objects.put('unsafe', body, checksum);
  const manager = new WorkspaceManager({ rootDir: path.join(root, 'unsafe-workspaces'), objects });

  await assert.rejects(
    () => manager.ensure('draft-unsafe', { key: 'unsafe', checksum }),
    /unsafe archive path/,
  );
});
