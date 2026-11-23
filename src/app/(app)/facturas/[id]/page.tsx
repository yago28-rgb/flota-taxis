import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { getDb, schema } from "@/db";
import { can, requireUser } from "@/lib/auth/session";
import { lookups } from "@/lib/finance";
import { entityHistory } from "@/lib/fleet";
import { relatedInvoices } from "@/lib/invoices/service";
import { providerStatus, type ExtractionResult } from "@/lib/extraction";
import { getSettings } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/format";
import { Card, CardHeader, INVOICE_STATUS, Money, Notice, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { HistoryCard } from "@/components/server-parts";
import { InvoiceActions, ReviewForm, type ReviewInitial } from "./review";

export const metadata = { title: "Revisar factura" };

export default async function InvoicePage({ params, searchParams }: PageProps<"/facturas/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [row] = await db
    .select({ inv: schema.invoices, doc: schema.documents })
    .from(schema.invoices)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.invoices.documentId))
    .where(eq(schema.invoices.id, id));
  if (!row) notFound();
  const { inv, doc } = row;

  const [lines, runs, lk, related, settings, movements] = await Promise.all([
    db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id)).orderBy(asc(schema.invoiceLines.position)),
    db.select().from(schema.extractionRuns).where(eq(schema.extractionRuns.invoiceId, id)).orderBy(desc(schema.extractionRuns.startedAt)),
    lookups(),
    relatedInvoices(id),
    getSettings(),
    db
      .select({ m: schema.movements, cat: schema.categories.name, kind: schema.categories.kind })
      .from(schema.movements)
      .innerJoin(schema.categories, eq(schema.categories.id, schema.movements.categoryId))
      .where(and(eq(schema.movements.invoiceId, id), isNull(schema.movements.voidedAt))),
  ]);
  const events = await entityHistory([{ entity: "invoice", id }, { entity: "document", id: doc.id }], 30);
  const provider = await providerStatus();
  const lastRun = runs[0];
  const lastOk = runs.find((r) => r.status === "succeeded");
  const extracted = (lastOk?.output ?? null) as ExtractionResult | null;

  // Evidencia literal por campo, para mostrar de dónde sale cada valor.
  const party = inv.direction === "issued" ? extracted?.recipient : extracted?.issuer;
  const evidence: Record<string, string | null> = extracted
    ? {
        counterpartyName: party?.name.evidence ?? null,
        counterpartyTaxId: party?.taxId.evidence ?? null,
        invoiceNumber: extracted.invoiceNumber.evidence,
        issueDate: extracted.issueDate.evidence,
        dueDate: extracted.dueDate.evidence,
        periodStart: extracted.periodStart.evidence,
        periodEnd: extracted.periodEnd.evidence,
        subtotalCents: extracted.subtotal.evidence,
        taxCents: extracted.taxTotal.evidence,
        withholdingCents: extracted.withholding.evidence,
        totalCents: extracted.total.evidence,
        documentType: extracted.documentType.evidence,
      }
    : {};

  const initial: ReviewInitial = {
    direction: inv.direction,
    documentType: inv.documentType,
    counterpartyName: inv.counterpartyName,
    counterpartyTaxId: inv.counterpartyTaxId,
    invoiceNumber: inv.invoiceNumber,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    periodStart: inv.periodStart,
    periodEnd: inv.periodEnd,
    currency: inv.currency,
    subtotalCents: inv.subtotalCents,
    taxCents: inv.taxCents,
    withholdingCents: inv.withholdingCents,
    totalCents: inv.totalCents,
    licenseId: inv.licenseId,
    vehicleId: inv.vehicleId,
    driverId: inv.driverId,
    notes: inv.notes,
    lines: lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: l.quantity === null ? null : Number(l.quantity),
      unitPriceCents: l.unitPriceCents,
      taxRate: l.taxRate === null ? null : Number(l.taxRate),
      taxCents: l.taxCents,
      amountCents: l.amountCents,
      serviceDate: l.serviceDate,
      categoryId: l.categoryId,
      licenseId: l.licenseId,
      vehicleId: l.vehicleId,
      driverId: l.driverId,
      detectedPlate: l.detectedPlate,
      detectedLicense: l.detectedLicense,
      detectedDriver: l.detectedDriver,
      confidence: l.confidence === null ? null : Number(l.confidence),
    })),
  };

  const editor = can(user, "editor");
  const editable = editor && (inv.status === "needs_review" || inv.status === "uploaded" || inv.status === "failed");
  const isImage = doc.mimeType.startsWith("image/");
  const docUrl = `/api/documents/${doc.id}`;

  return (
    <>
      <Link href="/facturas" className="mb-3 inline-flex items-center gap-1 text-[14px] text-accent"><ChevronLeft className="size-4" />Facturas</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <StatusBadge map={INVOICE_STATUS} value={inv.status} />
            <span className="truncate text-[13px] text-text-3">{doc.originalName} · {doc.pageCount ?? "?"} pág. · subido {formatDateTime(doc.uploadedAt)}</span>
          </div>
          <h1 className="display text-[26px] font-semibold tracking-tight sm:text-[30px]">
            {inv.counterpartyName ?? "Factura sin identificar"}
          </h1>
          <div className="mt-0.5 text-[14px] text-text-2">
            {[inv.invoiceNumber && `Nº ${inv.invoiceNumber}`, inv.issueDate && formatDate(inv.issueDate)].filter(Boolean).join(" · ") || "Datos pendientes de revisar"}
          </div>
        </div>
        {editor && <InvoiceActions id={id} status={inv.status} providerReady={provider.ready} hasRuns={runs.length > 0} />}
      </div>

      <div className="space-y-3">
        {sp.subida && !provider.ready && (
          <Notice tone="warning" title="Documento guardado sin lectura automática">
            El reconocimiento automático no está disponible: {provider.reason} Introduce los datos manualmente, o inicia el motor (ver <Link href="/ajustes" className="font-medium underline">Ajustes</Link>) y pulsa «Leer documento».
          </Notice>
        )}
        {inv.status === "failed" && lastRun?.error && (
          <Notice tone="negative" title="No se pudo leer el documento">
            {lastRun.error} Ningún dato se ha rellenado automáticamente. Puedes reintentarlo o introducir los datos a mano.
          </Notice>
        )}
        {extracted && !extracted.readable && (
          <Notice tone="warning" title="El reconocimiento indica que el documento no es legible o no es un documento económico">Revisa el original.</Notice>
        )}
        {extracted && extracted.warnings.length > 0 && inv.status !== "confirmed" && (
          <Notice tone="warning" title="Avisos de lectura">
            <ul className="list-disc pl-4">{extracted.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </Notice>
        )}
        {inv.status === "confirmed" && (
          <Notice tone="positive" title="Factura confirmada">
            {inv.confirmedAt && `El ${formatDateTime(inv.confirmedAt)}. `}Generó {movements.length} movimiento{movements.length === 1 ? "" : "s"}. Para corregirla, reábrela: sus movimientos se anularán y quedará constancia.
          </Notice>
        )}
        {!settings.accounting.confirmedByUser && editable && (
          <Notice tone="accent" title="Regla contable sin confirmar">
            Los movimientos se crean de momento por importe {settings.accounting.movementAmountBasis === "net" ? "neto (sin IVA)" : "total (con IVA)"} de cada línea. Confírmalo o cámbialo en <Link href="/ajustes" className="font-medium underline">Ajustes</Link>.
          </Notice>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[13px]">
              <span className="font-medium">Documento original</span>
              <span className="flex gap-3">
                <a href={docUrl} target="_blank" rel="noopener" className="text-accent">Abrir</a>
                <a href={`${docUrl}?download=1`} className="text-accent">Descargar</a>
              </span>
            </div>
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={docUrl} alt="Documento original" className="max-h-[78vh] w-full bg-surface-2 object-contain" />
            ) : (
              <iframe src={docUrl} title="Documento original" className="h-[60vh] w-full bg-surface-2 lg:h-[78vh]" />
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <ReviewForm
            id={id}
            status={inv.status}
            editable={editable}
            initial={initial}
            confidence={inv.fieldConfidence ?? {}}
            evidence={evidence}
            issues={inv.issues}
            threshold={settings.extraction.lowConfidenceThreshold}
            lookups={lk}
            identifiers={extracted?.identifiers ?? null}
          />

          {movements.length > 0 && (
            <Card>
              <CardHeader title="Movimientos generados" />
              <Table>
                <thead><tr><Th>Fecha</Th><Th>Categoría</Th><Th align="right">Importe</Th></tr></thead>
                <tbody>
                  {movements.map(({ m, cat }) => (
                    <Tr key={m.id}><Td className="tabular text-text-2">{formatDate(m.occurredOn)}</Td><Td>{cat}<div className="text-[12px] text-text-3">{m.description}</div></Td><Td align="right"><Money cents={m.amountCents} /></Td></Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          {related.length > 0 && (
            <Card>
              <CardHeader title="Otras facturas de este emisor" subtitle="Para comparar importes y detectar duplicados." />
              <Table>
                <thead><tr><Th>Fecha</Th><Th>Nº</Th><Th align="right">Total</Th><Th>Estado</Th></tr></thead>
                <tbody>
                  {related.map((r) => (
                    <Tr key={r.id} className={r.id === inv.possibleDuplicateOf ? "bg-warning-soft" : undefined}>
                      <Td className="tabular text-text-2"><Link href={`/facturas/${r.id}`} className="hover:text-accent">{r.date ? formatDate(r.date) : "—"}</Link></Td>
                      <Td className="tabular">{r.number ?? "—"}</Td>
                      <Td align="right"><Money cents={r.total} /></Td>
                      <Td><StatusBadge map={INVOICE_STATUS} value={r.status} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          {runs.length > 0 && (
            <Card>
              <CardHeader title="Lecturas automáticas" subtitle="Cada lectura se conserva tal cual como evidencia." />
              <Table>
                <thead><tr><Th>Fecha</Th><Th>Motor</Th><Th>Resultado</Th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <Tr key={r.id}>
                      <Td className="whitespace-nowrap tabular text-text-2">{formatDateTime(r.startedAt)}</Td>
                      <Td className="text-[13px]">{r.model ?? r.provider}{r.inputTokens ? <div className="text-[12px] text-text-3">{r.inputTokens + (r.outputTokens ?? 0)} tokens</div> : null}</Td>
                      <Td className="text-[13px]">{r.status === "succeeded" ? "Correcta" : r.status === "running" ? "En curso" : <span className="text-negative">{r.error ?? "Error"}</span>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          <HistoryCard events={events} />
        </div>
      </div>
    </>
  );
}
