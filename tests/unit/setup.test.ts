import { describe, expect, it } from "vitest";
import { classifySetupError, SetupError } from "@/lib/server/setupErrors";
import { sslFor } from "@/lib/server/db";

const err = (code: string, message = "boom") => Object.assign(new Error(message), { code });

describe("setup error messages", () => {
  it("explains an unreachable database", () => {
    for (const c of ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "CONNECT_TIMEOUT"]) {
      expect(classifySetupError(err(c))?.code).toBe("setup_db_unreachable");
    }
    const agg = Object.assign(new AggregateError([err("ECONNREFUSED")], "connect failed"), {});
    expect(classifySetupError(agg)?.code).toBe("setup_db_unreachable");
  });
  it("explains auth, missing database and missing migration", () => {
    expect(classifySetupError(err("28P01"))?.code).toBe("setup_db_auth");
    expect(classifySetupError(err("3D000"))?.code).toBe("setup_db_missing");
    expect(classifySetupError(err("42P01"))?.message).toMatch(/npm run db:migrate/);
    expect(classifySetupError(err("42883"))?.code).toBe("setup_migration");
  });
  it("passes through missing env config", () => {
    expect(classifySetupError(new SetupError("setup_missing_env", "DATABASE_URL isn't set"))).toEqual({
      code: "setup_missing_env",
      message: "DATABASE_URL isn't set",
      status: 503,
    });
  });
  it("leaves real bugs alone", () => {
    expect(classifySetupError(new TypeError("x is undefined"))).toBeNull();
    expect(classifySetupError(err("23505"))).toBeNull();
  });
  it("never echoes secrets", () => {
    const p = classifySetupError(err("28P01", 'password authentication failed for user "postgres.abcd"'));
    expect(p?.message).not.toContain("abcd");
  });
});

describe("database SSL defaults", () => {
  it("encrypts remote connections, not local ones, and respects sslmode", () => {
    expect(sslFor("postgres://u:p@localhost:5432/db")).toBe(false);
    expect(sslFor("postgres://u:p@127.0.0.1/db")).toBe(false);
    expect(sslFor("postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres")).toBe("require");
    expect(sslFor("postgres://u:p@db.example.com/db?sslmode=disable")).toBe(false);
  });
});
