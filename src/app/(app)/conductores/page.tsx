import { Users } from "lucide-react";
import { requireUser, can } from "@/lib/auth/session";
import { driverList } from "@/lib/fleet";
import { formatDate } from "@/lib/format";
import { one, type SP } from "@/lib/period";
import { ASSET_STATUS, ButtonLink, Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { RowLinks, SearchInput, SegmentedLinks } from "@/components/client";
import { DriverDialog } from "@/components/fleet-forms";

export const metadata = { title: "Conductores" };

export default async function DriversPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const rows = await driverList(one(sp, "q"), one(sp, "estado"));

  return (
    <>
      <PageHeader
        title="Conductores"
        subtitle="Personas que trabajan con las licencias. Sólo se guardan los datos necesarios para la gestión."
        actions={
          <>
            <ButtonLink variant="secondary" href="/exportar?dataset=drivers">Exportar</ButtonLink>
            {can(user, "editor") && <DriverDialog />}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedLinks name="estado" options={[{ value: "", label: "Todos" }, { value: "active", label: "Activos" }, { value: "inactive", label: "Inactivos" }, { value: "retired", label: "Baja" }]} />
        <div className="ml-auto w-full sm:w-auto"><SearchInput placeholder="Buscar nombre o código" /></div>
      </div>
      <Card className="animate-in">
        {rows.length === 0 ? (
          <EmptyState icon={<Users className="size-5" />} title={one(sp, "q") || one(sp, "estado") ? "Sin resultados" : "Aún no hay conductores"} />
        ) : (
          <RowLinks>
            <Table>
              <thead><tr><Th>Conductor</Th><Th>Licencia</Th><Th className="hidden md:table-cell">Vehículo</Th><Th className="hidden lg:table-cell">Inicio</Th><Th>Estado</Th></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <Tr key={d.id} href={`/conductores/${d.id}`}>
                    <Td><div className="font-medium">{d.fullName}</div><div className="text-[12px] text-text-2">{d.code}</div></Td>
                    <Td>{d.licenses.length ? d.licenses.map((l) => l.number).join(", ") : <span className="text-text-3">Sin asignar</span>}</Td>
                    <Td className="hidden tabular md:table-cell">{d.plates.join(", ") || <span className="text-text-3">—</span>}</Td>
                    <Td className="hidden text-text-2 tabular lg:table-cell">{formatDate(d.startedOn)}</Td>
                    <Td><StatusBadge map={ASSET_STATUS} value={d.status} /></Td>
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
