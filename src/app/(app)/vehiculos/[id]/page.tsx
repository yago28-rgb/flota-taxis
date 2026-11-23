import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser, can } from "@/lib/auth/session";
import { entityHistory, vehicleDetail } from "@/lib/fleet";
import { totals } from "@/lib/finance";
import { formatDate, todayIso } from "@/lib/format";
import { ASSET_STATUS, Badge, Card, CardHeader, EmptyState, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { HistoryCard, MovementsCard } from "@/components/server-parts";
import { VehicleDialog } from "@/components/fleet-forms";

export default async function VehiclePage({ params }: PageProps<"/vehiculos/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await vehicleDetail(id);
  if (!data) notFound();
  const { vehicle, history } = data;
  const year = todayIso().slice(0, 4);
  const range = { from: `${year}-01-01`, to: `${year}-12-31` };
  const [t, events] = await Promise.all([
    totals({ ...range, vehicleId: id }),
    entityHistory([{ entity: "vehicle", id }, ...history.map((h) => ({ entity: "license_vehicle", id: h.a.id }))]),
  ]);

  return (
    <>
      <Link href="/vehiculos" className="mb-3 inline-flex items-center gap-1 text-[14px] text-accent"><ChevronLeft className="size-4" />Vehículos</Link>
      <PageHeader
        eyebrow="Vehículo"
        title={<span className="tabular">{vehicle.plate}</span>}
        subtitle={<span className="inline-flex items-center gap-2"><StatusBadge map={ASSET_STATUS} value={vehicle.status} />{[vehicle.make, vehicle.model].filter(Boolean).join(" ")}</span>}
        actions={can(user, "editor") && <VehicleDialog vehicle={vehicle} />}
      />
      <div className="stagger mb-4 grid grid-cols-2 gap-4">
        <Card className="p-5"><div className="text-[13px] text-text-2">Gastos {year}</div><div className="display mt-1 text-[24px] font-semibold"><Money cents={t.expense} /></div></Card>
        <Card className="p-5"><div className="text-[13px] text-text-2">Ingresos {year}</div><div className="display mt-1 text-[24px] font-semibold"><Money cents={t.income} /></div></Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Adscripción a licencias" subtitle="Para cambiarla, hazlo desde la licencia." />
          {history.length === 0 ? <EmptyState title="Nunca adscrito" /> : (
            <Table>
              <thead><tr><Th>Licencia</Th><Th>Desde</Th><Th>Hasta</Th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <Tr key={h.a.id}>
                    <Td><Link href={`/licencias/${h.a.licenseId}`} className="font-medium hover:text-accent">{h.number}</Link></Td>
                    <Td className="tabular text-text-2">{formatDate(h.a.startedOn)}</Td>
                    <Td>{h.a.endedOn ? <span className="tabular text-text-2">{formatDate(h.a.endedOn)}</span> : <Badge tone="positive" dot>Vigente</Badge>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <HistoryCard events={events} />
      </div>
      <div className="mt-4"><MovementsCard filter={{ ...range, vehicleId: id }} title={`Movimientos ${year}`} moreHref={`/movimientos?vehicle=${id}&y=${year}&m=0`} /></div>
    </>
  );
}
