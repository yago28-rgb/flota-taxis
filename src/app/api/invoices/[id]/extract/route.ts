import { NextResponse } from "next/server";
import { assertUser } from "@/lib/auth/session";
import { runExtraction } from "@/lib/invoices/service";
import { apiError, assertSameOrigin } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/invoices/[id]/extract">) {
  try {
    assertSameOrigin(req);
    const user = await assertUser("editor");
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Identificador no válido" }, { status: 400 });
    const result = await runExtraction(id, user);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (e) {
    return apiError(e);
  }
}
