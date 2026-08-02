import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  githubLogin: text('github_login'),
  ...timestamps,
}, (table) => [
  uniqueIndex('users_github_login_unique')
    .on(sql`lower(${table.githubLogin})`)
    .where(sql`${table.githubLogin} is not null`),
]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ...timestamps,
}, (table) => [
  index('sessions_user_id_idx').on(table.userId),
]);

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  ...timestamps,
}, (table) => [
  index('accounts_user_id_idx').on(table.userId),
  uniqueIndex('accounts_provider_account_unique').on(table.providerId, table.accountId),
]);

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => [
  index('verifications_identifier_idx').on(table.identifier),
]);

export const projectRole = pgEnum('project_role', ['owner', 'editor', 'viewer']);
export const projectDesignSource = pgEnum('project_design_source', ['default', 'template', 'import']);
export const invitationStatus = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'declined',
  'revoked',
  'expired',
]);
export const objectStatus = pgEnum('object_status', ['pending', 'ready', 'deleting', 'delete_failed']);

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  designSource: projectDesignSource('design_source').notNull(),
  designName: text('design_name').notNull(),
  designTemplateId: text('design_template_id'),
  designContent: text('design_content').notNull(),
  activeDraftId: text('active_draft_id'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps,
}, (table) => [
  index('projects_created_by_idx').on(table.createdBy),
  index('projects_updated_at_idx').on(table.updatedAt),
]);

export const drafts = pgTable('drafts', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  format: text('format').default('vite-react').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  templateVersion: integer('template_version').notNull(),
  objectKey: text('object_key'),
  objectEtag: text('object_etag'),
  objectChecksum: text('object_checksum'),
  objectSize: integer('object_size'),
  objectStatus: objectStatus('object_status').default('pending').notNull(),
  ...timestamps,
}, (table) => [
  index('drafts_project_id_idx').on(table.projectId),
]);

export const draftVersions = pgTable('draft_versions', {
  id: text('id').primaryKey(),
  draftId: text('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  commit: text('commit').notNull(),
  kind: text('kind').notNull(),
  instruction: text('instruction'),
  summary: text('summary'),
  files: jsonb('files').$type<string[]>().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('draft_versions_draft_version_unique').on(table.draftId, table.version),
  index('draft_versions_draft_id_idx').on(table.draftId),
]);

export const projectMembers = pgTable('project_members', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: projectRole('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.userId] }),
  uniqueIndex('project_members_single_owner')
    .on(table.projectId)
    .where(sql`${table.role} = 'owner'`),
  index('project_members_user_id_idx').on(table.userId),
]);

export const projectInvitations = pgTable('project_invitations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  githubLogin: text('github_login').notNull(),
  role: projectRole('role').notNull(),
  status: invitationStatus('status').default('pending').notNull(),
  invitedBy: text('invited_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  acceptedBy: text('accepted_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex('project_invitations_pending_login_unique')
    .on(table.projectId, sql`lower(${table.githubLogin})`)
    .where(sql`${table.status} = 'pending'`),
  index('project_invitations_login_status_idx').on(table.githubLogin, table.status),
  index('project_invitations_project_id_idx').on(table.projectId),
]);

export const storedObjects = pgTable('stored_objects', {
  key: text('key').primaryKey(),
  draftId: text('draft_id').references(() => drafts.id, { onDelete: 'set null' }),
  etag: text('etag'),
  checksum: text('checksum').notNull(),
  size: integer('size').notNull(),
  status: objectStatus('status').default('ready').notNull(),
  lastError: text('last_error'),
  ...timestamps,
}, (table) => [
  index('stored_objects_draft_id_idx').on(table.draftId),
  index('stored_objects_status_idx').on(table.status),
]);

export type ProjectRole = typeof projectRole.enumValues[number];
export type InvitationStatus = typeof invitationStatus.enumValues[number];
