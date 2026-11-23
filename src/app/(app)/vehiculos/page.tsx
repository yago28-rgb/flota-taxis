import Link from "next/link";
import { Car } from "lucide-react";
import { requireUser, can } from "@/lib/auth/session";
import { vehicleList } from "@/lib/fleet";
import { lookups } from "@/lib/finance";
import { one, type SP } from "@/lib/period";
import { ASSET_STATUS, Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { RowLinks, SearchInput } from "@/components/client";
import { VehicleDialog } from "@/components/fleet-forms";

export const metadata = { title: "Vehículos" };

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [rows, lk] = await Promise.all([vehicleList(one(sp, "q")), lookups()]);

  return (
    <>
      <PageHeader title="Vehículos" subtitle="Matrículas de la flota y la licencia a la que está adscrito cada vehículo." actions={can(user, "editor") && <VehicleDialog licenses={lk.licenses} />} />
      <div className="mb-4 flex justify-end"><SearchInput placeholder="Buscar matrícula o modelo" /></div>
      <Card className="animate-in">
        {rows.length === 0 ? (
          <EmptyState icon={<Car className="size-5" />} title={one(sp, "q") ? "Sin resultados" : "Aún no hay vehículos"}>
            Las matrículas registradas se reconocen automáticamente en las facturas.
          </EmptyState>
        ) : (
          <RowLinks>
            <Table>
              <thead><tr><Th>Matrícula</Th><Th>Marca y modelo</Th><Th>Licencia</Th><Th>Estado</Th></tr></thead>
              <tbody>
                {rows.map(({ v, licenseNumber, licenseId }) => (
                  <Tr key={v.id} href={`/vehiculos/${v.id}`}>
                    <Td className="font-semibold tabular">{v.plate}</Td>
                    <Td className="text-text-2">{[v.make, v.model].filter(Boolean).join(" ") || "—"}</Td>
                    <Td>{licenseId ? <Link href={`/licencias/${licenseId}`} className="hover:text-accent">{licenseNumber}</Link> : <span className="text-text-3">Sin adscribir</span>}</Td>
                    <Td><StatusBadge map={ASSET_STATUS} value={v.status} /></Td>
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
