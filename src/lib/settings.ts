import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "./audit";

/**
 * Configuración del negocio. Ningún valor por defecto presupone cómo funciona el negocio:
 * los que afectan a cálculos están marcados como "pendiente de confirmar" hasta que el
 * titular los revise en Ajustes.
 */
export type Settings = {
  owner: { name: string | null; taxId: string | null };
  accounting: {
    /** Qué importe se registra como movimiento por cada línea de factura. */
    movementAmountBasis: "net" | "gross";
    confirmedByUser: boolean;
  };
  extraction: { extraInstructions: string | null; lowConfidenceThreshold: number };
  businessRules: { notes: string | null };
};

export const DEFAULT_SETTINGS: Settings = {
  owner: { name: null, taxId: null },
  accounting: { movementAmountBasis: "net", confirmedByUser: false },
  extraction: { extraInstructions: null, lowConfidenceThreshold: 0.75 },
  businessRules: { notes: null },
};

export async function getSettings(): Promise<Settings> {
  const db = await getDb();
  const rows = await db.select().from(schema.appSettings);
  const out = structuredClone(DEFAULT_SETTINGS) as Record<string, unknown>;
  for (const r of rows) {
    if (r.key in out) out[r.key] = { ...(out[r.key] as object), ...(r.value as object) };
  }
  return out as Settings;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K], userId: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [prev] = await tx.select().from(schema.appSettings).where(eq(schema.appSettings.key, key));
    await tx
      .insert(schema.appSettings)
      .values({ key, value, updatedBy: userId })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
    await audit(tx, { entity: "settings", entityId: key, action: "update", userId, before: prev?.value ?? null, after: value });
  });
}
