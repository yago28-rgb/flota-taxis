import "server-only";
import ExcelJS from "exceljs";
import { and, asc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ExportColumn } from "@/db/schema";
import { byCategory, byLicense, monthlySeries, movementWhere, totals, type FinanceFilter } from "@/lib/finance";
import { FIELDS, DATASETS, type Dataset, type FieldDef } from "./fields";

type Row = Record<string, string | number | Date | null>;

const KIND = { income: "Ingreso", expense: "Gasto", neutral: "Neutro" } as const;
const STATUS: Record<string, string> = {
  active: "Activo", inactive: "Inactivo", suspended: "Suspendido", retired: "Baja",
  uploaded: "Subida", processing: "Procesando", needs_review: "Pendiente de revisión", failed: "Error", confirmed: "Confirmada", rejected: "Descartada",
};
const DIRECTION = { received: "Recibida", issued: "Emitida", unknown: "Sin determinar" } as const;

const money = (c: number | null | undefined) => (c === null || c === undefined ? null : c / 100);
const asDate = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

export type ExportRequest = {
  dataset: Dataset | "report";
  filter: FinanceFilter;
  columns?: ExportColumn[];
  sheetName?: string | null;
  includeTotals?: boolean;
  title?: string;
};

/* ───────────────────────────── Carga de datos ───────────────────────────── */

async function loadRows(dataset: Dataset, f: FinanceFilter): Promise<Row[]> {
  const db = await getDb();
  if (dataset === "movements") {
    const m = schema.movements;
    const rows = await db
      .select({
        date: m.occurredOn, amount: m.amountCents, description: m.description, source: m.source, voidedAt: m.voidedAt,
        category: schema.categories.name, kind: schema.categories.kind,
        license: schema.licenses.number, plate: schema.vehicles.plate, driver: schema.drivers.fullName, driverCode: schema.drivers.code,
        counterparty: schema.counterparties.name, invoiceNumber: schema.invoices.invoiceNumber,
      })
      .from(m)
      .innerJoin(schema.categories, eq(schema.categories.id, m.categoryId))
      .leftJoin(schema.licenses, eq(schema.licenses.id, m.licenseId))
      .leftJoin(schema.vehicles, eq(schema.vehicles.id, m.vehicleId))
      .leftJoin(schema.drivers, eq(schema.drivers.id, m.driverId))
      .leftJoin(schema.counterparties, eq(schema.counterparties.id, m.counterpartyId))
      .leftJoin(schema.invoices, eq(schema.invoices.id, m.invoiceId))
      .where(movementWhere(f))
      .orderBy(asc(m.occurredOn), asc(m.createdAt));
    return rows.map((r) => ({
      date: asDate(r.date), year: Number(r.date.slice(0, 4)), month: Number(r.date.slice(5, 7)),
      category: r.category, kind: KIND[r.kind], amount: money(r.amount),
      signedAmount: money(r.kind === "income" ? r.amount : r.kind === "expense" ? -r.amount : 0),
      income: r.kind === "income" ? money(r.amount) : null, expense: r.kind === "expense" ? money(r.amount) : null,
      description: r.description, license: r.license, plate: r.plate, driver: r.driver, driverCode: r.driverCode,
      counterparty: r.counterparty, invoiceNumber: r.invoiceNumber,
      source: r.source === "invoice" ? "Factura" : "Manual", status: r.voidedAt ? "Anulado" : "Vigente",
    }));
  }

  if (dataset === "invoices" || dataset === "invoice_lines") {
    const i = schema.invoices;
    const conds: (SQL | undefined)[] = [gte(i.issueDate, f.from), lte(i.issueDate, f.to), sql`${i.status} <> 'rejected'`];
    if (f.licenseId) conds.push(eq(i.licenseId, f.licenseId));
    if (f.driverId) conds.push(eq(i.driverId, f.driverId));
    if (f.vehicleId) conds.push(eq(i.vehicleId, f.vehicleId));
    if (dataset === "invoices") {
      const rows = await db
        .select({ inv: i, license: schema.licenses.number, plate: schema.vehicles.plate, driver: schema.drivers.fullName, doc: schema.documents.originalName })
        .from(i)
        .innerJoin(schema.documents, eq(schema.documents.id, i.documentId))
        .leftJoin(schema.licenses, eq(schema.licenses.id, i.licenseId))
        .leftJoin(schema.vehicles, eq(schema.vehicles.id, i.vehicleId))
        .leftJoin(schema.drivers, eq(schema.drivers.id, i.driverId))
        .where(and(...conds))
        .orderBy(asc(i.issueDate));
      return rows.map(({ inv, ...r }) => ({
        issueDate: asDate(inv.issueDate), invoiceNumber: inv.invoiceNumber, counterparty: inv.counterpartyName, taxId: inv.counterpartyTaxId,
        direction: DIRECTION[inv.direction], documentType: inv.documentType, periodStart: asDate(inv.periodStart), periodEnd: asDate(inv.periodEnd),
        dueDate: asDate(inv.dueDate), subtotal: money(inv.subtotalCents), tax: money(inv.taxCents), withholding: money(inv.withholdingCents),
        total: money(inv.totalCents), license: r.license, plate: r.plate, driver: r.driver, status: STATUS[inv.status],
        confirmedAt: inv.confirmedAt, document: r.doc,
      }));
    }
    const l = schema.invoiceLines;
    const rows = await db
      .select({ inv: i, line: l, category: schema.categories.name, license: schema.licenses.number, plate: schema.vehicles.plate, driver: schema.drivers.fullName })
      .from(l)
      .innerJoin(i, eq(i.id, l.invoiceId))
      .leftJoin(schema.categories, eq(schema.categories.id, l.categoryId))
      .leftJoin(schema.licenses, sql`${schema.licenses.id} = coalesce(${l.licenseId}, ${i.licenseId})`)
      .leftJoin(schema.vehicles, sql`${schema.vehicles.id} = coalesce(${l.vehicleId}, ${i.vehicleId})`)
      .leftJoin(schema.drivers, sql`${schema.drivers.id} = coalesce(${l.driverId}, ${i.driverId})`)
      .where(and(...conds))
      .orderBy(asc(i.issueDate), asc(l.position));
    return rows.map(({ inv, line, ...r }) => ({
      issueDate: asDate(inv.issueDate), invoiceNumber: inv.invoiceNumber, counterparty: inv.counterpartyName,
      description: line.description, category: r.category, quantity: line.quantity === null ? null : Number(line.quantity),
      unitPrice: money(line.unitPriceCents), taxRate: line.taxRate === null ? null : Number(line.taxRate) / 100,
      tax: money(line.taxCents), amount: money(line.amountCents), license: r.license, plate: r.plate, driver: r.driver,
    }));
  }

  if (dataset === "drivers") {
    const ds = await db.select().from(schema.drivers).orderBy(asc(schema.drivers.fullName));
    const open = await db
      .select({ driverId: schema.driverAssignments.driverId, number: schema.licenses.number })
      .from(schema.driverAssignments)
      .innerJoin(schema.licenses, eq(schema.licenses.id, schema.driverAssignments.licenseId))
      .where(isNull(schema.driverAssignments.endedOn));
    return ds.map((d) => ({
      code: d.code, name: d.fullName, phone: d.phone, status: STATUS[d.status], startedOn: asDate(d.startedOn), endedOn: asDate(d.endedOn),
      licenses: open.filter((o) => o.driverId === d.id).map((o) => o.number).join(", ") || null,
    }));
  }

  // licenses
  const ls = await db.select().from(schema.licenses).orderBy(asc(schema.licenses.number));
  const veh = await db
    .select({ licenseId: schema.licenseVehicles.licenseId, plate: schema.vehicles.plate, make: schema.vehicles.make, model: schema.vehicles.model })
    .from(schema.licenseVehicles)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.licenseVehicles.vehicleId))
    .where(isNull(schema.licenseVehicles.endedOn));
  const drv = await db
    .select({ licenseId: schema.driverAssignments.licenseId, name: schema.drivers.fullName })
    .from(schema.driverAssignments)
    .innerJoin(schema.drivers, eq(schema.drivers.id, schema.driverAssignments.driverId))
    .where(isNull(schema.driverAssignments.endedOn));
  return ls.map((l) => {
    const v = veh.find((x) => x.licenseId === l.id);
    return {
      number: l.number, status: STATUS[l.status], acquiredOn: asDate(l.acquiredOn), plate: v?.plate ?? null, make: v?.make ?? null, model: v?.model ?? null,
      drivers: drv.filter((d) => d.licenseId === l.id).map((d) => d.name).join(", ") || null,
    };
  });
}

/* ───────────────────────────── Formato ───────────────────────────── */

const NUMFMT: Record<FieldDef["type"], string | undefined> = {
  money: '#,##0.00 "€";[Red]-#,##0.00 "€"',
  date: "dd/mm/yyyy",
  number: "#,##0.####",
  percent: "0.##%",
  text: undefined,
};

function styleHeader(ws: ExcelJS.Worksheet, rowNumber: number) {
  const row = ws.getRow(rowNumber);
  row.font = { bold: true, color: { argb: "FF1D1D1F" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F7" } };
  row.alignment = { vertical: "middle" };
  row.height = 22;
  row.eachCell((c) => (c.border = { bottom: { style: "thin", color: { argb: "FFC7C7CC" } } }));
}

function writeTable(ws: ExcelJS.Worksheet, defs: { header: string; def: FieldDef; width?: number }[], rows: Row[], includeTotals: boolean, startRow = 1) {
  ws.getRow(startRow).values = defs.map((d) => d.header);
  styleHeader(ws, startRow);
  defs.forEach((d, i) => {
    const col = ws.getColumn(i + 1);
    col.width = d.width ?? Math.min(48, Math.max(12, d.header.length + 4, d.def.type === "text" ? 22 : 14));
    if (NUMFMT[d.def.type]) col.numFmt = NUMFMT[d.def.type]!;
  });
  rows.forEach((r, idx) => {
    ws.getRow(startRow + 1 + idx).values = defs.map((d) => r[d.def.key] ?? null);
  });
  const last = startRow + rows.length;
  if (includeTotals && rows.length > 0) {
    const tr = ws.getRow(last + 2);
    tr.getCell(1).value = "Total";
    defs.forEach((d, i) => {
      if (d.def.type === "money") {
        const letter = ws.getColumn(i + 1).letter;
        tr.getCell(i + 1).value = { formula: `SUBTOTAL(9,${letter}${startRow + 1}:${letter}${last})` };
      }
    });
    tr.font = { bold: true };
    tr.eachCell((c) => (c.border = { top: { style: "thin", color: { argb: "FF8E8E93" } } }));
  }
  ws.views = [{ state: "frozen", ySplit: startRow }];
  if (rows.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: last, column: defs.length } };
}

function resolveColumns(dataset: Dataset, columns?: ExportColumn[]) {
  const all = FIELDS[dataset];
  const list: ExportColumn[] = columns?.length ? columns : all.map((f) => ({ header: f.label, field: f.key }));
  return list
    .map((c) => ({ header: c.header, def: all.find((f) => f.key === c.field), width: c.width }))
    .filter((c): c is { header: string; def: FieldDef; width: number | undefined } => Boolean(c.def));
}

/* ───────────────────────────── Libro ───────────────────────────── */

export async function buildWorkbook(req: ExportRequest): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flota";
  wb.created = new Date();

  if (req.dataset === "report") {
    await buildReport(wb, req.filter);
  } else {
    const ws = wb.addWorksheet((req.sheetName || DATASETS[req.dataset]).slice(0, 31));
    const rows = await loadRows(req.dataset, req.filter);
    writeTable(ws, resolveColumns(req.dataset, req.columns), rows, req.includeTotals ?? true);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function buildReport(wb: ExcelJS.Workbook, f: FinanceFilter) {
  const ws = wb.addWorksheet("Resumen");
  ws.getColumn(1).width = 34;
  for (const c of [2, 3, 4, 5]) ws.getColumn(c).width = 18;
  const money = NUMFMT.money!;
  ws.getCell("A1").value = "Informe económico";
  ws.getCell("A1").font = { bold: true, size: 16 };
  ws.getCell("A2").value = `Periodo: ${f.from.split("-").reverse().join("/")} – ${f.to.split("-").reverse().join("/")}`;
  ws.getCell("A3").value = "Calculado con los movimientos registrados y la naturaleza asignada a cada categoría. El resultado no equivale a un beneficio fiscal.";
  ws.getCell("A3").font = { italic: true, color: { argb: "FF6E6E73" }, size: 9 };

  const t = await totals(f);
  const summary: [string, number][] = [["Ingresos registrados", t.income], ["Gastos registrados", t.expense], ["Resultado (ingresos − gastos)", t.result], ["Movimientos neutros", t.neutral]];
  ws.getRow(5).values = ["Concepto", "Importe"];
  styleHeader(ws, 5);
  summary.forEach(([k, v], i) => {
    ws.getRow(6 + i).values = [k, v / 100];
    ws.getCell(6 + i, 2).numFmt = money;
  });

  let r = 12;
  ws.getRow(r).values = ["Mes", "Ingresos", "Gastos", "Resultado"];
  styleHeader(ws, r);
  const endY = Number(f.to.slice(0, 4)), endM = Number(f.to.slice(5, 7));
  const startY = Number(f.from.slice(0, 4)), startM = Number(f.from.slice(5, 7));
  const months = (endY - startY) * 12 + (endM - startM) + 1;
  const series = await monthlySeries({ licenseId: f.licenseId, vehicleId: f.vehicleId, driverId: f.driverId }, endY, endM, Math.max(1, Math.min(months, 120)));
  for (const s of series) {
    r++;
    ws.getRow(r).values = [`${String(s.month).padStart(2, "0")}/${s.year}`, s.income / 100, s.expense / 100, s.result / 100];
    for (const c of [2, 3, 4]) ws.getCell(r, c).numFmt = money;
  }

  r += 2;
  ws.getRow(r).values = ["Categoría", "Naturaleza", "Importe", "Movimientos"];
  styleHeader(ws, r);
  for (const c of await byCategory(f)) {
    r++;
    ws.getRow(r).values = [c.name, KIND[c.kind], c.total / 100, c.n];
    ws.getCell(r, 3).numFmt = money;
  }

  r += 2;
  ws.getRow(r).values = ["Licencia", "Ingresos", "Gastos", "Resultado", "Movimientos"];
  styleHeader(ws, r);
  for (const l of await byLicense(f)) {
    r++;
    ws.getRow(r).values = [l.number, l.income / 100, l.expense / 100, l.result / 100, l.count];
    for (const c of [2, 3, 4]) ws.getCell(r, c).numFmt = money;
  }

  const mv = wb.addWorksheet("Movimientos");
  writeTable(mv, resolveColumns("movements"), await loadRows("movements", f), true);
}

export { loadRows };
