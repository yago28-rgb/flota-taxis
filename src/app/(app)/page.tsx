import Link from "next/link";
import { AlertTriangle, ArrowUpRight, BadgeCheck, Car, FileText, Users, Copy, XCircle, Settings2, Tags } from "lucide-react";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { byLicense, fleetCounts, invoiceStats, lookups, monthlySeries, monthRange, shiftMonth, totals } from "@/lib/finance";
import { getSettings } from "@/lib/settings";
import { providerStatus } from "@/lib/extraction";
import { monthLabel, monthShort, percentChange } from "@/lib/format";
import { periodFrom, uuidParam, type SP } from "@/lib/period";
import { Badge, ButtonLink, Card, CardHeader, Delta, EmptyState, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { FilterSelect, RowLinks } from "@/components/client";
import { MonthlyChart, ShareBar } from "@/components/charts";
import { PeriodPicker } from "@/components/period-picker";

export const metadata = { title: "Inicio" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const { year, month } = periodFrom(sp);
  const dims = { licenseId: uuidParam(sp, "license"), vehicleId: uuidParam(sp, "vehicle"), driverId: uuidParam(sp, "driver") };

  const range = month === 0 ? { from: `${year}-01-01`, to: `${year}-12-31` } : monthRange(year, month);
  const prevP = month === 0 ? null : shiftMonth(year, month, -1);
  const prevRange = month === 0 ? { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` } : monthRange(prevP!.year, prevP!.month);
  const endY = month === 0 ? year : year, endM = month === 0 ? 12 : month;

  const db = await getDb();
  const [cur, prev, series, counts, inv, lic, lk, settings, [{ cats }]] = await Promise.all([
    totals({ ...range, ...dims }),
    totals({ ...prevRange, ...dims }),
    monthlySeries(dims, endY, endM, 12),
    fleetCounts(),
    invoiceStats(range.from, range.to),
    byLicense({ ...range, ...dims }),
    lookups(),
    getSettings(),
    db.select({ cats: sql<number>`count(*)::int` }).from(schema.categories),
  ]);
  const provider = await providerStatus();

  const periodName = month === 0 ? `Año ${year}` : monthLabel(year, month);
  const prevName = month === 0 ? `${year - 1}` : monthLabel(prevP!.year, prevP!.month).toLowerCase();
  const chart = series.map((s) => ({ ...s, label: `${monthShort(s.year, s.month)}${s.month === 1 ? ` ${String(s.year).slice(2)}` : ""}` }));
  const maxLic = Math.max(0, ...lic.map((l) => Math.max(l.income, l.expense)));

  const alerts: { icon: typeof AlertTriangle; tone: "warning" | "negative" | "accent"; text: string; href: string; cta: string }[] = [];
  if (!provider.ready) alerts.push({ icon: XCircle, tone: "negative", text: `Reconocimiento automático no disponible: ${provider.reason}`, href: "/ajustes", cta: "Ver ajustes" });
  if (cats === 0) alerts.push({ icon: Tags, tone: "accent", text: "Aún no hay categorías. Créalas con los conceptos reales del negocio para poder importar facturas.", href: "/ajustes/categorias", cta: "Crear categorías" });
  if (!settings.accounting.confirmedByUser) alerts.push({ icon: Settings2, tone: "accent", text: "Confirma cómo deben registrarse los importes (base o total con impuestos) antes de importar facturas.", href: "/ajustes", cta: "Revisar" });
  if (inv.withErrors > 0) alerts.push({ icon: AlertTriangle, tone: "negative", text: `${inv.withErrors} factura(s) pendientes con errores de validación.`, href: "/facturas?estado=needs_review", cta: "Revisar" });
  if (inv.duplicates > 0) alerts.push({ icon: Copy, tone: "warning", text: `${inv.duplicates} posible(s) factura(s) duplicada(s).`, href: "/facturas?estado=needs_review", cta: "Comprobar" });
  if (inv.failed > 0) alerts.push({ icon: XCircle, tone: "warning", text: `${inv.failed} documento(s) no se pudieron leer automáticamente.`, href: "/facturas?estado=failed", cta: "Ver" });

  return (
    <>
      <PageHeader
        eyebrow={`Hola, ${user.name.split(" ")[0]}`}
        title={periodName}
        actions={<ButtonLink href="/facturas/subir" className="hidden sm:inline-flex">Subir factura</ButtonLink>}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2 animate-in">
        <PeriodPicker year={year} month={month} />
        <FilterSelect name="license" label="Licencia" options={lk.licenses.map((l) => ({ value: l.id, label: l.label }))} allLabel="todas" />
        <FilterSelect name="vehicle" label="Vehículo" options={lk.vehicles.map((v) => ({ value: v.id, label: v.label }))} />
        <FilterSelect name="driver" label="Conductor" options={lk.drivers.map((d) => ({ value: d.id, label: d.label }))} />
      </div>

      {/* KPIs económicos */}
      <div className="stagger mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Ingresos registrados" cents={cur.income} delta={percentChange(cur.income, prev.income)} vs={prevName} />
        <Kpi label="Gastos registrados" cents={cur.expense} delta={percentChange(cur.expense, prev.expense)} vs={prevName} inverse />
        <Card className="p-5">
          <div className="text-[13px] font-medium text-text-2">Resultado</div>
          {cur.incomeCount > 0 ? (
            <>
              <div className={`display mt-1 text-[30px] font-semibold tabular ${cur.result < 0 ? "text-negative" : ""}`}>
                <Money cents={cur.result} />
              </div>
              <div className="mt-1 flex items-center gap-2 text-[12px] text-text-3">
                <Delta value={percentChange(cur.result, prev.result)} /> frente a {prevName}
              </div>
            </>
          ) : (
            <>
              <div className="display mt-1 text-[30px] font-semibold text-text-3">—</div>
              <p className="mt-1 text-[12px] text-text-3">Sin ingresos registrados en el periodo: no se puede calcular.</p>
            </>
          )}
        </Card>
      </div>
      <p className="mb-8 px-1 text-[12px] text-text-3">
        Calculado con los movimientos confirmados y la naturaleza de cada categoría. No equivale al beneficio fiscal.
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2 animate-in">
          <CardHeader title="Evolución mensual" subtitle="Últimos 12 meses" />
          <MonthlyChart data={chart} />
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="animate-in">
            <CardHeader title="Facturas" action={<Link href="/facturas" className="text-[13px] font-medium text-accent">Ver todas</Link>} />
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-[var(--radius-card)] bg-line">
              <Stat label={`Confirmadas · ${month === 0 ? year : monthShort(year, month)}`} value={inv.confirmedInPeriod} href="/facturas?estado=confirmed" />
              <Stat label="Pendientes de revisión" value={inv.pendingReview} tone={inv.pendingReview ? "warning" : undefined} href="/facturas?estado=needs_review" />
              <Stat label="Sin procesar" value={inv.unprocessed} href="/facturas?estado=uploaded" />
              <Stat label="Errores de lectura" value={inv.failed} tone={inv.failed ? "negative" : undefined} href="/facturas?estado=failed" />
            </div>
          </Card>
          <Card className="animate-in">
            <CardHeader title="Flota" />
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-b-[var(--radius-card)] bg-line">
              <Fleet icon={BadgeCheck} label="Licencias" total={counts.licenses.total} active={counts.licenses.active} href="/licencias" />
              <Fleet icon={Car} label="Vehículos" total={counts.vehicles.total} active={counts.vehicles.active} href="/vehiculos" />
              <Fleet icon={Users} label="Conductores" total={counts.drivers.total} active={counts.drivers.active} href="/conductores" />
            </div>
          </Card>
        </div>
      </div>

      {alerts.length > 0 && (
        <Card className="mt-4 animate-in">
          <CardHeader title="Avisos" subtitle="Requieren tu atención" />
          <ul className="divide-y divide-line px-5 pb-2">
            {alerts.map((a, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <span className={`grid size-8 shrink-0 place-items-center rounded-full ${a.tone === "negative" ? "bg-negative-soft text-negative" : a.tone === "warning" ? "bg-warning-soft text-warning" : "bg-accent-soft text-accent"}`}>
                  <a.icon className="size-4" />
                </span>
                <span className="flex-1 text-[14px]">{a.text}</span>
                <Link href={a.href} className="shrink-0 text-[13px] font-medium text-accent">{a.cta}</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-4 animate-in">
        <CardHeader title="Actividad por licencia" subtitle={periodName} />
        {lic.length === 0 ? (
          <EmptyState icon={<BadgeCheck className="size-5" />} title="Sin licencias" action={<ButtonLink href="/licencias" size="sm">Añadir licencia</ButtonLink>}>
            Registra las licencias para ver su actividad económica.
          </EmptyState>
        ) : (
          <RowLinks>
            <Table>
              <thead>
                <tr>
                  <Th>Licencia</Th>
                  <Th align="right">Ingresos</Th>
                  <Th align="right">Gastos</Th>
                  <Th align="right">Resultado</Th>
                  <Th className="hidden w-[22%] md:table-cell">Peso en gastos</Th>
                  <Th align="right">Mov.</Th>
                </tr>
              </thead>
              <tbody>
                {lic.map((l) => (
                  <Tr key={l.id || "none"} href={l.id ? `/licencias/${l.id}` : undefined}>
                    <Td className="font-medium">
                      {l.number}
                      {l.status !== "active" && <Badge className="ml-2">{l.status === "retired" ? "Baja" : "Inactiva"}</Badge>}
                    </Td>
                    <Td align="right"><Money cents={l.income} /></Td>
                    <Td align="right"><Money cents={l.expense} /></Td>
                    <Td align="right" className={l.result < 0 ? "text-negative" : ""}>{l.income || l.expense ? <Money cents={l.result} /> : <span className="text-text-3">—</span>}</Td>
                    <Td className="hidden md:table-cell"><ShareBar value={l.expense} max={maxLic} /></Td>
                    <Td align="right" className="text-text-2">{l.count}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </RowLinks>
        )}
      </Card>
    </>
  );
}

function Kpi({ label, cents, delta, vs, inverse }: { label: string; cents: number; delta: number | null; vs: string; inverse?: boolean }) {
  return (
    <Card className="p-5">
      <div className="text-[13px] font-medium text-text-2">{label}</div>
      <div className="display mt-1 text-[30px] font-semibold"><Money cents={cents} /></div>
      <div className="mt-1 flex items-center gap-2 text-[12px] text-text-3">
        <Delta value={delta} inverse={inverse} /> frente a {vs}
      </div>
    </Card>
  );
}

function Stat({ label, value, tone, href }: { label: string; value: number; tone?: "warning" | "negative"; href: string }) {
  return (
    <Link href={href} className="group bg-surface px-5 py-4 transition-colors hover:bg-surface-2">
      <div className={`display text-[24px] font-semibold tabular ${tone === "warning" ? "text-warning" : tone === "negative" ? "text-negative" : ""}`}>{value}</div>
      <div className="flex items-center gap-1 text-[12px] text-text-2">
        {label}
        <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </Link>
  );
}

function Fleet({ icon: Icon, label, total, active, href }: { icon: typeof FileText; label: string; total: number; active: number; href: string }) {
  return (
    <Link href={href} className="bg-surface px-4 py-4 transition-colors hover:bg-surface-2">
      <Icon className="mb-2 size-4 text-text-3" />
      <div className="display text-[22px] font-semibold tabular">{total}</div>
      <div className="text-[12px] text-text-2">{label}</div>
      {total > 0 && <div className="text-[11px] text-text-3">{active} activos</div>}
    </Link>
  );
}
