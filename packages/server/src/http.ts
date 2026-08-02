import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { ZipArchive } from 'archiver';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { stream } from 'hono/streaming';
import { defaultDesignMd, parseDesignMd, validateDesignMd } from '../../shared/src/design-md.js';
import type { AuthService, AuthSession } from './auth.js';
import { isRecoverableSocketError } from './crash-guard.js';
import {
  applyDraftStyleEdits,
  editDraftByImage,
  editDraftSource,
  generateDrafts,
  iterateDraft,
} from './draft-generate.js';
import type { DraftStore } from './drafts.js';
import { ProjectStore } from './projects.js';
import { withRequestAuth } from './request-context.js';
import { extractDesign, fetchSiteAssets } from './extract.js';
import { PreviewManager } from './preview-manager.js';
import { assertNoEscapingSymlinks } from './source-locator.js';
import { getTemplate, loadTemplates, templateSummary } from './templates.js';
import type {
  ErrorWithStatus,
  PreviewManagerLike,
  ProgressHandler,
  ProjectDesign,
  ProjectMeta,
  SourceLocator,
  WorkspaceProvider,
} from './types.js';
import type { ProjectRole } from './db/schema.js';
import { errorWithStatus } from './types.js';

const EDITOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../editor/dist');
const MAX_BODY_SIZE = 10_000_000;

type JsonObject = Record<string, unknown>;

type Operation<T> = (onProgress?: ProgressHandler) => Promise<T>;

export type ApiAppOptions = {
  auth: AuthService;
  provider?: WorkspaceProvider;
  editorDir?: string;
  drafts: DraftStore;
  projects?: ProjectStoreLike;
  conversations?: ConversationStoreLike;
  previewManager?: PreviewManagerLike;
  readiness?: () => Promise<void>;
};

export interface ConversationStoreLike {
  list(draftId: string): Promise<unknown>;
  create(draftId: string, title?: string): Promise<unknown>;
  rename(draftId: string, conversationId: string, title: string): Promise<void>;
  remove(draftId: string, conversationId: string): Promise<void>;
  messages(draftId: string, conversationId: string): Promise<unknown>;
  appendMessage(
    draftId: string,
    conversationId: string,
    message: { role: string; data: Record<string, unknown> },
  ): Promise<unknown>;
}

export interface ProjectStoreLike {
  list(): Promise<ProjectMeta[]>;
  meta(id: unknown): Promise<ProjectMeta>;
  create(options: { prompt: string; design?: ProjectDesign }): Promise<ProjectMeta>;
  addDrafts(id: unknown, draftIds: string[]): Promise<ProjectMeta>;
  update(id: unknown, changes: { title?: string; activeDraftId?: string }): Promise<ProjectMeta>;
  touchByDraft(draftId: string): Promise<void>;
  remove(id: unknown): Promise<void>;
}

interface CollaborationStore extends ProjectStoreLike {
  members(projectId: string): Promise<unknown>;
  invite(projectId: string, githubLogin: string, role: ProjectRole): Promise<unknown>;
  pendingInvitations(): Promise<unknown>;
  respondToInvitation(id: string, response: 'accepted' | 'declined'): Promise<unknown>;
  updateMember(projectId: string, userId: string, role: ProjectRole): Promise<unknown>;
  removeMember(projectId: string, userId: string): Promise<void>;
  revokeInvitation(projectId: string, invitationId: string): Promise<void>;
}

export type ApiAppBundle = {
  app: Hono<AppEnv>;
  previewManager: PreviewManagerLike;
};

type AppEnv = {
  Variables: {
    auth: AuthSession;
  };
};

export function createApiApp({
  auth,
  provider,
  editorDir = EDITOR_DIR,
  drafts,
  projects = new ProjectStore({
    rootDir: path.resolve(drafts.rootDir, '../projects'),
    drafts,
  }),
  previewManager,
  readiness,
  conversations,
}: ApiAppOptions): ApiAppBundle {
  if (!drafts) throw new Error('createApiApp: drafts store required');
  if (!auth) throw new Error('createApiApp: auth service required');

  const previews = previewManager ?? new PreviewManager({ drafts });
  const app = new Hono<AppEnv>();

  app.use('/api/*', bodyLimit({
    maxSize: MAX_BODY_SIZE,
    onError: (c) => json(c, { error: 'body too large' }, 413),
  }));

  app.get('/api/health/live', (c) => json(c, { status: 'ok' }));
  app.get('/api/health/ready', async (c) => {
    if (!readiness) return json(c, { status: 'ok' });
    try {
      await readiness();
      return json(c, { status: 'ok' });
    } catch {
      return json(c, { status: 'unavailable' }, 503);
    }
  });

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  app.use('/api/*', async (c, next) => {
    if (
      c.req.path.startsWith('/api/auth/')
      || c.req.path === '/api/health/live'
      || c.req.path === '/api/health/ready'
      || c.req.path === '/api/templates'
      || c.req.path.startsWith('/api/templates/')
    ) {
      await next();
      return;
    }
    const session = await auth.getSession(c.req.raw.headers);
    if (!session) return json(c, { error: 'authentication required' }, 401);
    c.set('auth', session);
    await withRequestAuth(session, next);
  });

  app.get('/api/me', (c) => json(c, { user: c.get('auth').user }));

  app.get('/api/invitations', async (c) =>
    json(c, { invitations: await collaboration(projects).pendingInvitations() }));

  app.post('/api/invitations/:id/accept', async (c) =>
    json(c, await collaboration(projects).respondToInvitation(c.req.param('id'), 'accepted')));

  app.post('/api/invitations/:id/decline', async (c) =>
    json(c, await collaboration(projects).respondToInvitation(c.req.param('id'), 'declined')));

  app.get('/api/projects/:id/members', async (c) =>
    json(c, await collaboration(projects).members(c.req.param('id'))));

  app.post('/api/projects/:id/invitations', async (c) => {
    const input = await readJson<{ githubLogin?: string; role?: ProjectRole }>(c);
    if (!input.githubLogin) return json(c, { error: 'githubLogin required' }, 400);
    if (!input.role) return json(c, { error: 'role required' }, 400);
    return json(c, {
      invitation: await collaboration(projects).invite(
        c.req.param('id'),
        input.githubLogin,
        input.role,
      ),
    }, 201);
  });

  app.patch('/api/projects/:id/members/:userId', async (c) => {
    const input = await readJson<{ role?: ProjectRole }>(c);
    if (!input.role) return json(c, { error: 'role required' }, 400);
    return json(c, {
      member: await collaboration(projects).updateMember(
        c.req.param('id'),
        c.req.param('userId'),
        input.role,
      ),
    });
  });

  app.delete('/api/projects/:id/members/:userId', async (c) => {
    await collaboration(projects).removeMember(c.req.param('id'), c.req.param('userId'));
    return new Response(null, { status: 204 });
  });

  app.delete('/api/projects/:id/invitations/:invitationId', async (c) => {
    await collaboration(projects).revokeInvitation(
      c.req.param('id'),
      c.req.param('invitationId'),
    );
    return new Response(null, { status: 204 });
  });

  app.post('/api/drafts/generate', async (c) => {
    const input = await readJson<{
      prompt?: string;
      style?: string;
      variants?: string | number;
    }>(c);
    if (!input.prompt?.trim()) return json(c, { error: 'prompt required' }, 400);

    let design: ProjectDesign = {
      source: 'default',
      name: 'Draftly Default',
      templateId: null,
      content: defaultDesignMd(),
    };
    if (input.style) {
      const template = await getTemplate(String(input.style));
      if (!template) return json(c, { error: `unknown style: ${input.style}` }, 400);
      design = {
        source: 'template',
        name: template.name,
        templateId: template.id,
        content: template.designMd,
      };
    }

    const execute: Operation<Awaited<ReturnType<typeof generateDrafts>> & {
      project: ReturnType<typeof projectSummary>;
    }> = async (onProgress) => {
      const project = await projects.create({ prompt: input.prompt!, design });
      try {
        const generated = await generateDrafts({
          drafts,
          provider,
          prompt: input.prompt!,
          variants: input.variants,
          designMd: design.content,
          projectId: project.id,
          onProgress,
        });
        const saved = await projects.addDrafts(project.id, generated.drafts.map((draft) => draft.id));
        return { ...generated, project: projectSummary(saved) };
      } catch (error) {
        await projects.remove(project.id).catch(() => {});
        throw error;
      }
    };
    return isStreaming(c) ? streamResult(c, execute) : sendOperation(c, execute, 502);
  });

  app.get('/api/projects', async (c) => {
    const items = await projects.list();
    return json(c, {
      projects: items.map(projectSummary),
    });
  });

  app.get('/api/projects/:id', async (c) => {
    const project = await projects.meta(c.req.param('id'));
    const draftsById = await Promise.all(project.draftIds.map(async (id) => {
      try {
        return await drafts.meta(id);
      } catch {
        return null;
      }
    }));
    return json(c, {
      project: projectSummary(project),
      design: project.design,
      drafts: draftsById.filter((draft) => draft !== null),
    });
  });

  app.post('/api/projects/generate', async (c) => {
    const input = await readJson<{
      prompt?: string;
      variants?: string | number;
      templateId?: string;
      designMd?: string;
      designName?: string;
    }>(c);
    if (!input.prompt?.trim()) return json(c, { error: 'prompt required' }, 400);
    if (input.templateId && input.designMd) {
      return json(c, { error: 'choose templateId or designMd, not both' }, 400);
    }

    let design: ProjectDesign;
    if (input.templateId) {
      const template = await getTemplate(input.templateId);
      if (!template) return json(c, { error: `unknown template: ${input.templateId}` }, 400);
      design = {
        source: 'template',
        name: template.name,
        templateId: template.id,
        content: template.designMd,
      };
    } else if (input.designMd) {
      if (input.designMd.length > 200_000) {
        return json(c, { error: 'DESIGN.md is too large (maximum 200 KB)' }, 413);
      }
      const errors = validateDesignMd(input.designMd);
      if (errors.length) return json(c, { error: 'invalid DESIGN.md', errors }, 400);
      design = {
        source: 'import',
        name: String(input.designName || parseDesignMd(input.designMd).meta.name || 'Imported design').slice(0, 80),
        templateId: null,
        content: input.designMd,
      };
    } else {
      design = {
        source: 'default',
        name: 'Draftly Default',
        templateId: null,
        content: defaultDesignMd(),
      };
    }

    const execute: Operation<{
      project: ReturnType<typeof projectSummary>;
      drafts: Awaited<ReturnType<typeof generateDrafts>>['drafts'];
    }> = async (onProgress) => {
      const project = await projects.create({ prompt: input.prompt!, design });
      try {
        const generated = await generateDrafts({
          drafts,
          provider,
          prompt: input.prompt!,
          variants: input.variants,
          designMd: design.content,
          projectId: project.id,
          onProgress,
        });
        const saved = await projects.addDrafts(project.id, generated.drafts.map((draft) => draft.id));
        return { project: projectSummary(saved), drafts: generated.drafts };
      } catch (error) {
        await projects.remove(project.id).catch(() => {});
        throw error;
      }
    };
    return isStreaming(c) ? streamResult(c, execute) : sendOperation(c, execute, 502);
  });

  app.patch('/api/projects/:id', async (c) => {
    const input = await readJson<{ title?: string; activeDraftId?: string }>(c);
    if (input.title === undefined && input.activeDraftId === undefined) {
      return json(c, { error: 'title or activeDraftId required' }, 400);
    }
    const project = await projects.update(c.req.param('id'), input);
    return json(c, { project: projectSummary(project) });
  });

  app.get('/api/drafts', async (c) => json(c, { drafts: await drafts.list() }));

  app.get('/api/drafts/:id', async (c) => {
    const id = c.req.param('id');
    const meta = await drafts.meta(id);
    let source: Awaited<ReturnType<DraftStore['readSource']>> | null = null;
    const file = c.req.query('file');
    try {
      source = await drafts.readSource(id, file ?? 'src/App.tsx');
    } catch (error: unknown) {
      if (file !== undefined) throw error;
    }
    return json(c, {
      meta,
      version: meta.versions.length,
      source: source ? { file: source.file, content: source.source } : null,
    });
  });

  app.get('/api/drafts/:id/source', async (c) => {
    const version = c.req.query('v');
    return json(c, await drafts.readSource(
      c.req.param('id'),
      c.req.query('file') ?? 'src/App.tsx',
      version ? Number(version) : null,
    ));
  });

  app.get('/api/drafts/:id/files', async (c) =>
    json(c, await drafts.listSourceFiles(c.req.param('id'))));

  app.get('/api/drafts/:id/design', async (c) => {
    const content = await drafts.readDesign(c.req.param('id'));
    return json(c, {
      content,
      meta: content ? parseDesignMd(content).meta : null,
    });
  });

  app.post('/api/drafts/:id/preview', async (c) => {
    const id = c.req.param('id');
    const preview = await previews.ensure(id);
    return json(c, {
      ...preview,
      url: `/api/previews/${encodeURIComponent(id)}/`,
    });
  });

  app.all('/api/previews/:id/*', async (c) => {
    const id = c.req.param('id');
    await drafts.meta(id);
    const preview = await previews.ensure(id);
    const target = new URL(`${c.req.path}${new URL(c.req.url).search}`, preview.url);
    const headers = new Headers(c.req.raw.headers);
    headers.delete('host');
    headers.delete('cookie');
    let response: Response;
    try {
      response = await fetch(target, {
        method: c.req.method,
        headers,
        body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
        redirect: 'manual',
      });
    } catch (error) {
      if (!isRecoverableSocketError(error)) throw error;
      return json(c, { error: 'preview server is restarting, retry in a moment' }, 502);
    }
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-security-policy');
    responseHeaders.set('Cache-Control', 'no-store');
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  });

  app.post('/api/drafts/:id/iterate', async (c) => {
    const input = await readJson<{ instruction?: string }>(c);
    if (!input.instruction?.trim()) return json(c, { error: 'instruction required' }, 400);
    const execute: Operation<Awaited<ReturnType<typeof iterateDraft>>> = async (onProgress) => {
      const result = await iterateDraft({
        drafts,
        provider,
        id: c.req.param('id'),
        instruction: input.instruction!,
        onProgress,
      });
      await projects.touchByDraft(c.req.param('id'));
      return result;
    };
    return isStreaming(c) ? streamResult(c, execute) : sendOperation(c, execute, 502);
  });

  app.post('/api/drafts/:id/edit-source', async (c) => {
    const input = await readJson<{
      instruction?: string;
      locator?: SourceLocator;
      locators?: SourceLocator[];
    }>(c);
    const locatorList = input.locators?.length
      ? input.locators
      : input.locator
        ? [input.locator]
        : [];
    if (!locatorList.length) return json(c, { error: 'locator required' }, 400);
    const hasComments = locatorList.some((loc) => loc.comment?.trim());
    if (!input.instruction?.trim() && !hasComments) {
      return json(c, { error: 'instruction required' }, 400);
    }
    const execute: Operation<Awaited<ReturnType<typeof editDraftSource>>> = async (onProgress) => {
      const result = await editDraftSource({
        drafts,
        provider,
        id: c.req.param('id'),
        locators: locatorList,
        instruction: input.instruction ?? '',
        onProgress,
      });
      await projects.touchByDraft(c.req.param('id'));
      return result;
    };
    return isStreaming(c) ? streamResult(c, execute) : sendOperation(c, execute, 502);
  });

  app.post('/api/drafts/:id/apply-style', async (c) => {
    const input = await readJson<{
      edits?: Array<{
        file?: string;
        line?: number;
        column?: number;
        styles?: Record<string, string>;
      }>;
    }>(c);
    const edits = (input.edits ?? []).filter(
      (edit) =>
        edit &&
        typeof edit.file === 'string' &&
        Number.isInteger(edit.line) &&
        Number.isInteger(edit.column) &&
        edit.styles &&
        typeof edit.styles === 'object',
    ) as Array<{ file: string; line: number; column: number; styles: Record<string, string> }>;
    if (!edits.length) return json(c, { error: 'style edits required' }, 400);
    const execute: Operation<Awaited<ReturnType<typeof applyDraftStyleEdits>>> = async (
      onProgress,
    ) => {
      const result = await applyDraftStyleEdits({
        drafts,
        id: c.req.param('id'),
        edits,
        onProgress,
      });
      await projects.touchByDraft(c.req.param('id'));
      return result;
    };
    return isStreaming(c) ? streamResult(c, execute) : sendOperation(c, execute, 502);
  });

  app.post('/api/drafts/:id/edit-by-image', async (c) => {
    const input = await readJson<{ image?: string; instruction?: string }>(c);
    if (!input.image) return json(c, { error: 'image required' }, 400);
    if (!input.instruction?.trim()) return json(c, { error: 'instruction required' }, 400);
    const execute: Operation<Awaited<ReturnType<typeof editDraftByImage>>> = async (onProgress) => {
      const result = await editDraftByImage({
        drafts,
        provider,
        id: c.req.param('id'),
        image: input.image!,
        instruction: input.instruction!,
        onProgress,
      });
      await projects.touchByDraft(c.req.param('id'));
      return result;
    };
    return isStreaming(c) ? streamResult(c, execute) : sendOperation(c, execute, 502);
  });

  app.post('/api/drafts/:id/rollback', async (c) => {
    const input = await readJson<{ v?: string | number | null }>(c);
    if (input.v === undefined || input.v === null) {
      return json(c, { error: 'v required' }, 400);
    }
    const execute: Operation<{
      id: string;
      title: string;
      version: number;
    }> = async (onProgress) => {
      onProgress?.({ type: 'pipeline', stage: 'rollback_started', target: Number(input.v) });
      const result = await drafts.rollbackVersion(c.req.param('id'), input.v!);
      await projects.touchByDraft(c.req.param('id'));
      onProgress?.({ type: 'pipeline', stage: 'version_saved', version: result.version });
      return {
        id: result.meta.id,
        title: result.meta.title,
        version: result.version,
      };
    };
    return isStreaming(c) ? streamResult(c, execute) : sendOperation(c, execute);
  });

  app.get('/api/drafts/:id/versions/:version/diff', async (c) =>
    json(c, await drafts.versionDiff(c.req.param('id'), Number(c.req.param('version')))));

  app.get('/api/drafts/:id/export', (c) => exportSource(c, drafts, c.req.param('id')));

  const requireConversations = (c: Context<AppEnv>): ConversationStoreLike | Response => {
    if (!conversations) return json(c, { error: 'conversations are not available' }, 503);
    return conversations;
  };

  app.get('/api/drafts/:id/conversations', async (c) => {
    const store = requireConversations(c);
    if (store instanceof Response) return store;
    return json(c, { conversations: await store.list(c.req.param('id')) });
  });

  app.post('/api/drafts/:id/conversations', async (c) => {
    const store = requireConversations(c);
    if (store instanceof Response) return store;
    const input = await readJson<{ title?: string }>(c);
    return json(c, { conversation: await store.create(c.req.param('id'), input.title) });
  });

  app.patch('/api/drafts/:id/conversations/:cid', async (c) => {
    const store = requireConversations(c);
    if (store instanceof Response) return store;
    const input = await readJson<{ title?: string }>(c);
    if (!input.title?.trim()) return json(c, { error: 'title required' }, 400);
    await store.rename(c.req.param('id'), c.req.param('cid'), input.title);
    return json(c, { ok: true });
  });

  app.delete('/api/drafts/:id/conversations/:cid', async (c) => {
    const store = requireConversations(c);
    if (store instanceof Response) return store;
    await store.remove(c.req.param('id'), c.req.param('cid'));
    return json(c, { ok: true });
  });

  app.get('/api/drafts/:id/conversations/:cid/messages', async (c) => {
    const store = requireConversations(c);
    if (store instanceof Response) return store;
    return json(c, { messages: await store.messages(c.req.param('id'), c.req.param('cid')) });
  });

  app.post('/api/drafts/:id/conversations/:cid/messages', async (c) => {
    const store = requireConversations(c);
    if (store instanceof Response) return store;
    const input = await readJson<{ role?: string; data?: Record<string, unknown> }>(c);
    if (!input.role || !input.data || typeof input.data !== 'object') {
      return json(c, { error: 'role and data required' }, 400);
    }
    return json(c, {
      message: await store.appendMessage(c.req.param('id'), c.req.param('cid'), {
        role: input.role,
        data: input.data,
      }),
    });
  });

  app.get('/api/templates', async (c) =>
    json(c, { templates: (await loadTemplates()).map(templateSummary) }));

  app.get('/api/templates/:id', async (c) => {
    const id = c.req.param('id');
    const template = await getTemplate(id);
    if (!template) return json(c, { error: `unknown template: ${id}` }, 404);
    return json(c, {
      ...template,
      meta: parseDesignMd(template.designMd).meta,
    });
  });

  app.post('/api/designs/validate', async (c) => {
    const input = await readJson<{ content?: string }>(c);
    if (!input.content) return json(c, { error: 'content required' }, 400);
    if (input.content.length > 200_000) {
      return json(c, { error: 'DESIGN.md is too large (maximum 200 KB)' }, 413);
    }
    const errors = validateDesignMd(input.content);
    return json(c, {
      valid: errors.length === 0,
      errors,
      meta: errors.length ? null : parseDesignMd(input.content).meta,
    });
  });

  app.post('/api/extract', async (c) => {
    const input = await readJson<{
      url?: string;
      html?: string;
      css?: string | string[];
    }>(c);
    if (input.url) return json(c, extractDesign(await fetchSiteAssets(input.url)));
    const cssTexts = Array.isArray(input.css) ? input.css : input.css ? [input.css] : [];
    if (!input.html && !cssTexts.length) {
      return json(c, { error: 'required: { html, css } or { url }' }, 400);
    }

    return json(c, extractDesign({ html: input.html ?? '', cssTexts }));
  });

  app.all('/api/*', (c) =>
    json(c, { error: `unknown endpoint: ${c.req.method} ${new URL(c.req.url).pathname}` }, 404));

  app.use('*', async (c, next) => {
    c.header(
      'Cache-Control',
      c.req.path.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
    await next();
  });

  app.get('*', serveStatic({
    root: editorDir,
    rewriteRequestPath: (requestPath) => path.extname(requestPath) ? requestPath : '/index.html',
  }));

  app.notFound((c) => c.text('not found', 404));
  app.onError((error, c) => {
    const knownError = errorWithStatus(error);
    return json(c, { error: knownError.message }, knownError.status ?? 500);
  });

  return { app, previewManager: previews };
}

function projectSummary(project: ProjectMeta) {
  const meta = parseDesignMd(project.design.content).meta;
  return {
    id: project.id,
    title: project.title,
    prompt: project.prompt,
    design: {
      source: project.design.source,
      name: project.design.name,
      templateId: project.design.templateId,
      colors: meta.colors ?? {},
      typography: meta.typography ?? {},
    },
    draftIds: project.draftIds,
    activeDraftId: project.activeDraftId,
    variantCount: project.draftIds.length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    role: project.role,
  };
}

function collaboration(projects: ProjectStoreLike): CollaborationStore {
  if ('pendingInvitations' in projects) return projects as CollaborationStore;
  throw Object.assign(new Error('collaboration store unavailable'), { status: 501 });
}

async function readJson<T extends JsonObject>(c: Context<AppEnv>): Promise<T> {
  const body = await c.req.text();
  if (!body) return {} as T;
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('invalid JSON body');
    }
    return value as T;
  } catch {
    const error = new Error('invalid JSON body') as ErrorWithStatus;
    error.status = 400;
    throw error;
  }
}

function isStreaming(c: Context<AppEnv>): boolean {
  return c.req.query('stream') === '1';
}

function json(c: Context<AppEnv>, value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function sendOperation<T>(
  c: Context<AppEnv>,
  execute: Operation<T>,
  errorStatus = 500,
): Promise<Response> {
  try {
    return json(c, await execute());
  } catch (error: unknown) {
    const knownError = errorWithStatus(error);
    return json(c, { error: knownError.message }, knownError.status ?? errorStatus);
  }
}

function streamResult<T>(c: Context<AppEnv>, execute: Operation<T>): Response {
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  return stream(c, async (output) => {
    const send = (payload: unknown) => output.write(`${JSON.stringify(payload)}\n`);
    try {
      const result = await execute((event) => {
        void send({ type: 'progress', event });
      });
      await send({ type: 'result', data: result });
    } catch (error: unknown) {
      const knownError = errorWithStatus(error);
      await send({
        type: 'error',
        error: knownError.message,
        status: knownError.status ?? 500,
      });
    }
  });
}

async function exportSource(c: Context<AppEnv>, drafts: DraftStore, id: string): Promise<Response> {
  const meta = await drafts.meta(id);
  const version = meta.versions.length;
  const projectDir = drafts.projectDir(id);
  await assertNoEscapingSymlinks(projectDir);
  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', `attachment; filename="draftly-${meta.id}-v${version}.zip"`);
  c.header('Cache-Control', 'no-store');

  return stream(c, async (output) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.glob('**/*', {
      cwd: projectDir,
      dot: true,
      ignore: [
        '.git',
        '.git/**',
        'node_modules',
        'node_modules/**',
        'dist',
        'dist/**',
        '.draftly-input',
        '.draftly-input/**',
        '**/*.tsbuildinfo',
      ],
    });
    const piping = output.pipe(
      Readable.toWeb(archive) as ReadableStream<Uint8Array<ArrayBuffer>>,
    );
    await archive.finalize();
    await piping;
  });
}
