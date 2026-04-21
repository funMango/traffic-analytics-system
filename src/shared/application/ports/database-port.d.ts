export interface QueryResult<T = unknown> {
  rows: T[];
}

export interface DatabasePort {
  init(): Promise<void>;
  close(): Promise<void>;
  execute<T = unknown>(sql: string, binds?: unknown, opts?: unknown): Promise<QueryResult<T>>;
  ping(): Promise<void>;
}

