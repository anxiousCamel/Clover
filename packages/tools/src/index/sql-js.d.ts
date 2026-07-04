/**
 * Declaração ambiente mínima para `sql.js@1.14.x` — o pacote não publica `.d.ts`
 * e não há `@types/sql.js`. Cobre só o subconjunto usado pelo Workspace Index
 * (Database, Statement, export/close, initSqlJs). Sem `any` implícito.
 */
declare module 'sql.js' {
  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface Statement {
    bind(params?: unknown[] | Record<string, unknown>): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
    reset(): void;
  }

  export interface Database {
    run(sql: string, params?: unknown[] | Record<string, unknown>): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string, params?: unknown[] | Record<string, unknown>): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | null) => Database;
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
