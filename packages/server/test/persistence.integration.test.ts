import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import type { AuthSession, AuthUser } from '../src/auth.js';
import { createDatabase } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { DatabaseProjectStore } from '../src/db-projects.js';
import { PersistentDraftStore } from '../src/persistent-drafts.js';
import { withRequestAuth } from '../src/request-context.js';
import type { ObjectMetadata, ObjectStore } from '../src/storage/object-store.js';
import { WorkspaceManager } from '../src/storage/workspace-manager.js';

const databaseUrl = process.env.DRAFTLY_TEST_DATABASE_URL;

class MemoryObjectStore implements ObjectStore {
  values = new Map<string, { body: Uint8Array; metadata: ObjectMetadata }>();

  async assertReady() {}
  async get(key: string) {
    const value = this.values.get(key);
    if (!value) throw new Error(`missing object: ${key}`);
    return value.body;
  }
  async put(key: string, body: Uint8Array, checksum: string) {
    const metadata = { key, etag: crypto.randomUUID(), checksum, size: body.byteLength };
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

function auth(user: AuthUser): AuthSession {
  return {
    user,
    session: {
      id: crypto.randomUUID(),
      userId: user.id,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

test('persists projects, roles, invitations, versions, and workspace snapshots', {
  skip: !databaseUrl,
}, async () => {
  const connection = createDatabase(databaseUrl!);
  const suffix = crypto.randomUUID().slice(0, 8);
  const owner: AuthUser = {
    id: `owner-${suffix}`,
    name: 'Owner',
    email: `owner-${suffix}@example.com`,
    emailVerified: true,
    image: null,
    githubLogin: `owner-${suffix}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const editor: AuthUser = {
    ...owner,
    id: `editor-${suffix}`,
    name: 'Editor',
    email: `editor-${suffix}@example.com`,
    githubLogin: `editor-${suffix}`,
  };
  const viewer: AuthUser = {
    ...owner,
    id: `viewer-${suffix}`,
    name: 'Viewer',
    email: `viewer-${suffix}@example.com`,
    githubLogin: `viewer-${suffix}`,
  };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftly-persistence-'));
  const objects = new MemoryObjectStore();
  const workspaces = new WorkspaceManager({ rootDir: path.join(root, 'workspaces'), objects });
  const projects = new DatabaseProjectStore(connection.db);
  const drafts = new PersistentDraftStore({
    rootDir: workspaces.rootDir,
    database: connection.db,
    sql: connection.client,
    workspaces,
    access: projects,
    installDependencies: false,
  });

  await connection.db.insert(users).values([owner, editor, viewer]);
  let projectId = '';
  let draftId = '';
  try {
    await withRequestAuth(auth(owner), async () => {
      const project = await projects.create({ prompt: 'Persistent project' });
      projectId = project.id;
      assert.deepEqual(await projects.list(), []);
      const draft = await drafts.createProject({ prompt: project.prompt, projectId });
      draftId = draft.id;
      await projects.addDrafts(projectId, [draft.id]);
      assert.equal((await projects.list()).length, 1);
      const saved = await drafts.runVersionTransaction(
        draft.id,
        { kind: 'iterate', instruction: 'persist this change' },
        async (cwd) => {
          await fs.appendFile(path.join(cwd, 'src', 'App.tsx'), '\n// persisted\n');
          return { summary: 'persisted' };
        },
      );
      assert.equal(saved.version, 1);
      await workspaces.remove(draft.id);
      assert.match((await drafts.readSource(draft.id)).source, /persisted/);

      await projects.invite(projectId, editor.githubLogin, 'editor');
      await projects.invite(projectId, viewer.githubLogin, 'viewer');
    });

    await withRequestAuth(auth(editor), async () => {
      const [invitation] = await projects.pendingInvitations();
      assert.equal(invitation.projectId, projectId);
      await projects.respondToInvitation(invitation.id, 'accepted');
      assert.equal((await projects.meta(projectId)).role, 'editor');
    });

    await withRequestAuth(auth(viewer), async () => {
      const [invitation] = await projects.pendingInvitations();
      await projects.respondToInvitation(invitation.id, 'accepted');
      assert.equal((await projects.meta(projectId)).role, 'viewer');
      assert.match((await drafts.readSource(draftId)).source, /persisted/);
      await assert.rejects(
        projects.update(projectId, { title: 'Viewer edit' }),
        (error: Error & { status?: number }) => error.status === 403,
      );
    });

    await withRequestAuth(auth(owner), async () => {
      const collaboration = await projects.members(projectId);
      assert.equal(collaboration.members.length, 3);
      await projects.remove(projectId);
    });
  } finally {
    await connection.db.delete(users).where(eq(users.id, owner.id));
    await connection.db.delete(users).where(eq(users.id, editor.id));
    await connection.db.delete(users).where(eq(users.id, viewer.id));
    await connection.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
