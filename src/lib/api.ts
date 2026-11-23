import "server-only";
import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/session";
import { InvoiceError, UploadError } from "@/lib/invoices/service";
import { UserError } from "@/lib/actions/util";

export function apiError(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof UploadError || e instanceof InvoiceError || e instanceof UserError) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  console.error("[api]", e);
  return NextResponse.json({ error: "Error inesperado." }, { status: 500 });
}

/** Protección CSRF para peticiones que modifican datos: el origen debe ser el propio sitio. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw new AuthError(403, "Origen de la petición no válido.");
  try {
    if (new URL(origin).host !== host) throw new Error();
  } catch {
    throw new AuthError(403, "Origen de la petición no válido.");
  }
}
