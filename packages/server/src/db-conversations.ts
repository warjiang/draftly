import crypto from 'node:crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from './db/client.js';
import { conversationMessages, conversations, type ProjectRole } from './db/schema.js';
import { requestAuth } from './request-context.js';

/** Minimal slice of the project store used to authorize by draft. */
export interface ConversationAccess {
  roleForDraft(
    draftId: string,
    minimum?: ProjectRole,
  ): Promise<{ projectId: string; role: ProjectRole }>;
}

export type ConversationSummary = {
  id: string;
  draftId: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessage = {
  id: string;
  seq: number;
  role: string;
  createdAt: string;
} & Record<string, unknown>;

function notFound(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 404 });
}

function defaultTitle(): string {
  return '新会话';
}

/** Server-persisted chat sessions ("会话") scoped to a draft. */
export class ConversationStore {
  db: Database;
  access: ConversationAccess;

  constructor(db: Database, access: ConversationAccess) {
    this.db = db;
    this.access = access;
  }

  private async assertConversation(draftId: string, conversationId: string): Promise<void> {
    const [row] = await this.db.select({ draftId: conversations.draftId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!row || row.draftId !== draftId) throw notFound(`conversation not found: ${conversationId}`);
  }

  async list(draftId: string): Promise<ConversationSummary[]> {
    await this.access.roleForDraft(draftId);
    const rows = await this.db
      .select({
        id: conversations.id,
        draftId: conversations.draftId,
        title: conversations.title,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        messageCount: sql<number>`count(${conversationMessages.id})`,
      })
      .from(conversations)
      .leftJoin(conversationMessages, eq(conversationMessages.conversationId, conversations.id))
      .where(eq(conversations.draftId, draftId))
      .groupBy(conversations.id)
      .orderBy(desc(conversations.updatedAt));
    return rows.map((row) => ({
      id: row.id,
      draftId: row.draftId,
      title: row.title,
      messageCount: Number(row.messageCount) || 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async create(draftId: string, title?: string): Promise<ConversationSummary> {
    await this.access.roleForDraft(draftId, 'editor');
    const now = new Date();
    const id = `c-${crypto.randomBytes(9).toString('base64url')}`;
    await this.db.insert(conversations).values({
      id,
      draftId,
      title: title?.trim() || defaultTitle(),
      createdBy: requestAuth().user.id,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      draftId,
      title: title?.trim() || defaultTitle(),
      messageCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async rename(draftId: string, conversationId: string, title: string): Promise<void> {
    await this.access.roleForDraft(draftId, 'editor');
    await this.assertConversation(draftId, conversationId);
    const clean = title.trim();
    if (!clean) throw Object.assign(new Error('title required'), { status: 400 });
    await this.db.update(conversations)
      .set({ title: clean.slice(0, 120), updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  async remove(draftId: string, conversationId: string): Promise<void> {
    await this.access.roleForDraft(draftId, 'editor');
    await this.assertConversation(draftId, conversationId);
    await this.db.delete(conversations).where(eq(conversations.id, conversationId));
  }

  async messages(draftId: string, conversationId: string): Promise<ConversationMessage[]> {
    await this.access.roleForDraft(draftId);
    await this.assertConversation(draftId, conversationId);
    const rows = await this.db
      .select({
        id: conversationMessages.id,
        seq: conversationMessages.seq,
        role: conversationMessages.role,
        data: conversationMessages.data,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.seq));
    return rows.map((row) => ({
      ...(row.data as Record<string, unknown>),
      id: row.id,
      seq: row.seq,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async appendMessage(
    draftId: string,
    conversationId: string,
    message: { role: string; data: Record<string, unknown> },
  ): Promise<ConversationMessage> {
    await this.access.roleForDraft(draftId, 'editor');
    await this.assertConversation(draftId, conversationId);
    const now = new Date();
    const id = `m-${crypto.randomBytes(9).toString('base64url')}`;
    // Strip transient/echoed identity fields so stored data stays clean; the row
    // columns are the source of truth for id/role/seq/createdAt.
    const { id: _omitId, role: _omitRole, seq: _omitSeq, createdAt: _omitCreatedAt, ...data } =
      message.data as Record<string, unknown>;
    void _omitId; void _omitRole; void _omitSeq; void _omitCreatedAt;
    const inserted = await this.db.transaction(async (tx) => {
      const [{ max }] = await tx
        .select({ max: sql<number | null>`max(${conversationMessages.seq})` })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversationId));
      const seq = (Number(max) || 0) + 1;
      await tx.insert(conversationMessages).values({
        id,
        conversationId,
        seq,
        role: message.role,
        data,
        createdAt: now,
      });
      await tx.update(conversations)
        .set({ updatedAt: now })
        .where(eq(conversations.id, conversationId));
      return seq;
    });
    return { ...data, id, seq: inserted, role: message.role, createdAt: now.toISOString() };
  }
}
