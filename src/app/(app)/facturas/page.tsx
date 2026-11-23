import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { FileText, AlertTriangle, Copy } from "lucide-react";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { one, type SP } from "@/lib/period";
import { ButtonLink, Card, EmptyState, INVOICE_STATUS, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { RowLinks, SearchInput, SegmentedLinks } from "@/components/client";

export const metadata = { title: "Facturas" };

const PAGE = 50;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireUser();
  const db = await getDb();
  const i = schema.invoices;
  const estado = one(sp, "estado");
  const q = one(sp, "q");
  const page = Math.max(1, Number(one(sp, "p")) || 1);

  const statusFilter: SQL | undefined =
    estado === "pending" || !estado
      ? undefined
      : estado === "uploaded"
        ? inArray(i.status, ["uploaded", "processing"])
        : eq(i.status, estado as "confirmed");
  const pendingOnly = !estado ? inArray(i.status, ["uploaded", "processing", "needs_review", "failed"]) : undefined;
  const search = q
    ? sql`(${i.counterpartyName} ILIKE ${"%" + q.replace(/[%_]/g, "") + "%"} OR ${i.invoiceNumber} ILIKE ${"%" + q.replace(/[%_]/g, "") + "%"} OR ${schema.documents.originalName} ILIKE ${"%" + q.replace(/[%_]/g, "") + "%"})`
    : undefined;
  const where = and(statusFilter ?? pendingOnly, search);

  const [rows, counts, [{ n }]] = await Promise.all([
    db
      .select({ inv: i, doc: schema.documents.originalName, uploadedAt: schema.documents.uploadedAt, lic: schema.licenses.number })
      .from(i)
      .innerJoin(schema.documents, eq(schema.documents.id, i.documentId))
      .leftJoin(schema.licenses, eq(schema.licenses.id, i.licenseId))
      .where(where)
      .orderBy(desc(i.createdAt))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ status: i.status, n: sql<number>`count(*)::int` }).from(i).groupBy(i.status),
    db.select({ n: sql<number>`count(*)::int` }).from(i).innerJoin(schema.documents, eq(schema.documents.id, i.documentId)).where(where),
  ]);
  const c = Object.fromEntries(counts.map((r) => [r.status, r.n])) as Record<string, number>;
  const pending = (c.uploaded ?? 0) + (c.processing ?? 0) + (c.needs_review ?? 0) + (c.failed ?? 0);

  return (
    <>
      <PageHeader title="Facturas" subtitle="Documentos subidos, su lectura automática y su estado de revisión." actions={<ButtonLink href="/facturas/subir">Subir factura</ButtonLink>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedLinks
          name="estado"
          options={[
            { value: "", label: "Por atender", count: pending },
            { value: "needs_review", label: "En revisión", count: c.needs_review },
            { value: "failed", label: "Con error", count: c.failed },
            { value: "confirmed", label: "Confirmadas", count: c.confirmed },
            { value: "rejected", label: "Descartadas" },
          ]}
        />
        <div className="ml-auto w-full sm:w-auto"><SearchInput placeholder="Emisor, número o archivo" /></div>
      </div>

      <Card className="animate-in">
        {rows.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-5" />}
            title={!estado && !q ? "Todo al día" : "Sin facturas"}
            action={!estado && !q ? <ButtonLink href="/facturas/subir" size="sm">Subir factura</ButtonLink> : undefined}
          >
            {!estado && !q ? "No hay documentos pendientes de revisar." : "No hay facturas con estos filtros."}
          </EmptyState>
        ) : (
          <RowLinks>
            <Table>
              <thead>
                <tr><Th>Fecha</Th><Th>Emisor / receptor</Th><Th className="hidden md:table-cell">Nº</Th><Th className="hidden lg:table-cell">Licencia</Th><Th align="right">Total</Th><Th>Estado</Th></tr>
              </thead>
              <tbody>
                {rows.map(({ inv, doc, uploadedAt, lic }) => {
                  const errors = inv.issues.filter((x) => x.severity === "error").length;
                  const warnings = inv.issues.filter((x) => x.severity === "warning").length;
                  return (
                    <Tr key={inv.id} href={`/facturas/${inv.id}`}>
                      <Td className="whitespace-nowrap tabular text-text-2">
                        {inv.issueDate ? formatDate(inv.issueDate) : <span title="Fecha de subida">{formatDateTime(uploadedAt)}</span>}
                      </Td>
                      <Td>
                        <div className="font-medium">{inv.counterpartyName ?? <span className="text-text-3">Sin identificar</span>}</div>
                        <div className="max-w-[280px] truncate text-[12px] text-text-3">{doc}</div>
                      </Td>
                      <Td className="hidden tabular text-text-2 md:table-cell">{inv.invoiceNumber ?? "—"}</Td>
                      <Td className="hidden lg:table-cell">{lic ?? <span className="text-text-3">—</span>}</Td>
                      <Td align="right" className="font-medium"><Money cents={inv.totalCents} /></Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge map={INVOICE_STATUS} value={inv.status} />
                          {inv.status === "needs_review" && errors > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[12px] text-negative" title="Errores de validación"><AlertTriangle className="size-3.5" />{errors}</span>
                          )}
                          {inv.status === "needs_review" && !errors && warnings > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[12px] text-warning" title="Avisos"><AlertTriangle className="size-3.5" />{warnings}</span>
                          )}
                          {inv.possibleDuplicateOf && inv.status !== "confirmed" && inv.status !== "rejected" && (
                            <span className="inline-flex items-center gap-0.5 text-[12px] text-warning" title="Posible duplicado"><Copy className="size-3.5" /></span>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </RowLinks>
        )}
      </Card>
      {n > PAGE && (
        <div className="mt-4 flex items-center justify-center gap-3 text-[13px]">
          {page > 1 && <ButtonLink variant="secondary" size="sm" href={`?${new URLSearchParams({ ...(estado ? { estado } : {}), ...(q ? { q } : {}), p: String(page - 1) })}`}>Anterior</ButtonLink>}
          <span className="text-text-2">Página {page} de {Math.ceil(n / PAGE)}</span>
          {page * PAGE < n && <ButtonLink variant="secondary" size="sm" href={`?${new URLSearchParams({ ...(estado ? { estado } : {}), ...(q ? { q } : {}), p: String(page + 1) })}`}>Siguiente</ButtonLink>}
        </div>
      )}
    </>
  );
}
