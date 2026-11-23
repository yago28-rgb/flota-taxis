import Link from "next/link";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { History } from "lucide-react";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { one, uuidParam, type SP } from "@/lib/period";
import { ButtonLink, Card, EmptyState, Input, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { FilterSelect } from "@/components/client";
import { ACTION_LABEL, ChangeList } from "@/components/server-parts";

export const metadata = { title: "Historial" };
const PAGE = 50;

const ENTITIES: Record<string, { label: string; href?: (id: string) => string }> = {
  invoice: { label: "Factura", href: (id) => `/facturas/${id}` },
  document: { label: "Documento" },
  movement: { label: "Movimiento" },
  license: { label: "Licencia", href: (id) => `/licencias/${id}` },
  vehicle: { label: "Vehículo", href: (id) => `/vehiculos/${id}` },
  license_vehicle: { label: "Licencia–vehículo" },
  driver: { label: "Conductor", href: (id) => `/conductores/${id}` },
  driver_assignment: { label: "Asignación de conductor" },
  category: { label: "Categoría" },
  period: { label: "Cierre de mes" },
  export: { label: "Exportación" },
  export_template: { label: "Plantilla de exportación" },
  setting: { label: "Ajustes" },
  user: { label: "Usuario" },
};

export default async function HistoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireUser();
  const db = await getDb();
  const a = schema.auditEvents;
  const entity = one(sp, "entity");
  const userId = uuidParam(sp, "user");
  const from = one(sp, "from");
  const to = one(sp, "to");
  const page = Math.max(1, Number(one(sp, "p")) || 1);
  const conds: (SQL | undefined)[] = [];
  if (entity && entity in ENTITIES) conds.push(eq(a.entity, entity));
  if (userId) conds.push(eq(a.userId, userId));
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) conds.push(gte(a.createdAt, new Date(`${from}T00:00:00`)));
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) conds.push(lte(a.createdAt, new Date(`${to}T23:59:59.999`)));
  const where = and(...conds);

  const [rows, [{ n }], users] = await Promise.all([
    db
      .select({ e: a, user: schema.users.name })
      .from(a)
      .leftJoin(schema.users, eq(schema.users.id, a.userId))
      .where(where)
      .orderBy(desc(a.createdAt))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ n: sql<number>`count(*)::int` }).from(a).where(where),
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).orderBy(schema.users.name),
  ]);
  const qs = (p: number) => {
    const o = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "p") o.set(k, v);
    o.set("p", String(p));
    return `?${o}`;
  };

  return (
    <>
      <PageHeader title="Historial" subtitle="Registro inalterable de todo lo que se ha creado, cambiado, confirmado, anulado o exportado, y por quién." />
      <form className="mb-4 flex flex-wrap items-center gap-2" action="/historial">
        <FilterSelect name="entity" label="Elemento" options={Object.entries(ENTITIES).map(([k, v]) => ({ value: k, label: v.label }))} />
        <FilterSelect name="user" label="Usuario" options={users.map((u) => ({ value: u.id, label: u.name }))} />
        {entity && <input type="hidden" name="entity" value={entity} />}
        {userId && <input type="hidden" name="user" value={userId} />}
        <label className="flex items-center gap-1.5 text-[13px] text-text-2">Desde <Input type="date" name="from" defaultValue={from ?? ""} className="h-8 w-auto rounded-full py-0 text-[13px]" /></label>
        <label className="flex items-center gap-1.5 text-[13px] text-text-2">Hasta <Input type="date" name="to" defaultValue={to ?? ""} className="h-8 w-auto rounded-full py-0 text-[13px]" /></label>
        <button type="submit" className="h-8 rounded-full bg-fill-2 px-3 text-[13px] font-medium hover:bg-fill">Aplicar</button>
      </form>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<History className="size-5" />} title="Sin registros">No hay eventos con estos filtros.</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Cuándo</Th><Th>Elemento</Th><Th>Qué</Th><Th className="hidden md:table-cell">Quién</Th></tr></thead>
            <tbody>
              {rows.map(({ e, user }) => {
                const ent = ENTITIES[e.entity];
                const href = ent?.href?.(e.entityId);
                return (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap align-top tabular text-text-2">{formatDateTime(e.createdAt)}</Td>
                    <Td className="align-top">{href ? <Link href={href} className="text-accent">{ent.label}</Link> : ent?.label ?? e.entity}</Td>
                    <Td className="align-top">
                      <div className="font-medium">{e.summary ?? ACTION_LABEL[e.action] ?? e.action}</div>
                      <ChangeList before={e.before} after={e.after} />
                      <div className="text-[12px] text-text-3 md:hidden">{user ?? "Sistema"}</div>
                    </Td>
                    <Td className="hidden align-top text-text-2 md:table-cell">{user ?? "Sistema"}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {n > PAGE && (
        <div className="mt-4 flex items-center justify-center gap-3 text-[13px]">
          {page > 1 && <ButtonLink variant="secondary" size="sm" href={qs(page - 1)}>Anterior</ButtonLink>}
          <span className="text-text-2">Página {page} de {Math.ceil(n / PAGE)}</span>
          {page * PAGE < n && <ButtonLink variant="secondary" size="sm" href={qs(page + 1)}>Siguiente</ButtonLink>}
        </div>
      )}
    </>
  );
}
