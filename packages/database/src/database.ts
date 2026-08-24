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
  release(): void | Promise<void>;
}

export interface DatabaseClient extends QueryClient {
  transaction<T>(operation: (client: QueryClient) => Promise<T>): Promise<T>;
  checkout(): Promise<CheckedOutQueryClient>;
  close(): Promise<void>;
}

type PgClientLike = {
  query(sql: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
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

  release(): void {
    this.checkedOutClient.release();
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
    try {
      await client.query('BEGIN');
      const result = await operation(new PgQueryClient(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original operation error whenever rollback also fails.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async checkout(): Promise<CheckedOutQueryClient> {
    return new PgCheckedOutQueryClient(await this.pool.connect());
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
