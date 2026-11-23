import Link from "next/link";
import { Download, Lock, Receipt } from "lucide-react";
import { can, requireUser } from "@/lib/auth/session";
import { byCategory, listMovements, lockedMonths, lookups, monthRange, totals } from "@/lib/finance";
import { formatDate, monthLabel } from "@/lib/format";
import { one, periodFrom, uuidParam, type SP } from "@/lib/period";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, KIND, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { FilterSelect, SearchInput } from "@/components/client";
import { PeriodPicker } from "@/components/period-picker";
import { ShareBar } from "@/components/charts";
import { MovementDialog, PeriodLockButton, VoidMovementDialog } from "@/components/finance-forms";

export const metadata = { title: "Movimientos" };
const PAGE = 100;

export default async function MovementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const { year, month } = periodFrom(sp);
  const range = month === 0 ? { from: `${year}-01-01`, to: `${year}-12-31` } : monthRange(year, month);
  const kindParam = one(sp, "kind");
  const kind: "income" | "expense" | "neutral" | null = kindParam === "income" || kindParam === "expense" || kindParam === "neutral" ? kindParam : null;
  const includeVoided = one(sp, "anulados") === "1";
  const page = Math.max(1, Number(one(sp, "p")) || 1);
  const filter = {
    ...range,
    licenseId: uuidParam(sp, "license"),
    vehicleId: uuidParam(sp, "vehicle"),
    driverId: uuidParam(sp, "driver"),
    categoryId: uuidParam(sp, "category"),
    kind,
    q: one(sp, "q"),
  };

  const [{ rows, total }, t, cats, lk, locks] = await Promise.all([
    listMovements({ ...filter, includeVoided }, PAGE, (page - 1) * PAGE),
    totals(filter),
    byCategory(filter),
    lookups(),
    lockedMonths(year),
  ]);
  const editor = can(user, "editor");
  const locked = month !== 0 && locks.has(month);
  const maxCat = Math.max(0, ...cats.map((c) => Math.abs(c.total)));
  const exportQs = new URLSearchParams({ dataset: "movements", from: range.from, to: range.to });
  for (const k of ["license", "vehicle", "driver", "category"] as const) {
    const v = uuidParam(sp, k);
    if (v) exportQs.set(k, v);
  }
  const lkPlain = { licenses: lk.licenses, vehicles: lk.vehicles, drivers: lk.drivers, categories: lk.categories };

  return (
    <>
      <PageHeader
        title="Movimientos"
        subtitle="Apuntes económicos: los generados al confirmar facturas y los manuales."
        actions={
          <>
            <ButtonLink variant="secondary" href={`/api/export?${exportQs}`} prefetch={false}><Download className="size-4" />Excel</ButtonLink>
            {editor && !locked && <MovementDialog lookups={lkPlain} />}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PeriodPicker year={year} month={month} />
        <FilterSelect name="kind" label="Naturaleza" allLabel="Todas" options={[{ value: "income", label: "Ingresos" }, { value: "expense", label: "Gastos" }, { value: "neutral", label: "Neutros" }]} />
        <FilterSelect name="category" label="Categoría" allLabel="Todas" options={lk.categories.map((c) => ({ value: c.id, label: c.label }))} />
        <FilterSelect name="license" label="Licencia" allLabel="Todas" options={lk.licenses.map((o) => ({ value: o.id, label: o.label }))} />
        <FilterSelect name="vehicle" label="Vehículo" options={lk.vehicles.map((o) => ({ value: o.id, label: o.label }))} />
        <FilterSelect name="driver" label="Conductor" options={lk.drivers.map((o) => ({ value: o.id, label: o.label }))} />
        <FilterSelect name="anulados" label="Anulados" allLabel="Ocultar" options={[{ value: "1", label: "Mostrar" }]} />
        <div className="w-full sm:ml-auto sm:w-auto"><SearchInput placeholder="Buscar concepto" /></div>
      </div>

      {locked && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-fill-2 px-4 py-3 text-[13.5px]">
          <Lock className="size-4 text-text-2" />
          <span className="flex-1">{monthLabel(year, month)} está cerrado: no se admiten cambios en sus movimientos.</span>
          {user.role === "admin" && <PeriodLockButton year={year} month={month} locked />}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Ingresos" value={<Money cents={t.income} />} sub={`${t.incomeCount} apuntes`} />
        <Kpi label="Gastos" value={<Money cents={t.expense} />} />
        <Kpi label="Ingresos − gastos" value={t.incomeCount > 0 ? <Money cents={t.result} signed /> : <span className="text-text-3">—</span>} sub={t.incomeCount > 0 ? "Según los movimientos registrados" : "No hay ingresos registrados"} />
        <Kpi label="Neutros" value={<Money cents={t.neutral} />} sub="No computan" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title={month === 0 ? `Año ${year}` : monthLabel(year, month)} subtitle={`${total} movimiento${total === 1 ? "" : "s"}`} />
          {rows.length === 0 ? (
            <EmptyState icon={<Receipt className="size-5" />} title="Sin movimientos">
              Se generan al confirmar facturas o al añadirlos manualmente.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr><Th>Fecha</Th><Th>Concepto</Th><Th className="hidden md:table-cell">Asignación</Th><Th align="right">Importe</Th><Th className="w-0"><span className="sr-only">Acciones</span></Th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <Tr key={m.id} className={m.voidedAt ? "opacity-50" : undefined}>
                    <Td className="whitespace-nowrap tabular text-text-2">{formatDate(m.occurredOn)}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={m.voidedAt ? "font-medium line-through" : "font-medium"}>{m.category}</span>
                        <Badge tone={KIND[m.kind].tone}>{KIND[m.kind].label}</Badge>
                        {m.voidedAt && <Badge tone="negative">Anulado</Badge>}
                      </div>
                      {m.description && <div className="max-w-[360px] truncate text-[12px] text-text-2">{m.description}</div>}
                      {m.voidReason && <div className="text-[12px] text-negative">Motivo: {m.voidReason}</div>}
                      {m.invoiceId && <Link href={`/facturas/${m.invoiceId}`} className="text-[12px] text-accent">Ver factura</Link>}
                    </Td>
                    <Td className="hidden text-[13px] text-text-2 md:table-cell">{[m.license, m.plate, m.driver].filter(Boolean).join(" · ") || "—"}</Td>
                    <Td align="right" className="whitespace-nowrap font-medium"><Money cents={m.amountCents} /></Td>
                    <Td className="whitespace-nowrap">
                      {editor && !m.voidedAt && m.source === "manual" && !locks.has(Number(m.occurredOn.slice(5, 7))) && (
                        <span className="flex justify-end">
                          <MovementDialog lookups={lkPlain} movement={{ id: m.id, occurredOn: m.occurredOn, categoryId: m.categoryId, amountCents: m.amountCents, description: m.description, licenseId: m.licenseId, vehicleId: m.vehicleId, driverId: m.driverId }} />
                          <VoidMovementDialog id={m.id} />
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {total > PAGE && (
            <div className="flex items-center justify-center gap-3 border-t border-line px-5 py-3 text-[13px]">
              {page > 1 && <ButtonLink variant="secondary" size="sm" href={`?${new URLSearchParams({ ...flat(sp), p: String(page - 1) })}`}>Anterior</ButtonLink>}
              <span className="text-text-2">Página {page} de {Math.ceil(total / PAGE)}</span>
              {page * PAGE < total && <ButtonLink variant="secondary" size="sm" href={`?${new URLSearchParams({ ...flat(sp), p: String(page + 1) })}`}>Siguiente</ButtonLink>}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Por categoría" />
            {cats.length === 0 ? <p className="px-5 pb-5 text-[14px] text-text-3">Sin datos.</p> : (
              <ul className="space-y-3 px-5 pb-5">
                {cats.map((c) => (
                  <li key={c.id}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-[13.5px]">
                      <span className="truncate">{c.name} <span className="text-[12px] text-text-3">· {KIND[c.kind].label.toLowerCase()}</span></span>
                      <span className="shrink-0 font-medium tabular"><Money cents={c.total} /></span>
                    </div>
                    <ShareBar value={c.total} max={maxCat} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {user.role === "admin" && month !== 0 && !locked && (
            <Card className="p-5">
              <div className="mb-1 font-medium">Cierre de {monthLabel(year, month)}</div>
              <p className="mb-3 text-[13px] text-text-2">Al cerrar el mes se bloquean sus movimientos y la confirmación de facturas con fecha en él.</p>
              <PeriodLockButton year={year} month={month} locked={false} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[12.5px] text-text-2">{label}</div>
      <div className="display mt-1 text-[20px] font-semibold tabular sm:text-[22px]">{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-text-3">{sub}</div>}
    </Card>
  );
}

function flat(sp: SP): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s && k !== "p") o[k] = s;
  }
  return o;
}
