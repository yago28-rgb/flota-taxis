import "server-only";
import {
  ExtractionError,
  extractionSchema,
  type ExtractionInput,
  type ExtractionOutput,
  type ExtractionProvider,
} from "./types";

/**
 * Motor local de reconocimiento (carpeta `ocr-engine/`): PaddleOCR + reglas en Python
 * (+ Qwen2.5-VL opcional vía Ollama). Se ejecuta en este mismo equipo: sin claves,
 * sin coste por documento y sin enviar facturas a servicios externos.
 */
const DEFAULT_URL = "http://127.0.0.1:8765";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function engineUrl(): string {
  return (process.env.OCR_ENGINE_URL || DEFAULT_URL).replace(/\/+$/, "");
}

/** El motor debe estar en este equipo, salvo que se autorice expresamente otra máquina de la red propia. */
function urlError(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `OCR_ENGINE_URL no es una dirección válida: ${url}`;
  }
  if (!LOOPBACK.has(u.hostname) && process.env.OCR_ENGINE_ALLOW_REMOTE !== "1") {
    return "OCR_ENGINE_URL debe apuntar a este equipo (127.0.0.1). Para usar otro equipo de tu red, añade OCR_ENGINE_ALLOW_REMOTE=1.";
  }
  return null;
}

export type EngineHealth = {
  reachable: boolean;
  status: "ready" | "loading" | "error" | "offline";
  engine: string | null;
  error: string | null;
  qwen: { enabled: boolean; available: boolean; model: string; reason?: string | null } | null;
};

export async function engineHealth(timeoutMs = 1500): Promise<EngineHealth> {
  const url = engineUrl();
  const bad = urlError(url);
  if (bad) return { reachable: false, status: "error", engine: null, error: bad, qwen: null };
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    const j = (await res.json()) as { status: EngineHealth["status"]; engine: string; error: string | null; qwen: EngineHealth["qwen"] };
    return { reachable: true, status: j.status, engine: j.engine, error: j.error, qwen: j.qwen };
  } catch {
    return { reachable: false, status: "offline", engine: null, error: null, qwen: null };
  }
}

export class LocalOcrProvider implements ExtractionProvider {
  readonly id = "local";
  readonly label = "Motor local (PaddleOCR + reglas)";

  configurationError(): string | null {
    return urlError(engineUrl());
  }

  async extract({ data, mimeType, context }: ExtractionInput): Promise<ExtractionOutput> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), "documento");
    form.append(
      "context",
      JSON.stringify({
        ownerName: context.ownerName ?? null,
        ownerTaxId: context.ownerTaxId ?? null,
        knownPlates: context.knownPlates,
        knownLicenses: context.knownLicenses,
        knownDrivers: context.knownDrivers ?? [],
        extraInstructions: context.extraInstructions ?? null,
      }),
    );

    let res: Response;
    try {
      res = await fetch(`${engineUrl()}/extract`, { method: "POST", body: form, signal: AbortSignal.timeout(280_000) });
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new ExtractionError("El motor local ha tardado demasiado. Prueba con menos páginas o una foto más pequeña.", true);
      }
      throw new ExtractionError("El motor de reconocimiento local no está en marcha. Inícialo con «npm run ocr».", true);
    }

    const body = (await res.json().catch(() => null)) as { detail?: string; result?: unknown; engine?: { models?: string[] } } | null;
    if (!res.ok) {
      throw new ExtractionError(body?.detail || `El motor local respondió con un error (${res.status}).`, res.status === 503);
    }
    const parsed = extractionSchema.safeParse(body?.result);
    if (!parsed.success) {
      console.error("[extraction/local] respuesta fuera de contrato", parsed.error.issues.slice(0, 5));
      throw new ExtractionError("El motor local devolvió datos con un formato inesperado.");
    }
    return { result: parsed.data, model: (body?.engine?.models ?? ["PaddleOCR"]).join(" + ") };
  }
}
