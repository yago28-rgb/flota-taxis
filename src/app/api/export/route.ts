import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { assertUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
import { buildWorkbook } from "@/lib/export/workbook";
import { DATASETS, type Dataset } from "@/lib/export/fields";

export const runtime = "nodejs";

const q = z.object({
  dataset: z.string().refine((d) => d === "report" || d in DATASETS),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  template: z.string().uuid().optional(),
  license: z.string().uuid().optional(),
  vehicle: z.string().uuid().optional(),
  driver: z.string().uuid().optional(),
  category: z.string().uuid().optional(),
  voided: z.literal("1").optional(),
});

export async function GET(req: Request) {
  try {
    const user = await assertUser("viewer");
    const params = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ""));
    const p = q.parse(params);
    if (p.from > p.to) return NextResponse.json({ error: "La fecha inicial es posterior a la final." }, { status: 400 });

    const db = await getDb();
    let template: typeof schema.exportTemplates.$inferSelect | undefined;
    if (p.template) {
      [template] = await db.select().from(schema.exportTemplates).where(eq(schema.exportTemplates.id, p.template));
      if (!template) return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404 });
    }
    const dataset = (template?.dataset ?? p.dataset) as Dataset | "report";
    const buf = await buildWorkbook({
      dataset,
      filter: { from: p.from, to: p.to, licenseId: p.license, vehicleId: p.vehicle, driverId: p.driver, categoryId: p.category, includeVoided: p.voided === "1" },
      columns: template?.columns,
      sheetName: template?.sheetName,
      includeTotals: template?.includeTotals ?? true,
    });
    await audit(db, { entity: "export", entityId: dataset, action: "export", userId: user.id, after: { ...p }, summary: `Exportación ${template?.name ?? dataset}` });

    const name = `${(template?.name ?? (dataset === "report" ? "Informe" : DATASETS[dataset as Dataset])).replace(/[^\p{L}\p{N} _-]/gu, "")} ${p.from} a ${p.to}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Parámetros de exportación no válidos." }, { status: 400 });
    return apiError(e);
  }
}
