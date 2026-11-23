import "server-only";
import type { DB } from "@/db";
import { schema } from "@/db";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

/** Campos que nunca deben quedar en el historial. */
const REDACT = new Set(["passwordHash", "password_hash"]);

function clean(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  return JSON.parse(
    JSON.stringify(v, (k, val) => (REDACT.has(k) ? "[oculto]" : val)),
  );
}

/** Devuelve sólo los campos que cambian, para que el historial sea legible. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (key === "updatedAt") continue;
    const prev = before[key];
    const next = after[key as keyof T];
    if (JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)) {
      b[key] = prev ?? null;
      a[key] = next ?? null;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

export async function audit(
  tx: Tx,
  e: {
    entity: string;
    entityId: string;
    action: string;
    userId: string | null;
    before?: unknown;
    after?: unknown;
    summary?: string;
  },
) {
  await tx.insert(schema.auditEvents).values({
    entity: e.entity,
    entityId: e.entityId,
    action: e.action,
    userId: e.userId,
    before: clean(e.before),
    after: clean(e.after),
    summary: e.summary ?? null,
  });
}
