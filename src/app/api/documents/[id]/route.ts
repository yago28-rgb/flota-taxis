import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { assertUser } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";

/** Sirve el documento original sólo a usuarios autenticados. */
export async function GET(req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  try {
    await assertUser("viewer");
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    const db = await getDb();
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
    if (!doc) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    const data = await getStorage().get(doc.storageKey);
    const download = new URL(req.url).searchParams.get("download") === "1";
    const filename = encodeURIComponent(doc.originalName);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        // El visor de PDF del navegador no funciona dentro de un sandbox; las imágenes sí se aíslan.
        ...(doc.mimeType === "application/pdf" ? {} : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox" }),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
