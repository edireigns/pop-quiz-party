import "server-only";
import postgres from "postgres";
import { SetupError } from "./setupErrors";

type Sql = ReturnType<typeof postgres>;
const g = globalThis as unknown as { __pqpSql?: Sql };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

/** Encrypt connections to remote databases (e.g. Supabase) unless the URL says otherwise. */
export function sslFor(url: string): false | "require" {
  try {
    const u = new URL(url);
    if (u.searchParams.has("sslmode") || u.searchParams.has("ssl")) return false; // postgres.js reads it from the URL
    return LOCAL_HOSTS.has(u.hostname) ? false : "require";
  } catch {
    return false;
  }
}

/** Shared Postgres client (reused across hot reloads and warm lambdas). */
export function db(): Sql {
  if (!g.__pqpSql) {
    const url = process.env.DATABASE_URL;
    if (!url)
      throw new SetupError(
        "setup_missing_env",
        "DATABASE_URL isn't set. Locally: copy .env.example to .env.local, fill it in, and restart `npm run dev`. On Vercel: add it under Settings → Environment Variables and redeploy.",
      );
    if (!/^postgres(ql)?:\/\//.test(url))
      throw new SetupError("setup_bad_env", "DATABASE_URL must start with postgres:// or postgresql://.");
    const ssl = sslFor(url);
    g.__pqpSql = postgres(url, {
      // Supabase's transaction pooler (port 6543) does not support prepared statements.
      prepare: false,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
      ...(ssl ? { ssl } : {}),
    });
  }
  return g.__pqpSql;
}
