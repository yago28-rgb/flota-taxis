import { NextResponse } from "next/server";
import { assertUser } from "@/lib/auth/session";
import { createInvoiceFromUpload, UploadError } from "@/lib/invoices/service";
import { apiError, assertSameOrigin } from "@/lib/api";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await assertUser("editor");
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES + 1024 * 1024) throw new UploadError("El documento supera el tamaño máximo de 25 MB.");
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > 30) throw new UploadError("Como máximo 30 fotos por documento.");
    const prepared = await Promise.all(files.map(async (f) => ({ name: f.name.slice(0, 200) || "documento", data: Buffer.from(await f.arrayBuffer()) })));
    const result = await createInvoiceFromUpload(prepared, user);
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e);
  }
}
