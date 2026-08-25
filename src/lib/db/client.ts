import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Lazily-created Drizzle client.
 *
 * Held on globalThis so Next's dev-mode module reloading does not open a new
 * connection pool on every edit. Returns null when DATABASE_URL is unset, which
 * callers treat as "no cache available, go live to the platform API".
 */

type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  snapCountSql?: ReturnType<typeof postgres>;
  snapCountDb?: Db;
};

export function getDb(): Db | null {
  if (!env.databaseUrl) return null;
  if (globalForDb.snapCountDb) return globalForDb.snapCountDb;

  const sql = postgres(env.databaseUrl, {
    max: env.isProduction ? 10 : 3,
    idle_timeout: 20,
    // Supabase's pooler does not support prepared statements.
    prepare: false,
  });
  const db = drizzle(sql, { schema, casing: "snake_case" });

  globalForDb.snapCountSql = sql;
  globalForDb.snapCountDb = db;
  return db;
}

/** Same as getDb() but throws — for write paths that genuinely need Postgres. */
export function requireDb(): Db {
  const db = getDb();
  if (!db) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (see .env.example) to enable the Postgres cache.",
    );
  }
  return db;
}

/** Close the pool. Only used by CLI scripts so the process can exit. */
export async function closeDb(): Promise<void> {
  if (globalForDb.snapCountSql) {
    await globalForDb.snapCountSql.end({ timeout: 5 });
    globalForDb.snapCountSql = undefined;
    globalForDb.snapCountDb = undefined;
  }
}

export { schema };
