import path from 'node:path';
import { z } from 'zod';
import { PROJECT_ROOT } from './paths.js';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(4173),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  NPM_CONFIG_REGISTRY: z.string().url().optional(),
  DRAFTLY_WORKSPACES_DIR: z.string().default('.draftly/workspaces'),
  TRUST_PROXY: booleanString.default(false),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  auth: {
    secret: string;
    baseUrl: string;
    githubClientId: string;
    githubClientSecret: string;
  };
  s3: {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  npmRegistry?: string;
  workspacesDir: string;
  trustProxy: boolean;
};

export function readConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server configuration: ${details}`);
  }
  const value = parsed.data;
  return {
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    auth: {
      secret: value.BETTER_AUTH_SECRET,
      baseUrl: value.BETTER_AUTH_URL,
      githubClientId: value.GITHUB_CLIENT_ID,
      githubClientSecret: value.GITHUB_CLIENT_SECRET,
    },
    s3: {
      endpoint: value.S3_ENDPOINT,
      region: value.S3_REGION,
      bucket: value.S3_BUCKET,
      accessKeyId: value.S3_ACCESS_KEY_ID,
      secretAccessKey: value.S3_SECRET_ACCESS_KEY,
      forcePathStyle: value.S3_FORCE_PATH_STYLE,
    },
    npmRegistry: value.NPM_CONFIG_REGISTRY,
    workspacesDir: path.resolve(PROJECT_ROOT, value.DRAFTLY_WORKSPACES_DIR),
    trustProxy: value.TRUST_PROXY,
  };
}
