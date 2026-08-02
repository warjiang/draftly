import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthSession } from './auth.js';

const storage = new AsyncLocalStorage<AuthSession>();

export function withRequestAuth<T>(auth: AuthSession, operation: () => Promise<T>): Promise<T> {
  return storage.run(auth, operation);
}

export function requestAuth(): AuthSession {
  const auth = storage.getStore();
  if (!auth) throw new Error('authenticated request context required');
  return auth;
}
