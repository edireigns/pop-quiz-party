// Turns low-level database/config failures into clear, actionable messages so
// a host who hasn't finished setup sees *what* to fix instead of a generic
// "Something went wrong". Messages never include secrets (passwords, keys).

export interface SetupProblem {
  code: string;
  message: string;
  status: number;
}

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
]);

function errCode(e: unknown): string | undefined {
  if (!e || typeof e !== "object") return undefined;
  const any = e as { code?: unknown; errors?: unknown[]; cause?: unknown };
  if (typeof any.code === "string") return any.code;
  // Node's happy-eyeballs connect wraps per-address failures in an AggregateError.
  if (Array.isArray(any.errors)) for (const inner of any.errors) {
    const c = errCode(inner);
    if (c) return c;
  }
  if (any.cause) return errCode(any.cause);
  return undefined;
}

export class SetupError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function classifySetupError(e: unknown): SetupProblem | null {
  if (e instanceof SetupError) return { code: e.code, message: e.message, status: 503 };
  const code = errCode(e);
  const msg = e instanceof Error ? e.message : String(e);

  if (code && NETWORK_CODES.has(code)) {
    return {
      code: "setup_db_unreachable",
      message:
        "Can't reach the database. Locally: is Postgres running, and is DATABASE_URL in .env.local correct? " +
        "On Supabase: use the Transaction pooler connection string (port 6543) — the direct db.<project>.supabase.co host is IPv6-only and often unreachable.",
      status: 503,
    };
  }
  switch (code) {
    case "28P01": // invalid_password
      return { code: "setup_db_auth", message: "The database rejected the password in DATABASE_URL. Copy the connection string again and check the password.", status: 503 };
    case "28000": // invalid_authorization_specification (wrong user, SSL required, …)
      return {
        code: "setup_db_auth",
        message: "The database refused the connection (wrong user, or SSL required). Check the user in DATABASE_URL, or add ?sslmode=require.",
        status: 503,
      };
    case "3D000": // invalid_catalog_name
      return { code: "setup_db_missing", message: "The database named in DATABASE_URL doesn't exist. Create it (e.g. `createdb popquiz`) or fix the name.", status: 503 };
    case "42P01": // undefined_table
    case "42883": // undefined_function
      return {
        code: "setup_migration",
        message:
          "The database tables aren't set up yet. Run `npm run db:migrate`, or paste supabase/migrations/0001_init.sql into the Supabase SQL Editor and run it.",
        status: 503,
      };
  }
  if (/self[- ]signed|certificate|\bSSL\b|\bTLS\b/i.test(msg)) {
    return { code: "setup_db_ssl", message: "The database SSL handshake failed. Try adding ?sslmode=require to DATABASE_URL.", status: 503 };
  }
  return null;
}
