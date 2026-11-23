import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser, can } from "@/lib/auth/session";
import { driverDetail, entityHistory } from "@/lib/fleet";
import { lookups, totals } from "@/lib/finance";
import { formatDate, todayIso } from "@/lib/format";
import { ASSET_STATUS, Badge, Card, CardHeader, EmptyState, KeyValue, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { HistoryCard, MovementsCard } from "@/components/server-parts";
import { AssignDriverDialog, DriverDialog, EndDialog } from "@/components/fleet-forms";

export default async function DriverPage({ params }: PageProps<"/conductores/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await driverDetail(id);
  if (!data) notFound();
  const { driver, assignments } = data;
  const year = todayIso().slice(0, 4);
  const range = { from: `${year}-01-01`, to: `${year}-12-31` };
  const [t, lk, events] = await Promise.all([
    totals({ ...range, driverId: id }),
    lookups(),
    entityHistory([{ entity: "driver", id }, ...assignments.map((a) => ({ entity: "driver_assignment", id: a.a.id }))]),
  ]);
  const editor = can(user, "editor");
  const open = assignments.filter((a) => !a.a.endedOn);

  return (
    <>
      <Link href="/conductores" className="mb-3 inline-flex items-center gap-1 text-[14px] text-accent"><ChevronLeft className="size-4" />Conductores</Link>
      <PageHeader
        eyebrow={`Conductor · ${driver.code}`}
        title={driver.fullName}
        subtitle={<StatusBadge map={ASSET_STATUS} value={driver.status} />}
        actions={editor && <DriverDialog driver={driver} />}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <KeyValue
            items={[
              { label: "Identificador", value: driver.code },
              { label: "Teléfono", value: driver.phone },
              { label: "Inicio", value: driver.startedOn && formatDate(driver.startedOn) },
              { label: "Finalización", value: driver.endedOn && formatDate(driver.endedOn) },
            ]}
          />
        </Card>
        <Card className="p-5">
          <div className="text-[13px] text-text-2">Movimientos asociados {year}</div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div><div className="text-[12px] text-text-3">Ingresos</div><div className="display text-[20px] font-semibold"><Money cents={t.income} /></div></div>
            <div><div className="text-[12px] text-text-3">Gastos</div><div className="display text-[20px] font-semibold"><Money cents={t.expense} /></div></div>
          </div>
          <p className="mt-3 text-[12px] text-text-3">Las liquidaciones con conductores se configurarán con las reglas reales del negocio.</p>
        </Card>
        <Card>
          <CardHeader title="Licencias actuales" action={editor && <AssignDriverDialog driverId={id} licenses={lk.licenses.filter((l) => !open.some((o) => o.a.licenseId === l.id))} drivers={lk.drivers} />} />
          <div className="px-5 pb-4">
            {open.length === 0 ? <p className="pb-2 text-[14px] text-text-3">Sin licencia asignada.</p> : (
              <ul className="divide-y divide-line">
                {open.map((a) => (
                  <li key={a.a.id} className="flex items-center justify-between py-2">
                    <div>
                      <Link href={`/licencias/${a.a.licenseId}`} className="font-medium hover:text-accent">{a.number}</Link>
                      <div className="text-[12px] text-text-2">desde {formatDate(a.a.startedOn)}</div>
                    </div>
                    {editor && <EndDialog id={a.a.id} kind="assignment" label={`Finalizar la asignación a ${a.number}`} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Historial de asignaciones" />
          {assignments.length === 0 ? <EmptyState title="Sin asignaciones" /> : (
            <Table>
              <thead><tr><Th>Licencia</Th><Th>Desde</Th><Th>Hasta</Th></tr></thead>
              <tbody>
                {assignments.map((a) => (
                  <Tr key={a.a.id}>
                    <Td className="font-medium">{a.number}{a.a.role && <div className="text-[12px] font-normal text-text-2">{a.a.role}</div>}</Td>
                    <Td className="tabular text-text-2">{formatDate(a.a.startedOn)}</Td>
                    <Td>{a.a.endedOn ? <span className="tabular text-text-2">{formatDate(a.a.endedOn)}</span> : <Badge tone="positive" dot>Vigente</Badge>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <HistoryCard events={events} />
      </div>
      <div className="mt-4"><MovementsCard filter={{ ...range, driverId: id }} title={`Movimientos ${year}`} moreHref={`/movimientos?driver=${id}&y=${year}&m=0`} /></div>
    </>
  );
}
