import type { AuthService, AuthSession } from '../src/auth.js';

export const TEST_USER = {
  id: 'test-user',
  name: 'Test User',
  email: 'test@example.com',
  emailVerified: true,
  image: null,
  githubLogin: 'test-user',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

export function createTestAuth(
  session: AuthSession | null = {
    session: {
      id: 'test-session',
      userId: TEST_USER.id,
      token: 'test-token',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    user: TEST_USER,
  },
): AuthService {
  return {
    async handler() {
      return Response.json({ ok: true });
    },
    async getSession() {
      return session;
    },
  };
}
