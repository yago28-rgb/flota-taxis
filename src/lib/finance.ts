import "server-only";
import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * Consultas económicas. Todo se calcula a partir de los movimientos registrados y de la
 * naturaleza que el usuario ha dado a cada categoría (ingreso / gasto / neutro).
 * "Resultado" = ingresos registrados − gastos registrados; no es un beneficio fiscal.
 */
export type FinanceFilter = {
  from: string; // YYYY-MM-DD
  to: string;
  licenseId?: string | null;
  vehicleId?: string | null;
  driverId?: string | null;
  categoryId?: string | null;
  kind?: "income" | "expense" | "neutral" | null;
  includeVoided?: boolean;
  q?: string | null;
};

const m = schema.movements;
const c = schema.categories;

export function movementWhere(f: FinanceFilter): SQL | undefined {
  const conds: (SQL | undefined)[] = [gte(m.occurredOn, f.from), lte(m.occurredOn, f.to)];
  if (!f.includeVoided) conds.push(isNull(m.voidedAt));
  if (f.licenseId) conds.push(eq(m.licenseId, f.licenseId));
  if (f.vehicleId) conds.push(eq(m.vehicleId, f.vehicleId));
  if (f.driverId) conds.push(eq(m.driverId, f.driverId));
  if (f.categoryId) conds.push(eq(m.categoryId, f.categoryId));
  if (f.kind) conds.push(eq(c.kind, f.kind));
  if (f.q) conds.push(sql`${m.description} ILIKE ${"%" + f.q.replace(/[%_]/g, "") + "%"}`);
  return and(...conds);
}

export function monthRange(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${year}-${String(month).padStart(2, "0")}-${last}` };
}

export function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export async function totals(f: FinanceFilter) {
  const db = await getDb();
  const rows = await db
    .select({ kind: c.kind, total: sql<string>`coalesce(sum(${m.amountCents}),0)`, n: sql<number>`count(*)::int` })
    .from(m)
    .innerJoin(c, eq(c.id, m.categoryId))
    .where(movementWhere(f))
    .groupBy(c.kind);
  const out = { income: 0, expense: 0, neutral: 0, count: 0, incomeCount: 0 };
  for (const r of rows) {
    out[r.kind] = Number(r.total);
    out.count += r.n;
    if (r.kind === "income") out.incomeCount = r.n;
  }
  return { ...out, result: out.income - out.expense };
}

export async function monthlySeries(f: Omit<FinanceFilter, "from" | "to">, endYear: number, endMonth: number, months = 12) {
  const start = shiftMonth(endYear, endMonth, -(months - 1));
  const { from } = monthRange(start.year, start.month);
  const { to } = monthRange(endYear, endMonth);
  const db = await getDb();
  const rows = await db
    .select({
      ym: sql<string>`to_char(${m.occurredOn}, 'YYYY-MM')`,
      kind: c.kind,
      total: sql<string>`sum(${m.amountCents})`,
    })
    .from(m)
    .innerJoin(c, eq(c.id, m.categoryId))
    .where(movementWhere({ ...f, from, to }))
    .groupBy(sql`1`, c.kind);
  const series: { year: number; month: number; key: string; income: number; expense: number; result: number }[] = [];
  for (let i = 0; i < months; i++) {
    const p = shiftMonth(start.year, start.month, i);
    series.push({ ...p, key: `${p.year}-${String(p.month).padStart(2, "0")}`, income: 0, expense: 0, result: 0 });
  }
  const idx = new Map(series.map((s) => [s.key, s]));
  for (const r of rows) {
    const s = idx.get(r.ym);
    if (!s) continue;
    if (r.kind === "income") s.income += Number(r.total);
    if (r.kind === "expense") s.expense += Number(r.total);
  }
  for (const s of series) s.result = s.income - s.expense;
  return series;
}

export async function byCategory(f: FinanceFilter) {
  const db = await getDb();
  const rows = await db
    .select({ id: c.id, name: c.name, kind: c.kind, total: sql<string>`sum(${m.amountCents})`, n: sql<number>`count(*)::int` })
    .from(m)
    .innerJoin(c, eq(c.id, m.categoryId))
    .where(movementWhere(f))
    .groupBy(c.id, c.name, c.kind)
    .orderBy(sql`sum(${m.amountCents}) desc`);
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}

export async function byLicense(f: FinanceFilter) {
  const db = await getDb();
  const lic = schema.licenses;
  const rows = await db
    .select({
      licenseId: m.licenseId,
      income: sql<string>`coalesce(sum(${m.amountCents}) filter (where ${c.kind} = 'income'),0)`,
      expense: sql<string>`coalesce(sum(${m.amountCents}) filter (where ${c.kind} = 'expense'),0)`,
      n: sql<number>`count(*)::int`,
    })
    .from(m)
    .innerJoin(c, eq(c.id, m.categoryId))
    .where(movementWhere(f))
    .groupBy(m.licenseId);
  const licenses = await db.select({ id: lic.id, number: lic.number, status: lic.status }).from(lic).orderBy(lic.number);
  const map = new Map(rows.map((r) => [r.licenseId ?? "none", r]));
  const out = licenses.map((l) => {
    const r = map.get(l.id);
    const income = Number(r?.income ?? 0);
    const expense = Number(r?.expense ?? 0);
    return { id: l.id, number: l.number, status: l.status, income, expense, result: income - expense, count: r?.n ?? 0 };
  });
  const none = map.get("none");
  if (none) {
    const income = Number(none.income), expense = Number(none.expense);
    out.push({ id: "", number: "Sin licencia asignada", status: "active", income, expense, result: income - expense, count: none.n });
  }
  return out;
}

export async function fleetCounts() {
  const db = await getDb();
  const [[l], [v], [d]] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where status = 'active')::int` }).from(schema.licenses),
    db.select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where status = 'active')::int` }).from(schema.vehicles),
    db.select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where status = 'active')::int` }).from(schema.drivers),
  ]);
  return { licenses: l, vehicles: v, drivers: d };
}

export async function invoiceStats(from: string, to: string) {
  const db = await getDb();
  const i = schema.invoices;
  const [row] = await db
    .select({
      confirmedInPeriod: sql<number>`count(*) filter (where ${i.status} = 'confirmed' and ${i.issueDate} between ${from} and ${to})::int`,
      pendingReview: sql<number>`count(*) filter (where ${i.status} = 'needs_review')::int`,
      failed: sql<number>`count(*) filter (where ${i.status} = 'failed')::int`,
      unprocessed: sql<number>`count(*) filter (where ${i.status} in ('uploaded','processing'))::int`,
      withErrors: sql<number>`count(*) filter (where ${i.status} = 'needs_review' and ${i.issues} @> '[{"severity":"error"}]'::jsonb)::int`,
      duplicates: sql<number>`count(*) filter (where ${i.status} not in ('rejected','confirmed') and ${i.possibleDuplicateOf} is not null)::int`,
    })
    .from(i);
  return row;
}

export async function listMovements(f: FinanceFilter, limit = 200, offset = 0) {
  const db = await getDb();
  const where = movementWhere(f);
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({
        id: m.id,
        occurredOn: m.occurredOn,
        amountCents: m.amountCents,
        description: m.description,
        source: m.source,
        voidedAt: m.voidedAt,
        voidReason: m.voidReason,
        invoiceId: m.invoiceId,
        categoryId: m.categoryId,
        licenseId: m.licenseId,
        vehicleId: m.vehicleId,
        driverId: m.driverId,
        category: c.name,
        kind: c.kind,
        license: schema.licenses.number,
        plate: schema.vehicles.plate,
        driver: schema.drivers.fullName,
      })
      .from(m)
      .innerJoin(c, eq(c.id, m.categoryId))
      .leftJoin(schema.licenses, eq(schema.licenses.id, m.licenseId))
      .leftJoin(schema.vehicles, eq(schema.vehicles.id, m.vehicleId))
      .leftJoin(schema.drivers, eq(schema.drivers.id, m.driverId))
      .where(where)
      .orderBy(sql`${m.occurredOn} desc, ${m.createdAt} desc`)
      .limit(limit)
      .offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(m).innerJoin(c, eq(c.id, m.categoryId)).where(where),
  ]);
  return { rows, total: n };
}

export async function lockedMonths(year: number) {
  const db = await getDb();
  const rows = await db.select({ month: schema.periodLocks.month }).from(schema.periodLocks).where(eq(schema.periodLocks.year, year));
  return new Set(rows.map((r) => r.month));
}

export async function lookups() {
  const db = await getDb();
  const [licenses, vehicles, drivers, categories] = await Promise.all([
    db.select({ id: schema.licenses.id, label: schema.licenses.number, status: schema.licenses.status }).from(schema.licenses).orderBy(schema.licenses.number),
    db.select({ id: schema.vehicles.id, label: schema.vehicles.plate, status: schema.vehicles.status }).from(schema.vehicles).orderBy(schema.vehicles.plate),
    db.select({ id: schema.drivers.id, label: schema.drivers.fullName, code: schema.drivers.code, status: schema.drivers.status }).from(schema.drivers).orderBy(schema.drivers.fullName),
    db.select({ id: c.id, label: c.name, kind: c.kind, active: c.active }).from(c).orderBy(c.name),
  ]);
  return { licenses, vehicles, drivers, categories };
}
export type Lookups = Awaited<ReturnType<typeof lookups>>;

export { inArray };
