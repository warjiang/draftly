import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import {
  accounts,
  sessions,
  users,
  verifications,
} from './db/schema.js';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  githubLogin: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AuthSession = {
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  user: AuthUser;
};

export interface AuthService {
  handler(request: Request): Promise<Response>;
  getSession(headers: Headers): Promise<AuthSession | null>;
}

function normalizeGithubLogin(login: unknown): string {
  const normalized = String(login ?? '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(normalized)) {
    throw new Error('GitHub did not return a valid login');
  }
  return normalized;
}

export function createAuthService(database: Database, config: AppConfig): AuthService {
  const auth = betterAuth({
    appName: 'Draftly',
    baseURL: config.auth.baseUrl,
    basePath: '/api/auth',
    secret: config.auth.secret,
    trustedOrigins: [config.auth.baseUrl],
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
      transaction: true,
    }),
    user: {
      additionalFields: {
        githubLogin: {
          type: 'string',
          required: true,
        },
      },
    },
    socialProviders: {
      github: {
        clientId: config.auth.githubClientId,
        clientSecret: config.auth.githubClientSecret,
        scope: ['read:user', 'user:email'],
        mapProfileToUser(profile) {
          return {
            githubLogin: normalizeGithubLogin(profile.login),
          };
        },
      },
    },
    account: {
      accountLinking: {
        enabled: false,
      },
    },
    advanced: {
      useSecureCookies: config.nodeEnv === 'production',
      cookiePrefix: 'draftly',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.nodeEnv === 'production',
      },
    },
  });

  return {
    async handler(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname.endsWith('/update-user')) {
        return Response.json({ error: 'profile updates are managed by GitHub' }, { status: 403 });
      }
      return auth.handler(request);
    },
    async getSession(headers) {
      return await auth.api.getSession({ headers }) as AuthSession | null;
    },
  };
}
