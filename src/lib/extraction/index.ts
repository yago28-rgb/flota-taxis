import "server-only";
import { LocalOcrProvider, engineHealth } from "./local";
import type { ExtractionProvider } from "./types";

/**
 * Registro de motores de reconocimiento. Todos se ejecutan en local; ninguno usa APIs de IA de pago.
 * Para añadir otro (p. ej. Tesseract o un modelo propio):
 *   1. Implementa `ExtractionProvider` (ver ./types.ts) en un fichero nuevo.
 *   2. Regístralo aquí.
 *   3. Selecciónalo con EXTRACTION_PROVIDER=<id>.
 */
const registry: Record<string, () => ExtractionProvider> = {
  local: () => new LocalOcrProvider(),
};

function providerId(): string {
  const id = (process.env.EXTRACTION_PROVIDER || "local").toLowerCase();
  // El proveedor de IA externa se eliminó: configuraciones antiguas pasan al motor local.
  return id === "anthropic" ? "local" : id;
}

export function getExtractionProvider(): ExtractionProvider | null {
  const id = providerId();
  if (id === "none") return null;
  return registry[id]?.() ?? null;
}

export type ProviderStatus = {
  id: string;
  label: string;
  ready: boolean;
  reason: string | null;
  engine: string | null;
  qwen: { enabled: boolean; available: boolean; model: string; reason?: string | null } | null;
};

export async function providerStatus(): Promise<ProviderStatus> {
  const id = providerId();
  const p = getExtractionProvider();
  if (!p) {
    return {
      id,
      label: "Sin motor",
      ready: false,
      reason:
        id === "none"
          ? "El reconocimiento automático está desactivado (EXTRACTION_PROVIDER=none)."
          : `Motor desconocido: «${id}». Usa EXTRACTION_PROVIDER=local en .env.local.`,
      engine: null,
      qwen: null,
    };
  }
  const configError = p.configurationError();
  if (configError) return { id: p.id, label: p.label, ready: false, reason: configError, engine: null, qwen: null };

  const h = await engineHealth();
  const reason =
    h.status === "ready"
      ? null
      : h.status === "loading"
        ? "El motor local se está iniciando (carga de modelos). Espera unos segundos."
        : h.status === "error"
          ? `El motor local no pudo iniciarse: ${h.error ?? "error desconocido"}`
          : "El motor local no está en marcha. Inícialo con «npm run ocr».";
  return { id: p.id, label: p.label, ready: h.status === "ready", reason, engine: h.engine, qwen: h.qwen };
}

export * from "./types";
