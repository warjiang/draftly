import type postgres from 'postgres';

export async function withAdvisoryLock<T>(
  client: postgres.Sql,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  return client.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    return operation();
  }) as Promise<T>;
}
