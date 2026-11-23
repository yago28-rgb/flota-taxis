import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Car, Users } from "lucide-react";
import { requireUser, can } from "@/lib/auth/session";
import { entityHistory, licenseDetail } from "@/lib/fleet";
import { lookups, totals } from "@/lib/finance";
import { formatDate, todayIso } from "@/lib/format";
import { ASSET_STATUS, Badge, ButtonLink, Card, CardHeader, EmptyState, KeyValue, Money, PageHeader, StatusBadge } from "@/components/ui";
import { HistoryCard, MovementsCard } from "@/components/server-parts";
import { AssignDriverDialog, AttachVehicleDialog, EndDialog, LicenseDialog, VehicleDialog } from "@/components/fleet-forms";

export default async function LicensePage({ params }: PageProps<"/licencias/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await licenseDetail(id);
  if (!data) notFound();
  const { license, vehicles, assignments } = data;
  const year = todayIso().slice(0, 4);
  const range = { from: `${year}-01-01`, to: `${year}-12-31` };
  const [t, lk, history] = await Promise.all([
    totals({ ...range, licenseId: id }),
    lookups(),
    entityHistory([{ entity: "license", id }, ...vehicles.map((v) => ({ entity: "license_vehicle", id: v.a.id })), ...assignments.map((a) => ({ entity: "driver_assignment", id: a.a.id }))]),
  ]);
  const editor = can(user, "editor");
  const current = vehicles.find((v) => !v.a.endedOn);
  const currentDrivers = assignments.filter((a) => !a.a.endedOn);
  const pastDrivers = assignments.filter((a) => a.a.endedOn);

  return (
    <>
      <Link href="/licencias" className="mb-3 inline-flex items-center gap-1 text-[14px] text-accent"><ChevronLeft className="size-4" />Licencias</Link>
      <PageHeader
        eyebrow="Licencia"
        title={license.number}
        subtitle={<span className="inline-flex items-center gap-2"><StatusBadge map={ASSET_STATUS} value={license.status} />{license.acquiredOn && <>Incorporada el {formatDate(license.acquiredOn)}</>}</span>}
        actions={
          <>
            <ButtonLink variant="secondary" size="sm" href={`/exportar?license=${id}`}>Exportar</ButtonLink>
            {editor && <LicenseDialog license={license} />}
          </>
        }
      />

      <div className="stagger mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5"><div className="text-[13px] text-text-2">Ingresos {year}</div><div className="display mt-1 text-[24px] font-semibold"><Money cents={t.income} /></div></Card>
        <Card className="p-5"><div className="text-[13px] text-text-2">Gastos {year}</div><div className="display mt-1 text-[24px] font-semibold"><Money cents={t.expense} /></div></Card>
        <Card className="p-5"><div className="text-[13px] text-text-2">Resultado {year}</div><div className={`display mt-1 text-[24px] font-semibold ${t.result < 0 ? "text-negative" : ""}`}>{t.incomeCount ? <Money cents={t.result} /> : <span className="text-text-3">—</span>}</div></Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Vehículo"
            action={editor && (
              <div className="flex gap-2">
                <VehicleDialog licenses={lk.licenses} defaultLicenseId={id} />
                <AttachVehicleDialog licenseId={id} vehicles={lk.vehicles.filter((v) => v.id !== current?.a.vehicleId)} />
              </div>
            )}
          />
          <div className="px-5 pb-5">
            {current ? (
              <Link href={`/vehiculos/${current.a.vehicleId}`} className="block rounded-2xl bg-surface-2 p-4 transition-colors hover:bg-fill-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="display text-[20px] font-semibold tabular">{current.plate}</div>
                    <div className="text-[13px] text-text-2">{[current.make, current.model].filter(Boolean).join(" ") || "Marca y modelo sin indicar"}</div>
                  </div>
                  <Badge tone="positive" dot>Desde {formatDate(current.a.startedOn)}</Badge>
                </div>
              </Link>
            ) : (
              <EmptyState icon={<Car className="size-5" />} title="Sin vehículo adscrito" />
            )}
            {vehicles.filter((v) => v.a.endedOn).length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-[12px] font-medium text-text-3">Anteriores</div>
                <ul className="divide-y divide-line text-[14px]">
                  {vehicles.filter((v) => v.a.endedOn).map((v) => (
                    <li key={v.a.id} className="flex justify-between py-2">
                      <Link href={`/vehiculos/${v.a.vehicleId}`} className="font-medium tabular hover:text-accent">{v.plate}</Link>
                      <span className="text-text-2 tabular">{formatDate(v.a.startedOn)} – {formatDate(v.a.endedOn)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {current && editor && <div className="mt-2 flex justify-end"><EndDialog id={current.a.id} kind="vehicle" label={`Finalizar la adscripción de ${current.plate}`} /></div>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Conductores" subtitle="Puede haber varios a la vez" action={editor && <AssignDriverDialog licenseId={id} licenses={lk.licenses} drivers={lk.drivers.filter((d) => !currentDrivers.some((c) => c.a.driverId === d.id))} hasCurrent={currentDrivers.length > 0} />} />
          <div className="px-5 pb-5">
            {currentDrivers.length === 0 ? (
              <EmptyState icon={<Users className="size-5" />} title="Sin conductores asignados" />
            ) : (
              <ul className="divide-y divide-line">
                {currentDrivers.map((a) => (
                  <li key={a.a.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <Link href={`/conductores/${a.a.driverId}`} className="font-medium hover:text-accent">{a.name}</Link>
                      <div className="text-[12px] text-text-2">{a.code} · desde {formatDate(a.a.startedOn)}{a.a.role && ` · ${a.a.role}`}</div>
                    </div>
                    {editor && <EndDialog id={a.a.id} kind="assignment" label={`Finalizar la asignación de ${a.name}`} />}
                  </li>
                ))}
              </ul>
            )}
            {pastDrivers.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-[12px] font-medium text-text-3">Historial de asignaciones</div>
                <KeyValue items={pastDrivers.map((a) => ({ label: a.name, value: <span className="font-normal text-text-2 tabular">{formatDate(a.a.startedOn)} – {formatDate(a.a.endedOn)}</span> }))} />
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MovementsCard filter={{ ...range, licenseId: id }} title={`Movimientos ${year}`} moreHref={`/movimientos?license=${id}&y=${year}&m=0`} />
        <HistoryCard events={history} />
      </div>
      {license.notes && (
        <Card className="mt-4 p-5"><div className="mb-1 text-[13px] font-medium text-text-2">Notas</div><p className="whitespace-pre-wrap text-[14px]">{license.notes}</p></Card>
      )}
    </>
  );
}
