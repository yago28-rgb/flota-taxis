import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { can, requireUser } from "@/lib/auth/session";
import { lookups } from "@/lib/finance";
import { todayIso } from "@/lib/format";
import { one, uuidParam, type SP } from "@/lib/period";
import { PageHeader } from "@/components/ui";
import { Exporter } from "./exporter";

export const metadata = { title: "Exportar" };

export default async function ExportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const db = await getDb();
  const [templates, lk] = await Promise.all([
    db.select().from(schema.exportTemplates).orderBy(desc(schema.exportTemplates.updatedAt)),
    lookups(),
  ]);
  const ds = one(sp, "dataset");
  return (
    <>
      <PageHeader title="Exportar a Excel" subtitle="Descarga los datos con formato, filtros y totales, o con la misma estructura que tu Excel actual." />
      <Exporter
        today={todayIso()}
        canEdit={can(user, "editor")}
        initial={{ dataset: ds ?? "report", license: uuidParam(sp, "license"), vehicle: uuidParam(sp, "vehicle"), driver: uuidParam(sp, "driver") }}
        templates={templates.map((t) => ({ id: t.id, name: t.name, dataset: t.dataset, sheetName: t.sheetName, includeTotals: t.includeTotals, columns: t.columns }))}
        lookups={{ licenses: lk.licenses, vehicles: lk.vehicles, drivers: lk.drivers, categories: lk.categories }}
      />
    </>
  );
}
