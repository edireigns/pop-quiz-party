import "server-only";
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
const g = globalThis as unknown as { __pqpSql?: Sql };

/** Shared Postgres client (reused across hot reloads and warm lambdas). */
export function db(): Sql {
  if (!g.__pqpSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured");
    g.__pqpSql = postgres(url, {
      // Supabase's transaction pooler (port 6543) does not support prepared statements.
      prepare: false,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return g.__pqpSql;
}
