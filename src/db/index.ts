import "server-only";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Conexión a base de datos.
 *
 * - Con `DATABASE_URL` → servidor PostgreSQL (producción).
 * - Sin `DATABASE_URL` → PGlite: PostgreSQL embebido, persistido en `PGLITE_DIR`
 *   (por defecto ./data/pg). Útil para desarrollo y para instalaciones de un solo equipo.
 *
 * Ambos usan el mismo esquema y las mismas migraciones (./drizzle).
 */
export type DB = NodePgDatabase<typeof schema>;

type Holder = { db?: DB; ready?: Promise<DB> };
const g = globalThis as unknown as { __flotaDb?: Holder };
const holder: Holder = (g.__flotaDb ??= {});

const MIGRATIONS = path.join(process.cwd(), "drizzle");

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, max: 10 });
    const db = drizzle(pool, { schema });
    if (process.env.AUTO_MIGRATE !== "false") await migrate(db, { migrationsFolder: MIGRATIONS });
    return db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), "data", "pg");
  await mkdir(dir, { recursive: true });
  const client = await PGlite.create(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as DB;
}

export async function getDb(): Promise<DB> {
  if (holder.db) return holder.db;
  holder.ready ??= connect().then((db) => (holder.db = db));
  return holder.ready;
}

export { schema };
