import { BadgeCheck } from "lucide-react";
import { requireUser, can } from "@/lib/auth/session";
import { licenseList } from "@/lib/fleet";
import { formatDate } from "@/lib/format";
import { one, type SP } from "@/lib/period";
import { ASSET_STATUS, Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { RowLinks, SearchInput, SegmentedLinks } from "@/components/client";
import { LicenseDialog } from "@/components/fleet-forms";

export const metadata = { title: "Licencias" };

export default async function LicensesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const status = one(sp, "estado");
  const rows = await licenseList(one(sp, "q"), status);

  return (
    <>
      <PageHeader title="Licencias" subtitle="Cada licencia con su vehículo y conductores vigentes. Los cambios conservan el historial." actions={can(user, "editor") && <LicenseDialog />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedLinks name="estado" options={[{ value: "", label: "Todas" }, { value: "active", label: "Activas" }, { value: "inactive", label: "Inactivas" }, { value: "retired", label: "Baja" }]} />
        <div className="ml-auto w-full sm:w-auto"><SearchInput placeholder="Buscar licencia" /></div>
      </div>
      <Card className="animate-in">
        {rows.length === 0 ? (
          <EmptyState icon={<BadgeCheck className="size-5" />} title={status || one(sp, "q") ? "Sin resultados" : "Aún no hay licencias"}>
            {status || one(sp, "q") ? "Prueba con otros filtros." : "Da de alta las licencias para asociarles vehículos, conductores y movimientos."}
          </EmptyState>
        ) : (
          <RowLinks>
            <Table>
              <thead>
                <tr><Th>Licencia</Th><Th>Vehículo</Th><Th className="hidden md:table-cell">Conductores</Th><Th className="hidden lg:table-cell">Incorporación</Th><Th>Estado</Th></tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <Tr key={l.id} href={`/licencias/${l.id}`}>
                    <Td className="font-semibold">{l.number}</Td>
                    <Td>
                      {l.vehicle ? (
                        <>
                          <div className="font-medium tabular">{l.vehicle.plate}</div>
                          <div className="text-[12px] text-text-2">{[l.vehicle.make, l.vehicle.model].filter(Boolean).join(" ") || "—"}</div>
                        </>
                      ) : <span className="text-text-3">Sin vehículo</span>}
                    </Td>
                    <Td className="hidden md:table-cell">
                      {l.drivers.length ? l.drivers.map((d) => d.name).join(", ") : <span className="text-text-3">Sin conductor</span>}
                    </Td>
                    <Td className="hidden text-text-2 lg:table-cell">{formatDate(l.acquiredOn)}</Td>
                    <Td><StatusBadge map={ASSET_STATUS} value={l.status} /></Td>
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
