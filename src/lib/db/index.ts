import type { AppConfig } from "../config";
import { MIGRATIONS, MIGRATION_TABLE_SQL } from "./migrations";

export interface QueryResult<T> {
  rows: T[];
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  kind: "postgres" | "pglite";
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class DbConfigError extends Error {}

/** 연결 문자열에서 sslmode 등 SSL 관련 쿼리를 걷어낸다 (SSL 은 DATABASE_SSL 로 명시 제어). */
function stripSslParams(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert"]) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

function isLocalHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "";
  } catch {
    return false;
  }
}

export async function createPostgresDb(url: string, sslMode: AppConfig["db"]["ssl"]): Promise<Db> {
  const pg = await import("pg");
  const mode = sslMode ?? (isLocalHost(url) ? "disable" : "no-verify");
  const ssl = mode === "disable" ? false : mode === "verify" ? { rejectUnauthorized: true } : { rejectUnauthorized: false };
  const pool = new pg.default.Pool({
    connectionString: stripSslParams(url),
    ssl,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const query = async <T,>(sql: string, params: unknown[] = []) => {
    const r = await pool.query(sql, params as unknown[]);
    return { rows: r.rows as T[] };
  };
  return {
    kind: "postgres",
    query,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const q: Queryable = {
          query: async <T,>(sql: string, params: unknown[] = []) => {
            const r = await client.query(sql, params as unknown[]);
            return { rows: r.rows as T[] };
          },
        };
        const out = await fn(q);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/** 로컬 개발·테스트용 내장 Postgres(PGlite). dataDir 가 없으면 메모리 전용. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) {
    const fs = await import("node:fs");
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const pglite = dataDir ? new PGlite(dataDir) : new PGlite();
  await pglite.waitReady;
  // PGlite 는 단일 연결이므로 트랜잭션 동안 다른 쿼리가 끼어들지 않게 직렬화한다.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    kind: "pglite",
    query: <T,>(sql: string, params: unknown[] = []) =>
      serial(async () => {
        const r = await pglite.query<T>(sql, params as unknown[]);
        return { rows: r.rows };
      }),
    tx<T>(fn: (q: Queryable) => Promise<T>) {
      return serial(() =>
        pglite.transaction(async (t) => {
          const q: Queryable = {
            query: async <R,>(sql: string, params: unknown[] = []) => {
              const r = await t.query<R>(sql, params as unknown[]);
              return { rows: r.rows };
            },
          };
          return fn(q);
        }),
      );
    },
    async close() {
      await pglite.close();
    },
  };
}

export async function migrate(db: Db): Promise<string[]> {
  const applied: string[] = [];
  await db.tx(async (q) => {
    await q.query("SELECT pg_advisory_xact_lock(7212026)");
    for (const stmt of splitSql(MIGRATION_TABLE_SQL)) await q.query(stmt);
    const done = await q.query<{ version: string }>("SELECT version FROM sayaka.schema_migrations");
    const have = new Set(done.rows.map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (have.has(m.version)) continue;
      for (const stmt of splitSql(m.sql)) await q.query(stmt);
      await q.query("INSERT INTO sayaka.schema_migrations (version) VALUES ($1)", [m.version]);
      applied.push(m.version);
    }
  });
  return applied;
}

/** 단순 SQL 분리기 (마이그레이션에는 함수 본문/문자열 내 세미콜론이 없다). */
export function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);
}

export async function createDbFromConfig(cfg: AppConfig): Promise<Db> {
  if (cfg.db.url) return createPostgresDb(cfg.db.url, cfg.db.ssl);
  if (cfg.isVercel) {
    throw new DbConfigError("DATABASE_URL 이 설정되지 않았어요. Vercel 에서는 내장 DB 를 쓸 수 없어요.");
  }
  return createPgliteDb(cfg.db.pgliteDir);
}
