import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { assertUser } from "@/lib/auth/session";
import { apiError, assertSameOrigin } from "@/lib/api";
import { DATASETS, suggestField, type Dataset } from "@/lib/export/fields";

export const runtime = "nodejs";

/**
 * Lee los encabezados del Excel que ya usa el titular para crear una plantilla igual.
 * Sólo se leen los encabezados; el archivo no se guarda.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await assertUser("editor");
    const form = await req.formData();
    const file = form.get("file");
    const dataset = String(form.get("dataset") ?? "movements") as Dataset;
    if (!(dataset in DATASETS)) return NextResponse.json({ error: "Conjunto de datos no válido." }, { status: 400 });
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Selecciona un archivo .xlsx." }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "El archivo es demasiado grande (máx. 10 MB)." }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.subarray(0, 2).toString("latin1") !== "PK") {
      return NextResponse.json({ error: "El archivo no es un Excel .xlsx. Si es .xls antiguo, ábrelo y guárdalo como .xlsx." }, { status: 400 });
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);

    const sheets = wb.worksheets.map((ws) => {
      // Primera fila con al menos 2 celdas de texto: se toma como encabezado.
      let headerRow: string[] = [];
      let rowNumber = 0;
      for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
        const values = (ws.getRow(r).values as unknown[]).slice(1).map((v) => cellText(v));
        const texts = values.filter((v) => v && Number.isNaN(Number(v.replace(",", "."))));
        if (texts.length >= 2) {
          headerRow = values;
          rowNumber = r;
          break;
        }
      }
      return {
        name: ws.name,
        headerRow: rowNumber,
        columns: headerRow
          .map((h, i) => ({ index: i, header: h.trim() }))
          .filter((c) => c.header)
          .map((c) => ({ ...c, suggestion: suggestField(dataset, c.header) })),
        sampleRows: rowNumber ? Math.max(0, ws.rowCount - rowNumber) : 0,
      };
    });
    return NextResponse.json({ sheets });
  } catch (e) {
    return apiError(e);
  }
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; text?: string; result?: unknown };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text;
    if (o.result !== undefined) return String(o.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}
