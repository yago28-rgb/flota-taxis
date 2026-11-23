#!/usr/bin/env node
/**
 * Copia de seguridad: base de datos + documentos originales.
 *
 *   node scripts/backup.mjs [carpeta-destino]
 *
 * - Con DATABASE_URL (PostgreSQL de servidor) ejecuta `pg_dump` (debe estar instalado).
 * - Sin DATABASE_URL (PGlite embebido) copia la carpeta de datos. Detén la aplicación antes
 *   para que la copia sea consistente.
 * - Siempre copia la carpeta de documentos (STORAGE_DIR).
 *
 * Guarda las copias cifradas y fuera del servidor (contienen datos personales y fiscales).
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

// Carga .env.local sin dependencias externas.
for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const dest = resolve(process.argv[2] ?? "backups", `flota-${stamp}`);
mkdirSync(dest, { recursive: true });

if (process.env.DATABASE_URL) {
  const out = join(dest, "database.dump");
  const r = spawnSync("pg_dump", ["--format=custom", `--file=${out}`, process.env.DATABASE_URL], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("pg_dump ha fallado. ¿Está instalado y en el PATH?");
    process.exit(1);
  }
  console.log(`Base de datos → ${out}  (restaurar con: pg_restore --clean -d <DATABASE_URL> ${out})`);
} else {
  const dir = resolve(process.env.PGLITE_DIR ?? "./data/pg");
  if (existsSync(dir)) {
    cpSync(dir, join(dest, "pg"), { recursive: true });
    console.log(`Base de datos embebida → ${join(dest, "pg")}`);
  } else console.warn(`No existe ${dir}; no hay base de datos que copiar.`);
}

const docs = resolve(process.env.STORAGE_DIR ?? "./data/documents");
if (existsSync(docs)) {
  cpSync(docs, join(dest, "documents"), { recursive: true });
  console.log(`Documentos → ${join(dest, "documents")}`);
}
console.log("Copia terminada.");
