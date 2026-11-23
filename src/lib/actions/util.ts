import "server-only";
import { z } from "zod";
import { AuthError } from "@/lib/auth/session";
import { InvoiceError } from "@/lib/invoices/service";

export type ActionState = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; id?: string } | null;

export class UserError extends Error {}

function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^\d{5}$|^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Traduce cualquier error a un mensaje comprensible; nunca filtra detalles internos. */
export function toActionError(e: unknown): ActionState {
  if (e instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of e.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors };
  }
  if (e instanceof AuthError || e instanceof InvoiceError || e instanceof UserError) return { ok: false, message: e.message };
  const code = pgCode(e);
  if (code === "23505") return { ok: false, message: "Ya existe un registro con ese identificador." };
  if (code === "23503") return { ok: false, message: "No se puede completar: hay registros relacionados que dependen de este." };
  if (code === "23514") return { ok: false, message: "Los datos no cumplen las reglas de integridad (revisa las fechas)." };
  // Las redirecciones de Next.js se propagan.
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
  console.error("[action]", e);
  return { ok: false, message: "Ha ocurrido un error inesperado. No se ha guardado nada." };
}

/* Helpers de formularios */
export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

export const optDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida")
  .nullable();

export const uuidOrNull = z.string().uuid().nullable();
