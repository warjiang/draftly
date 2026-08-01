import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultDesignMd, parseDesignMd } from '../../shared/src/design-md.js';
import type { DraftStore } from './drafts.js';
import type { ProjectDesign, ProjectMeta } from './types.js';
import { errorWithStatus } from './types.js';

const PROJECT_ID = /^[a-z0-9][a-z0-9-]*$/;

export class ProjectNotFoundError extends Error {
  status = 404;

  constructor(id: unknown) {
    super(`project not found: ${id}`);
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

function defaultProjectDesign(): ProjectDesign {
  return {
    source: 'default',
    name: 'Draftly Default',
    templateId: null,
    content: defaultDesignMd(),
  };
}

function projectTitle(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 40) || '未命名项目';
}

export class ProjectStore {
  rootDir: string;
  drafts: DraftStore;
  private migration: Promise<void> | null = null;

  constructor({ rootDir, drafts }: { rootDir: string; drafts: DraftStore }) {
    this.rootDir = path.resolve(rootDir);
    this.drafts = drafts;
  }

  private assertId(id: unknown): string {
    if (!PROJECT_ID.test(String(id))) throw new ProjectNotFoundError(id);
    return String(id);
  }

  private file(id: unknown): string {
    return path.join(this.rootDir, `${this.assertId(id)}.json`);
  }

  private async readExisting(id: unknown): Promise<ProjectMeta> {
    try {
      return JSON.parse(await fs.readFile(this.file(id), 'utf8')) as ProjectMeta;
    } catch (error: unknown) {
      const knownError = errorWithStatus(error);
      if (knownError.code === 'ENOENT') throw new ProjectNotFoundError(id);
      throw knownError;
    }
  }

  private async ensureLegacyProjects(): Promise<void> {
    if (!this.migration) {
      this.migration = this.migrateLegacyDrafts().catch((error) => {
        this.migration = null;
        throw error;
      });
    }
    await this.migration;
  }

  private async migrateLegacyDrafts(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    const drafts = await this.drafts.list();
    const existing = await this.listStored();
    const projects = new Map(existing.map((project) => [project.id, project]));
    const legacyIds = new Set(
      drafts.filter((draft) => draft.format !== 'vite-react').map((draft) => draft.id),
    );

    for (const project of existing) {
      const draftIds = project.draftIds.filter((id) => !legacyIds.has(id));
      if (draftIds.length === project.draftIds.length) continue;
      if (!draftIds.length) {
        await fs.rm(this.file(project.id), { force: true });
        projects.delete(project.id);
        continue;
      }
      const next = {
        ...project,
        draftIds,
        activeDraftId: draftIds.includes(project.activeDraftId || '')
          ? project.activeDraftId
          : draftIds[0],
      };
      projects.set(project.id, next);
      await writeJsonAtomic(this.file(project.id), next);
    }

    for (const draft of drafts) {
      if (draft.format !== 'vite-react') continue;
      const id = draft.projectId || `project-${draft.id}`;
      const project = projects.get(id);
      if (project) {
        if (!project.draftIds.includes(draft.id)) {
          project.draftIds.push(draft.id);
          project.activeDraftId ||= draft.id;
          project.updatedAt = [
            project.updatedAt,
            draft.versions.at(-1)?.at,
            draft.createdAt,
          ].filter(Boolean).sort().at(-1) || project.updatedAt;
          await writeJsonAtomic(this.file(id), project);
        }
      } else {
        const designContent = await this.drafts.readDesign(draft.id).catch(() => null);
        const createdAt = draft.createdAt || new Date().toISOString();
        const next: ProjectMeta = {
          id,
          title: draft.title || projectTitle(draft.prompt),
          prompt: draft.prompt || '',
          design: designContent ? {
            source: 'import',
            name: String(parseDesignMd(designContent).meta.name || 'Imported design'),
            templateId: null,
            content: designContent,
          } : defaultProjectDesign(),
          draftIds: [draft.id],
          activeDraftId: draft.id,
          createdAt,
          updatedAt: draft.versions.at(-1)?.at || createdAt,
        };
        projects.set(id, next);
        await writeJsonAtomic(this.file(id), next);
      }
      if (draft.projectId !== id) {
        await this.drafts.setProjectId(draft.id, id);
      }
    }
  }

  private async listStored(): Promise<ProjectMeta[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.rootDir);
    } catch (error: unknown) {
      const knownError = errorWithStatus(error);
      if (knownError.code === 'ENOENT') return [];
      throw knownError;
    }
    const projects: ProjectMeta[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (!PROJECT_ID.test(id)) continue;
      try {
        projects.push(JSON.parse(await fs.readFile(path.join(this.rootDir, name), 'utf8')) as ProjectMeta);
      } catch {
        // Ignore incomplete files left by interrupted external writes.
      }
    }
    return projects;
  }

  async list(): Promise<ProjectMeta[]> {
    await this.ensureLegacyProjects();
    return (await this.listStored()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async meta(id: unknown): Promise<ProjectMeta> {
    await this.ensureLegacyProjects();
    return this.readExisting(id);
  }

  async create({
    prompt,
    design = defaultProjectDesign(),
  }: {
    prompt: string;
    design?: ProjectDesign;
  }): Promise<ProjectMeta> {
    const normalizedPrompt = String(prompt || '').trim();
    if (!normalizedPrompt) throw new Error('prompt required');
    await this.ensureLegacyProjects();
    await fs.mkdir(this.rootDir, { recursive: true });
    const now = new Date().toISOString();
    const project: ProjectMeta = {
      id: `p-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      title: projectTitle(normalizedPrompt),
      prompt: normalizedPrompt,
      design,
      draftIds: [],
      activeDraftId: null,
      createdAt: now,
      updatedAt: now,
    };
    await writeJsonAtomic(this.file(project.id), project);
    return project;
  }

  async addDrafts(id: unknown, draftIds: string[]): Promise<ProjectMeta> {
    const project = await this.meta(id);
    const uniqueIds = [...new Set([...project.draftIds, ...draftIds])];
    for (const draftId of draftIds) await this.drafts.setProjectId(draftId, project.id);
    const next: ProjectMeta = {
      ...project,
      draftIds: uniqueIds,
      activeDraftId: project.activeDraftId || uniqueIds[0] || null,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(this.file(project.id), next);
    return next;
  }

  async update(
    id: unknown,
    changes: { title?: string; activeDraftId?: string },
  ): Promise<ProjectMeta> {
    const project = await this.meta(id);
    const next = { ...project };
    if (changes.title !== undefined) {
      const title = changes.title.replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!title) {
        const error = new Error('title required') as Error & { status?: number };
        error.status = 400;
        throw error;
      }
      next.title = title;
    }
    if (changes.activeDraftId !== undefined) {
      if (!project.draftIds.includes(changes.activeDraftId)) {
        const error = new Error('activeDraftId must belong to project') as Error & { status?: number };
        error.status = 400;
        throw error;
      }
      next.activeDraftId = changes.activeDraftId;
    }
    next.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.file(project.id), next);
    return next;
  }

  async touchByDraft(draftId: string): Promise<void> {
    const draft = await this.drafts.meta(draftId);
    if (!draft.projectId) return;
    await this.ensureLegacyProjects();
    const project = await this.readExisting(draft.projectId);
    await writeJsonAtomic(this.file(project.id), {
      ...project,
      activeDraftId: draftId,
      updatedAt: new Date().toISOString(),
    });
  }

  async remove(id: unknown): Promise<void> {
    await fs.rm(this.file(id), { force: true });
  }
}
