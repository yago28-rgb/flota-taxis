import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { ChevronLeft, Tags } from "lucide-react";
import { getDb, schema } from "@/db";
import { can, requireUser } from "@/lib/auth/session";
import { Badge, Card, EmptyState, KIND, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { CategoryDialog } from "@/components/finance-forms";

export const metadata = { title: "Categorías" };

export default async function CategoriesPage() {
  const user = await requireUser();
  const db = await getDb();
  const c = schema.categories;
  const rows = await db
    .select({ c, n: sql<number>`count(${schema.movements.id})::int` })
    .from(c)
    .leftJoin(schema.movements, eq(schema.movements.categoryId, c.id))
    .groupBy(c.id)
    .orderBy(asc(c.kind), asc(c.name));
  const editor = can(user, "editor");

  return (
    <>
      <Link href="/ajustes" className="mb-3 inline-flex items-center gap-1 text-[14px] text-accent"><ChevronLeft className="size-4" />Ajustes</Link>
      <PageHeader
        title="Categorías"
        subtitle="Tus conceptos de ingreso y gasto. No hay categorías predefinidas: créalas según cómo llevas hoy las cuentas."
        actions={editor && <CategoryDialog />}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Tags className="size-5" />} title="Sin categorías" action={editor && <CategoryDialog />}>
            Por ejemplo: Combustible, Taller, Seguro, Cuota emisora, Recaudación… Cada línea de factura se clasifica en una.
          </EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Nombre</Th><Th>Naturaleza</Th><Th className="hidden md:table-cell">Palabras clave</Th><Th align="right">Movimientos</Th><Th className="w-0" /></tr></thead>
            <tbody>
              {rows.map(({ c: cat, n }) => (
                <Tr key={cat.id} className={cat.active ? undefined : "opacity-55"}>
                  <Td className="font-medium">{cat.name}{!cat.active && <span className="ml-2 text-[12px] font-normal text-text-3">inactiva</span>}{cat.description && <div className="text-[12px] font-normal text-text-2">{cat.description}</div>}</Td>
                  <Td><Badge tone={KIND[cat.kind].tone}>{KIND[cat.kind].label}</Badge></Td>
                  <Td className="hidden max-w-[260px] truncate text-[13px] text-text-2 md:table-cell">{cat.keywords.join(", ") || "—"}</Td>
                  <Td align="right" className="tabular text-text-2">{n}</Td>
                  <Td>{editor && <CategoryDialog category={{ id: cat.id, name: cat.name, kind: cat.kind, description: cat.description, keywords: cat.keywords, active: cat.active }} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
