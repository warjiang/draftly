import crypto from 'node:crypto';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { defaultDesignMd } from '../../shared/src/design-md.js';
import type { Database } from './db/client.js';
import {
  drafts,
  projectInvitations,
  projectMembers,
  projects,
  users,
  type ProjectRole,
} from './db/schema.js';
import { ProjectNotFoundError } from './projects.js';
import { requestAuth } from './request-context.js';
import type { ProjectDesign, ProjectMeta } from './types.js';

const roleRank: Record<ProjectRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

function defaultProjectDesign(): ProjectDesign {
  return {
    source: 'default',
    name: 'Draftly Default',
    templateId: null,
    content: defaultDesignMd(),
  };
}

function projectTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (!normalized) return '未命名项目';
  const firstSentence = normalized.split(/[。！？.!?\n]/)[0].trim() || normalized;
  const name = firstSentence.slice(0, 24).replace(/[，,、:：;；\-\s]+$/u, '').trim();
  return name || '未命名项目';
}

function toMeta(
  project: typeof projects.$inferSelect,
  draftIds: string[],
  role?: ProjectRole,
): ProjectMeta {
  return {
    id: project.id,
    title: project.title,
    prompt: project.prompt,
    design: {
      source: project.designSource,
      name: project.designName,
      templateId: project.designTemplateId,
      content: project.designContent,
    },
    draftIds,
    activeDraftId: project.activeDraftId,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    role,
  };
}

function forbidden(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 403 });
}

export class DatabaseProjectStore {
  readonly db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  async role(projectId: string, minimum: ProjectRole = 'viewer'): Promise<ProjectRole> {
    const userId = requestAuth().user.id;
    const [membership] = await this.db.select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership) throw new ProjectNotFoundError(projectId);
    if (roleRank[membership.role] < roleRank[minimum]) {
      throw forbidden(`${minimum} project role required`);
    }
    return membership.role;
  }

  async roleForDraft(draftId: string, minimum: ProjectRole = 'viewer'): Promise<{
    projectId: string;
    role: ProjectRole;
  }> {
    const [draft] = await this.db.select({ projectId: drafts.projectId })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .limit(1);
    if (!draft) throw new ProjectNotFoundError(draftId);
    return { projectId: draft.projectId, role: await this.role(draft.projectId, minimum) };
  }

  async list(): Promise<ProjectMeta[]> {
    const userId = requestAuth().user.id;
    const rows = await this.db.select({ project: projects, role: projectMembers.role })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(eq(projectMembers.userId, userId))
      .orderBy(desc(projects.updatedAt));
    if (!rows.length) return [];
    const projectIds = rows.map(({ project }) => project.id);
    const draftRows = await this.db.select({ id: drafts.id, projectId: drafts.projectId })
      .from(drafts)
      .where(inArray(drafts.projectId, projectIds));
    return rows.flatMap(({ project, role }) => {
      const draftIds = draftRows
        .filter((draft) => draft.projectId === project.id)
        .map((draft) => draft.id);
      return draftIds.length ? [toMeta(project, draftIds, role)] : [];
    });
  }

  async meta(id: unknown): Promise<ProjectMeta> {
    const projectId = String(id);
    const role = await this.role(projectId);
    const [project] = await this.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new ProjectNotFoundError(id);
    const draftRows = await this.db.select({ id: drafts.id })
      .from(drafts)
      .where(eq(drafts.projectId, projectId));
    return toMeta(project, draftRows.map((draft) => draft.id), role);
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
    const userId = requestAuth().user.id;
    const now = new Date();
    const project: typeof projects.$inferInsert = {
      id: `p-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      title: projectTitle(normalizedPrompt),
      prompt: normalizedPrompt,
      designSource: design.source,
      designName: design.name,
      designTemplateId: design.templateId,
      designContent: design.content,
      activeDraftId: null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.transaction(async (transaction) => {
      await transaction.insert(projects).values(project);
      await transaction.insert(projectMembers).values({
        projectId: project.id,
        userId,
        role: 'owner',
      });
    });
    return toMeta(project as typeof projects.$inferSelect, [], 'owner');
  }

  async addDrafts(id: unknown, draftIds: string[]): Promise<ProjectMeta> {
    const projectId = String(id);
    await this.role(projectId, 'editor');
    const project = await this.meta(projectId);
    const uniqueIds = [...new Set([...project.draftIds, ...draftIds])];
    const now = new Date();
    await this.db.update(projects).set({
      activeDraftId: project.activeDraftId || uniqueIds[0] || null,
      updatedAt: now,
    }).where(eq(projects.id, projectId));
    return { ...project, draftIds: uniqueIds, activeDraftId: project.activeDraftId || uniqueIds[0] || null, updatedAt: now.toISOString() };
  }

  async update(
    id: unknown,
    changes: { title?: string; activeDraftId?: string },
  ): Promise<ProjectMeta> {
    const projectId = String(id);
    await this.role(projectId, 'editor');
    const project = await this.meta(projectId);
    const update: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
    if (changes.title !== undefined) {
      const title = changes.title.replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!title) throw Object.assign(new Error('title required'), { status: 400 });
      update.title = title;
    }
    if (changes.activeDraftId !== undefined) {
      if (!project.draftIds.includes(changes.activeDraftId)) {
        throw Object.assign(new Error('activeDraftId must belong to project'), { status: 400 });
      }
      update.activeDraftId = changes.activeDraftId;
    }
    await this.db.update(projects).set(update).where(eq(projects.id, projectId));
    return this.meta(projectId);
  }

  async touchByDraft(draftId: string): Promise<void> {
    const { projectId } = await this.roleForDraft(draftId, 'editor');
    await this.db.update(projects).set({
      activeDraftId: draftId,
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));
  }

  async remove(id: unknown): Promise<void> {
    const projectId = String(id);
    await this.role(projectId, 'owner');
    await this.db.delete(projectInvitations).where(eq(projectInvitations.projectId, projectId));
    await this.db.delete(projects).where(eq(projects.id, projectId));
  }

  async members(projectId: string) {
    await this.role(projectId, 'owner');
    const members = await this.db.select({
      userId: projectMembers.userId,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
      name: users.name,
      githubLogin: users.githubLogin,
      image: users.image,
    }).from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, projectId));
    const invitations = await this.db.select().from(projectInvitations)
      .where(and(
        eq(projectInvitations.projectId, projectId),
        eq(projectInvitations.status, 'pending'),
      ))
      .orderBy(desc(projectInvitations.createdAt));
    return {
      members: members.map((member) => ({
        ...member,
        createdAt: member.createdAt.toISOString(),
      })),
      invitations: invitations.map((invitation) => ({
        ...invitation,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
        updatedAt: invitation.updatedAt.toISOString(),
        respondedAt: invitation.respondedAt?.toISOString() ?? null,
      })),
    };
  }

  async invite(projectId: string, githubLogin: string, role: ProjectRole) {
    await this.role(projectId, 'owner');
    if (role !== 'editor' && role !== 'viewer') {
      throw Object.assign(new Error('invitation role must be editor or viewer'), { status: 400 });
    }
    const login = normalizeGithubLogin(githubLogin);
    const [existingUser] = await this.db.select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.githubLogin}) = ${login}`)
      .limit(1);
    if (existingUser) {
      const [membership] = await this.db.select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, existingUser.id),
        ))
        .limit(1);
      if (membership) throw Object.assign(new Error('user is already a project member'), { status: 409 });
    }
    const now = new Date();
    const invitation = {
      id: crypto.randomUUID(),
      projectId,
      githubLogin: login,
      role,
      status: 'pending' as const,
      invitedBy: requestAuth().user.id,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.db.insert(projectInvitations).values(invitation);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
        throw Object.assign(new Error('a pending invitation already exists'), { status: 409 });
      }
      throw error;
    }
    return invitation;
  }

  async pendingInvitations() {
    const login = normalizeGithubLogin(requestAuth().user.githubLogin);
    const rows = await this.db.select({
      invitation: projectInvitations,
      projectTitle: projects.title,
      inviterName: users.name,
    }).from(projectInvitations)
      .innerJoin(projects, eq(projectInvitations.projectId, projects.id))
      .innerJoin(users, eq(projectInvitations.invitedBy, users.id))
      .where(and(
        sql`lower(${projectInvitations.githubLogin}) = ${login}`,
        eq(projectInvitations.status, 'pending'),
        gt(projectInvitations.expiresAt, new Date()),
      ))
      .orderBy(desc(projectInvitations.createdAt));
    return rows.map(({ invitation, projectTitle, inviterName }) => ({
      ...invitation,
      projectTitle,
      inviterName,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      updatedAt: invitation.updatedAt.toISOString(),
      respondedAt: invitation.respondedAt?.toISOString() ?? null,
    }));
  }

  async respondToInvitation(invitationId: string, response: 'accepted' | 'declined') {
    const user = requestAuth().user;
    return this.db.transaction(async (transaction) => {
      const [invitation] = await transaction.select().from(projectInvitations)
        .where(and(
          eq(projectInvitations.id, invitationId),
          eq(projectInvitations.status, 'pending'),
        ))
        .limit(1);
      if (
        !invitation
        || invitation.githubLogin.toLowerCase() !== user.githubLogin.toLowerCase()
      ) {
        throw new ProjectNotFoundError(invitationId);
      }
      if (invitation.expiresAt <= new Date()) {
        await transaction.update(projectInvitations).set({
          status: 'expired',
          updatedAt: new Date(),
        }).where(eq(projectInvitations.id, invitation.id));
        throw Object.assign(new Error('invitation expired'), { status: 410 });
      }
      const now = new Date();
      if (response === 'accepted') {
        await transaction.insert(projectMembers).values({
          projectId: invitation.projectId,
          userId: user.id,
          role: invitation.role,
        }).onConflictDoUpdate({
          target: [projectMembers.projectId, projectMembers.userId],
          set: { role: invitation.role, updatedAt: now },
        });
      }
      await transaction.update(projectInvitations).set({
        status: response,
        acceptedBy: response === 'accepted' ? user.id : null,
        respondedAt: now,
        updatedAt: now,
      }).where(eq(projectInvitations.id, invitation.id));
      return { projectId: invitation.projectId, status: response };
    });
  }

  async updateMember(projectId: string, userId: string, role: ProjectRole) {
    await this.role(projectId, 'owner');
    if (role !== 'editor' && role !== 'viewer') {
      throw Object.assign(new Error('member role must be editor or viewer'), { status: 400 });
    }
    const [target] = await this.db.select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!target) throw new ProjectNotFoundError(userId);
    if (target.role === 'owner') throw forbidden('project owner cannot be changed');
    await this.db.update(projectMembers).set({ role, updatedAt: new Date() })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    return { userId, role };
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    await this.role(projectId, 'owner');
    const [target] = await this.db.select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!target) throw new ProjectNotFoundError(userId);
    if (target.role === 'owner') throw forbidden('project owner cannot be removed');
    await this.db.delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  }

  async revokeInvitation(projectId: string, invitationId: string): Promise<void> {
    await this.role(projectId, 'owner');
    const result = await this.db.update(projectInvitations).set({
      status: 'revoked',
      respondedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(projectInvitations.id, invitationId),
      eq(projectInvitations.projectId, projectId),
      eq(projectInvitations.status, 'pending'),
    )).returning({ id: projectInvitations.id });
    if (!result.length) throw new ProjectNotFoundError(invitationId);
  }
}

function normalizeGithubLogin(value: unknown): string {
  const login = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(login)) {
    throw Object.assign(new Error('valid GitHub username required'), { status: 400 });
  }
  return login;
}
