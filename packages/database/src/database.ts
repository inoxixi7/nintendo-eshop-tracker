import { createRequire } from 'node:module';

export type QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
  rowCount: number | null;
};

/** A deliberately small database surface used by repository code and unit tests. */
export interface QueryClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
}

export interface CheckedOutQueryClient extends QueryClient {
  /** Supplying an error makes pg discard the session instead of returning it to the pool. */
  release(error?: Error): void | Promise<void>;
}

export interface DatabaseClient extends QueryClient {
  transaction<T>(operation: (client: QueryClient) => Promise<T>): Promise<T>;
  checkout(): Promise<CheckedOutQueryClient>;
  close(): Promise<void>;
}

type PgClientLike = {
  query(sql: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(error?: Error): void;
};

type PgPoolLike = {
  query(sql: string, values?: readonly unknown[]): Promise<QueryResult>;
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
};

type PgPoolConstructor = new (options: { connectionString: string }) => PgPoolLike;

function asValues(values: readonly unknown[] | undefined): readonly unknown[] | undefined {
  return values === undefined ? undefined : [...values];
}

class PgQueryClient implements QueryClient {
  constructor(private readonly client: Pick<PgClientLike, 'query'>) {}

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>> {
    return this.client.query(sql, asValues(values)) as Promise<QueryResult<Row>>;
  }
}

class PgCheckedOutQueryClient extends PgQueryClient implements CheckedOutQueryClient {
  constructor(private readonly checkedOutClient: PgClientLike) {
    super(checkedOutClient);
  }

  release(error?: Error): void {
    this.checkedOutClient.release(error);
  }
}

export class PgDatabaseClient implements DatabaseClient {
  private readonly pool: PgPoolLike;

  constructor(databaseUrl: string) {
    const require = createRequire(import.meta.url);
    const { Pool } = require('pg') as { Pool: PgPoolConstructor };
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>> {
    return this.pool.query(sql, asValues(values)) as Promise<QueryResult<Row>>;
  }

  async transaction<T>(operation: (client: QueryClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let committed = false;
    let released = false;
    try {
      await client.query('BEGIN');
      const result = await operation(new PgQueryClient(client));
      await client.query('COMMIT');
      committed = true;
      client.release();
      released = true;
      return result;
    } catch (error) {
      let cleanupError: Error | undefined;
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          cleanupError = rollbackError instanceof Error ? rollbackError : new Error('Transaction rollback failed');
        }
      }
      if (committed) {
        cleanupError ??= error instanceof Error ? error : new Error('Database session cleanup failed');
      }
      if (!released) {
        try {
          client.release(cleanupError);
        } catch {
          // The original transaction error remains the useful failure for callers.
        }
      }
      throw error;
    }
  }

  async checkout(): Promise<CheckedOutQueryClient> {
    return new PgCheckedOutQueryClient(await this.pool.connect());
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
