const RECOVERABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE',
  'UND_ERR_SOCKET',
  'UND_ERR_ABORTED',
]);

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Node's bundled undici throws a bare AssertionError from the HTTP parser when a
 * proxied socket ends mid-response. It surfaces on the event loop, so no caller
 * can catch it, and it would otherwise take the whole API process down with it.
 */
function isUndiciParserAssertion(error: unknown): boolean {
  if (errorCode(error) !== 'ERR_ASSERTION') return false;
  const stack = error instanceof Error ? error.stack ?? '' : '';
  return stack.includes('undici');
}

export function isRecoverableSocketError(error: unknown): boolean {
  const code = errorCode(error);
  if (code && RECOVERABLE_CODES.has(code)) return true;
  return isUndiciParserAssertion(error);
}

export function installCrashGuards(
  onFatal: (error: unknown) => void = () => {
    process.exit(1);
  },
): void {
  const handle = (error: unknown, origin: string): void => {
    if (isRecoverableSocketError(error)) {
      console.warn(`Ignored recoverable ${origin}:`, error);
      return;
    }
    console.error(`Fatal ${origin}:`, error);
    onFatal(error);
  };

  process.on('uncaughtException', (error) => handle(error, 'uncaughtException'));
  process.on('unhandledRejection', (reason) => handle(reason, 'unhandledRejection'));
}
