import "server-only";
import { and, desc, eq, isNull, ne, sql, inArray, lte, or, gte } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db";
import { audit, diff } from "@/lib/audit";
import { getStorage, sha256, storageKeyFor } from "@/lib/storage";
import { getExtractionProvider, ExtractionError, type ExtractionResult } from "@/lib/extraction";
import { getSettings } from "@/lib/settings";
import { foldText, normalizeLicense, normalizePlate, normalizeTaxId, parseMoneyToCents } from "@/lib/format";
import { prepareUpload, toExtractionPayload, UploadError } from "./files";
import { validateInvoice, type InvoiceDraft, type DraftLine, type ValidationReport } from "./validate";
import type { CurrentUser } from "@/lib/auth/session";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export class InvoiceError extends Error {}

/* ───────────────────────────── Subida ───────────────────────────── */

export async function createInvoiceFromUpload(files: { name: string; data: Buffer }[], user: CurrentUser) {
  const doc = await prepareUpload(files);
  const hash = sha256(doc.data);
  const db = await getDb();

  // Duplicado exacto: el mismo archivo ya se subió.
  const [existing] = await db
    .select({ invoiceId: schema.invoices.id, status: schema.invoices.status })
    .from(schema.documents)
    .innerJoin(schema.invoices, eq(schema.invoices.documentId, schema.documents.id))
    .where(eq(schema.documents.sha256, hash))
    .limit(1);
  if (existing) return { invoiceId: existing.invoiceId, duplicate: true as const };

  const key = storageKeyFor(hash, doc.ext);
  await getStorage().put(key, doc.data);

  const invoiceId = await db.transaction(async (tx) => {
    const [d] = await tx
      .insert(schema.documents)
      .values({ sha256: hash, originalName: doc.name, mimeType: doc.mime, sizeBytes: doc.data.length, pageCount: doc.pageCount, storageKey: key, uploadedBy: user.id })
      .returning();
    const [inv] = await tx.insert(schema.invoices).values({ documentId: d.id, status: "uploaded", createdBy: user.id }).returning();
    await audit(tx, { entity: "invoice", entityId: inv.id, action: "upload", userId: user.id, after: { document: doc.name, pages: doc.pageCount, sha256: hash }, summary: `Documento subido: ${doc.name}` });
    return inv.id;
  });
  return { invoiceId, duplicate: false as const };
}

export { UploadError };

/* ─────────────────────────── Reconocimiento ─────────────────────────── */

const STALE_MS = 10 * 60 * 1000;

export async function runExtraction(invoiceId: string, user: CurrentUser) {
  const db = await getDb();
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!inv) throw new InvoiceError("Factura no encontrada.");
  if (inv.status === "confirmed") throw new InvoiceError("La factura ya está confirmada. Reábrela para volver a procesarla.");
  if (inv.status === "processing" && Date.now() - inv.updatedAt.getTime() < STALE_MS) {
    throw new InvoiceError("El documento ya se está procesando.");
  }

  const provider = getExtractionProvider();
  const configError = provider ? provider.configurationError() : "No hay proveedor de reconocimiento configurado.";

  const [run] = await db
    .insert(schema.extractionRuns)
    .values({ invoiceId, provider: provider?.id ?? "none", status: "running", triggeredBy: user.id })
    .returning();

  if (!provider || configError) {
    await finishRunFailed(run.id, invoiceId, configError ?? "Proveedor no disponible", user);
    return { ok: false as const, error: configError ?? "Proveedor no disponible" };
  }

  await db.update(schema.invoices).set({ status: "processing", updatedAt: new Date() }).where(eq(schema.invoices.id, invoiceId));

  try {
    const [document] = await db.select().from(schema.documents).where(eq(schema.documents.id, inv.documentId));
    const original = await getStorage().get(document.storageKey);
    const payload = await toExtractionPayload(original, document.mimeType);
    const settings = await getSettings();
    const [plates, lics, drivers] = await Promise.all([
      db.select({ plate: schema.vehicles.plate }).from(schema.vehicles),
      db.select({ number: schema.licenses.number }).from(schema.licenses),
      db.select({ name: schema.drivers.fullName }).from(schema.drivers),
    ]);

    const out = await provider.extract({
      ...payload,
      context: {
        ownerName: settings.owner.name,
        ownerTaxId: settings.owner.taxId,
        knownPlates: plates.map((p) => p.plate),
        knownLicenses: lics.map((l) => l.number),
        knownDrivers: drivers.map((d) => d.name),
        extraInstructions: settings.extraction.extraInstructions,
      },
    });

    await db
      .update(schema.extractionRuns)
      .set({ status: "succeeded", model: out.model, output: out.result, inputTokens: out.usage?.inputTokens, outputTokens: out.usage?.outputTokens, finishedAt: new Date() })
      .where(eq(schema.extractionRuns.id, run.id));

    await applyExtraction(invoiceId, out.result, user, settings.owner.taxId, settings.extraction.lowConfidenceThreshold);
    return { ok: true as const };
  } catch (e) {
    const msg = e instanceof ExtractionError || e instanceof UploadError ? e.message : "Error inesperado al procesar el documento.";
    if (!(e instanceof ExtractionError)) console.error("[extraction]", e);
    await finishRunFailed(run.id, invoiceId, msg, user);
    return { ok: false as const, error: msg };
  }
}

async function finishRunFailed(runId: string, invoiceId: string, error: string, user: CurrentUser) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(schema.extractionRuns).set({ status: "failed", error, finishedAt: new Date() }).where(eq(schema.extractionRuns.id, runId));
    const [inv] = await tx.select({ status: schema.invoices.status }).from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    // Si ya había datos en revisión, no se pierden: sólo se marca como fallida una factura sin datos.
    if (inv && (inv.status === "uploaded" || inv.status === "processing" || inv.status === "failed")) {
      await tx.update(schema.invoices).set({ status: "failed", updatedAt: new Date() }).where(eq(schema.invoices.id, invoiceId));
    }
    await audit(tx, { entity: "invoice", entityId: invoiceId, action: "extraction_failed", userId: user.id, after: { error }, summary: `Reconocimiento fallido: ${error}` });
  });
}

/** Vuelca la extracción en la factura (como borrador pendiente de revisión). */
async function applyExtraction(invoiceId: string, r: ExtractionResult, user: CurrentUser, ownerTaxId: string | null, threshold: number) {
  const db = await getDb();
  const owner = normalizeTaxId(ownerTaxId);
  const issuerTax = normalizeTaxId(r.issuer.taxId.value);
  const recipientTax = normalizeTaxId(r.recipient.taxId.value);
  const direction: "received" | "issued" | "unknown" =
    owner && issuerTax === owner ? "issued" : owner && recipientTax === owner ? "received" : "unknown";
  const party = direction === "issued" ? r.recipient : r.issuer;

  const money = (v: number | null) => (v === null ? null : Math.round(v * 100));
  const fieldConfidence: Record<string, number> = {
    documentType: r.documentType.confidence,
    counterpartyName: party.name.confidence,
    counterpartyTaxId: party.taxId.confidence,
    invoiceNumber: r.invoiceNumber.confidence,
    issueDate: r.issueDate.confidence,
    dueDate: r.dueDate.confidence,
    periodStart: r.periodStart.confidence,
    periodEnd: r.periodEnd.confidence,
    currency: r.currency.confidence,
    subtotalCents: r.subtotal.confidence,
    taxCents: r.taxTotal.confidence,
    withholdingCents: r.withholding.confidence,
    totalCents: r.total.confidence,
  };
  // Un campo vacío no tiene "confianza baja": simplemente no se encontró.
  const values: Record<string, unknown> = {
    documentType: r.documentType.value, counterpartyName: party.name.value, counterpartyTaxId: party.taxId.value,
    invoiceNumber: r.invoiceNumber.value, issueDate: r.issueDate.value, dueDate: r.dueDate.value,
    periodStart: r.periodStart.value, periodEnd: r.periodEnd.value, currency: r.currency.value,
    subtotalCents: r.subtotal.value, taxCents: r.taxTotal.value, withholdingCents: r.withholding.value, totalCents: r.total.value,
  };
  for (const k of Object.keys(fieldConfidence)) if (values[k] === null) delete fieldConfidence[k];

  const matcher = await buildMatcher();
  const docPlate = r.identifiers.plates.length === 1 ? r.identifiers.plates[0] : null;
  const docLicense = r.identifiers.licenses.length === 1 ? r.identifiers.licenses[0] : null;
  const docDriver = r.identifiers.driverNames.length === 1 ? r.identifiers.driverNames[0] : null;
  const issueDate = r.issueDate.value;
  const docRefs = matcher.resolve({ plate: docPlate, license: docLicense, driver: docDriver, date: issueDate });

  const counterparty = await findCounterparty(db, party.name.value, party.taxId.value);
  const cats = await db.select().from(schema.categories).where(eq(schema.categories.active, true));

  const lines = r.lines.map((l, i) => {
    const refs = matcher.resolve({ plate: l.plate, license: l.license, driver: l.driverName, date: l.serviceDate ?? issueDate });
    return {
      invoiceId,
      position: i,
      description: l.description,
      quantity: l.quantity === null ? null : String(l.quantity),
      unitPriceCents: money(l.unitPrice),
      taxRate: l.taxRate === null ? null : String(l.taxRate),
      taxCents: money(l.taxAmount),
      amountCents: money(l.amount),
      serviceDate: l.serviceDate,
      categoryId: suggestCategory(l.description, counterparty?.defaultCategoryId ?? null, cats),
      licenseId: refs.licenseId ?? docRefs.licenseId,
      vehicleId: refs.vehicleId ?? docRefs.vehicleId,
      driverId: refs.driverId ?? docRefs.driverId,
      detectedPlate: l.plate,
      detectedLicense: l.license,
      detectedDriver: l.driverName,
      confidence: String(Math.max(0, Math.min(1, l.confidence))),
    };
  });

  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    await tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId));
    if (lines.length) await tx.insert(schema.invoiceLines).values(lines);
    const patch = {
      status: "needs_review" as const,
      direction,
      documentType: r.documentType.value,
      counterpartyId: counterparty?.id ?? null,
      counterpartyName: party.name.value,
      counterpartyTaxId: normalizeTaxId(party.taxId.value),
      invoiceNumber: r.invoiceNumber.value,
      issueDate,
      dueDate: r.dueDate.value,
      periodStart: r.periodStart.value,
      periodEnd: r.periodEnd.value,
      currency: (r.currency.value ?? "EUR").toUpperCase().slice(0, 3),
      subtotalCents: money(r.subtotal.value),
      taxCents: money(r.taxTotal.value),
      withholdingCents: money(r.withholding.value),
      totalCents: money(r.total.value),
      licenseId: docRefs.licenseId,
      vehicleId: docRefs.vehicleId,
      driverId: docRefs.driverId,
      fieldConfidence,
      updatedAt: new Date(),
    };
    await tx.update(schema.invoices).set(patch).where(eq(schema.invoices.id, invoiceId));
    await audit(tx, {
      entity: "invoice", entityId: invoiceId, action: "extracted", userId: user.id,
      before: before.status === "uploaded" ? null : diff(before, patch).before, after: { ...patch, lines: lines.length },
      summary: `Datos reconocidos automáticamente (${lines.length} líneas)`,
    });
  });

  const report = await revalidate(invoiceId, threshold);
  if (!r.readable) {
    await appendIssues(invoiceId, [{ code: "unreadable", severity: "error", message: "La IA indica que el documento no es legible o no es un documento económico." }]);
  }
  if (r.warnings.length) {
    await appendIssues(invoiceId, r.warnings.map((w) => ({ code: "extractor_warning", severity: "warning" as const, message: `Aviso de lectura: ${w}` })));
  }
  return report;
}

async function appendIssues(invoiceId: string, extra: { code: string; severity: "error" | "warning" | "info"; message: string }[]) {
  const db = await getDb();
  const [inv] = await db.select({ issues: schema.invoices.issues }).from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  await db.update(schema.invoices).set({ issues: [...(inv?.issues ?? []), ...extra] }).where(eq(schema.invoices.id, invoiceId));
}

/* ─────────────────────── Vinculación con la flota ─────────────────────── */

async function buildMatcher() {
  const db = await getDb();
  const [vs, ls, ds, lv] = await Promise.all([
    db.select({ id: schema.vehicles.id, plate: schema.vehicles.plate }).from(schema.vehicles),
    db.select({ id: schema.licenses.id, number: schema.licenses.number }).from(schema.licenses),
    db.select({ id: schema.drivers.id, name: schema.drivers.fullName, code: schema.drivers.code }).from(schema.drivers),
    db.select().from(schema.licenseVehicles),
  ]);
  const byPlate = new Map(vs.map((v) => [v.plate, v.id]));
  const byLicense = new Map(ls.map((l) => [normalizeLicense(l.number)!, l.id]));
  const byDriver = new Map<string, string>();
  for (const d of ds) {
    byDriver.set(foldText(d.name), d.id);
    byDriver.set(foldText(d.code), d.id);
  }
  return {
    resolve({ plate, license, driver, date }: { plate: string | null; license: string | null; driver: string | null; date: string | null }) {
      const vehicleId = plate ? byPlate.get(normalizePlate(plate)!) ?? null : null;
      let licenseId = license ? byLicense.get(normalizeLicense(license)!) ?? null : null;
      // Licencia deducida de la matrícula según el historial de adscripciones en esa fecha (dato propio, no inventado).
      if (!licenseId && vehicleId) {
        const d = date ?? new Date().toISOString().slice(0, 10);
        const hit = lv.find((a) => a.vehicleId === vehicleId && a.startedOn <= d && (!a.endedOn || a.endedOn >= d));
        licenseId = hit?.licenseId ?? null;
      }
      // El conductor sólo se vincula si su nombre o código aparece en el documento.
      const driverId = driver ? byDriver.get(foldText(driver)) ?? null : null;
      return { vehicleId, licenseId, driverId };
    },
  };
}

function suggestCategory(description: string | null, fallback: string | null, cats: (typeof schema.categories.$inferSelect)[]) {
  const text = foldText(description);
  if (text) {
    for (const c of cats) {
      if (c.keywords.some((k) => k && text.includes(foldText(k)))) return c.id;
    }
  }
  return fallback;
}

async function findCounterparty(db: DB | Tx, name: string | null, taxId: string | null) {
  const tax = normalizeTaxId(taxId);
  if (tax) {
    const [c] = await db.select().from(schema.counterparties).where(eq(schema.counterparties.taxId, tax)).limit(1);
    if (c) return c;
  }
  if (name) {
    const [c] = await db
      .select()
      .from(schema.counterparties)
      .where(sql`lower(${schema.counterparties.name}) = ${name.trim().toLowerCase()}`)
      .limit(1);
    if (c) return c;
  }
  return null;
}

/* ─────────────────────────── Validación ─────────────────────────── */

async function draftFromDb(invoiceId: string) {
  const db = await getDb();
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!inv) throw new InvoiceError("Factura no encontrada.");
  const lines = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId)).orderBy(schema.invoiceLines.position);
  const draft: InvoiceDraft = {
    counterpartyName: inv.counterpartyName,
    counterpartyTaxId: inv.counterpartyTaxId,
    invoiceNumber: inv.invoiceNumber,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    periodStart: inv.periodStart,
    periodEnd: inv.periodEnd,
    subtotalCents: inv.subtotalCents,
    taxCents: inv.taxCents,
    withholdingCents: inv.withholdingCents,
    totalCents: inv.totalCents,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity === null ? null : Number(l.quantity),
      unitPriceCents: l.unitPriceCents,
      taxRate: l.taxRate === null ? null : Number(l.taxRate),
      taxCents: l.taxCents,
      amountCents: l.amountCents,
      serviceDate: l.serviceDate,
      categoryId: l.categoryId,
      confidence: l.confidence === null ? null : Number(l.confidence),
    })),
  };
  return { inv, draft };
}

async function validationContext(invoiceId: string, d: InvoiceDraft, fieldConfidence: Record<string, number> | null, threshold: number) {
  const db = await getDb();
  const tax = normalizeTaxId(d.counterpartyTaxId);
  const sameParty = tax
    ? eq(schema.invoices.counterpartyTaxId, tax)
    : d.counterpartyName
      ? sql`lower(${schema.invoices.counterpartyName}) = ${d.counterpartyName.trim().toLowerCase()}`
      : null;
  const base = and(ne(schema.invoices.id, invoiceId), ne(schema.invoices.status, "rejected"));

  let sameNumber: string[] = [];
  let sameDateTotal: string[] = [];
  let previous: number[] = [];
  if (sameParty) {
    if (d.invoiceNumber) {
      const rows = await db
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(and(base, sameParty, sql`upper(replace(${schema.invoices.invoiceNumber}, ' ', '')) = ${d.invoiceNumber.toUpperCase().replace(/\s/g, "")}`));
      sameNumber = rows.map((r) => r.id);
    }
    if (d.issueDate && d.totalCents !== null) {
      const rows = await db
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(and(base, sameParty, eq(schema.invoices.issueDate, d.issueDate), eq(schema.invoices.totalCents, d.totalCents)));
      sameDateTotal = rows.map((r) => r.id).filter((id) => !sameNumber.includes(id));
    }
    const prev = await db
      .select({ total: schema.invoices.totalCents })
      .from(schema.invoices)
      .where(and(ne(schema.invoices.id, invoiceId), eq(schema.invoices.status, "confirmed"), sameParty))
      .orderBy(desc(schema.invoices.issueDate))
      .limit(6);
    previous = prev.map((p) => p.total ?? 0);
  }

  let lockedPeriod = false;
  if (d.issueDate) {
    const [y, m] = d.issueDate.split("-").map(Number);
    const [lock] = await db.select().from(schema.periodLocks).where(and(eq(schema.periodLocks.year, y), eq(schema.periodLocks.month, m)));
    lockedPeriod = Boolean(lock);
  }
  return { fieldConfidence, sameNumberInvoiceIds: sameNumber, sameDateTotalInvoiceIds: sameDateTotal, previousTotalsCents: previous, lockedPeriod, lowConfidenceThreshold: threshold };
}

export async function revalidate(invoiceId: string, threshold?: number): Promise<ValidationReport> {
  const db = await getDb();
  const t = threshold ?? (await getSettings()).extraction.lowConfidenceThreshold;
  const { inv, draft } = await draftFromDb(invoiceId);
  const ctx = await validationContext(invoiceId, draft, inv.fieldConfidence ?? null, t);
  const report = validateInvoice(draft, ctx);
  await db
    .update(schema.invoices)
    .set({ issues: report.issues, possibleDuplicateOf: ctx.sameNumberInvoiceIds[0] ?? ctx.sameDateTotalInvoiceIds[0] ?? null })
    .where(eq(schema.invoices.id, invoiceId));
  return report;
}

/* ─────────────────────── Revisión y confirmación ─────────────────────── */

export type ReviewLine = DraftLine & {
  id?: string | null;
  licenseId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  detectedPlate?: string | null;
  detectedLicense?: string | null;
  detectedDriver?: string | null;
};

export type ReviewPayload = Omit<InvoiceDraft, "lines"> & {
  direction: "received" | "issued" | "unknown";
  documentType: string | null;
  currency: string;
  licenseId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  notes: string | null;
  lines: ReviewLine[];
};

/**
 * Guarda la revisión. Con `confirm`, además genera los movimientos económicos.
 * Todos los cambios respecto al estado anterior quedan en el historial.
 */
export async function saveReview(
  invoiceId: string,
  p: ReviewPayload,
  opts: { confirm: boolean; acknowledge: boolean },
  user: CurrentUser,
) {
  const db = await getDb();
  const settings = await getSettings();
  const [current] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!current) throw new InvoiceError("Factura no encontrada.");
  if (current.status === "confirmed") throw new InvoiceError("La factura está confirmada. Reábrela para modificarla.");
  if (current.status === "processing") throw new InvoiceError("Espera a que termine el reconocimiento.");

  const tax = normalizeTaxId(p.counterpartyTaxId);
  const name = p.counterpartyName?.trim() || null;

  // Validación con los datos tal y como los envía el usuario.
  const draft: InvoiceDraft = { ...p, counterpartyName: name, counterpartyTaxId: tax };
  const ctx = await validationContext(invoiceId, draft, null, settings.extraction.lowConfidenceThreshold);
  const report = validateInvoice(draft, ctx);
  if (opts.confirm) {
    if (report.blocking) throw new InvoiceError("Faltan datos obligatorios o hay datos no válidos. Revisa los campos marcados.");
    if (report.needsAcknowledgement && !opts.acknowledge) {
      throw new InvoiceError("Hay incidencias sin resolver. Corrígelas o confirma expresamente que el documento es así.");
    }
  }

  const categoryIds = [...new Set(p.lines.map((l) => l.categoryId).filter(Boolean) as string[])];
  const cats = categoryIds.length
    ? await db.select().from(schema.categories).where(inArray(schema.categories.id, categoryIds))
    : [];
  if (cats.length !== categoryIds.length) throw new InvoiceError("Alguna categoría seleccionada ya no existe.");

  await db.transaction(async (tx) => {
    let counterparty = await findCounterparty(tx, name, tax);
    if (!counterparty && name && opts.confirm) {
      [counterparty] = await tx.insert(schema.counterparties).values({ name, taxId: tax }).returning();
      await audit(tx, { entity: "counterparty", entityId: counterparty.id, action: "create", userId: user.id, after: counterparty, summary: `Alta automática de ${name}` });
    }

    const patch = {
      direction: p.direction,
      documentType: p.documentType?.trim() || null,
      counterpartyId: counterparty?.id ?? null,
      counterpartyName: name,
      counterpartyTaxId: tax,
      invoiceNumber: p.invoiceNumber?.trim() || null,
      issueDate: p.issueDate || null,
      dueDate: p.dueDate || null,
      periodStart: p.periodStart || null,
      periodEnd: p.periodEnd || null,
      currency: (p.currency || "EUR").toUpperCase().slice(0, 3),
      subtotalCents: p.subtotalCents,
      taxCents: p.taxCents,
      withholdingCents: p.withholdingCents,
      totalCents: p.totalCents,
      licenseId: p.licenseId,
      vehicleId: p.vehicleId,
      driverId: p.driverId,
      notes: p.notes?.trim() || null,
      issues: report.issues,
      possibleDuplicateOf: ctx.sameNumberInvoiceIds[0] ?? ctx.sameDateTotalInvoiceIds[0] ?? null,
      status: (opts.confirm ? "confirmed" : "needs_review") as "confirmed" | "needs_review",
      confirmedBy: opts.confirm ? user.id : null,
      confirmedAt: opts.confirm ? new Date() : null,
      updatedAt: new Date(),
    };
    const changes = diff(current as unknown as Record<string, unknown>, patch);

    const prevLines = await tx.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId)).orderBy(schema.invoiceLines.position);
    const newLines = p.lines.map((l, i) => ({
      invoiceId,
      position: i,
      description: l.description?.trim() || null,
      quantity: l.quantity === null ? null : String(l.quantity),
      unitPriceCents: l.unitPriceCents,
      taxRate: l.taxRate === null ? null : String(l.taxRate),
      taxCents: l.taxCents,
      amountCents: l.amountCents,
      serviceDate: l.serviceDate || null,
      categoryId: l.categoryId,
      licenseId: l.licenseId,
      vehicleId: l.vehicleId,
      driverId: l.driverId,
      detectedPlate: l.detectedPlate ?? null,
      detectedLicense: l.detectedLicense ?? null,
      detectedDriver: l.detectedDriver ?? null,
      confidence: l.confidence === null || l.confidence === undefined ? null : String(l.confidence),
    }));
    const strip = (ls: Record<string, unknown>[]) => ls.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== "id" && k !== "invoiceId")));
    const linesChanged = JSON.stringify(strip(prevLines as never)) !== JSON.stringify(strip(newLines as never));

    // Las líneas anteriores pueden estar referenciadas por movimientos anulados: se desvinculan, no se pierden.
    await tx.update(schema.movements).set({ invoiceLineId: null }).where(eq(schema.movements.invoiceId, invoiceId));
    await tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId));
    const inserted = newLines.length ? await tx.insert(schema.invoiceLines).values(newLines).returning() : [];
    await tx.update(schema.invoices).set(patch).where(eq(schema.invoices.id, invoiceId));

    if (changes.changed || linesChanged) {
      await audit(tx, {
        entity: "invoice", entityId: invoiceId, action: "review", userId: user.id,
        before: { ...changes.before, ...(linesChanged ? { lines: prevLines } : {}) },
        after: { ...changes.after, ...(linesChanged ? { lines: newLines } : {}) },
        summary: opts.confirm ? "Revisada y confirmada" : "Revisión guardada",
      });
    }

    if (opts.confirm) {
      const kindById = new Map(cats.map((c) => [c.id, c]));
      const rows = inserted.map((l) => {
        const gross = l.taxCents !== null
          ? (l.amountCents ?? 0) + l.taxCents
          : l.taxRate !== null
            ? Math.round((l.amountCents ?? 0) * (1 + Number(l.taxRate) / 100))
            : (l.amountCents ?? 0);
        return {
          occurredOn: l.serviceDate ?? patch.issueDate!,
          categoryId: l.categoryId!,
          amountCents: settings.accounting.movementAmountBasis === "gross" ? gross : (l.amountCents ?? 0),
          description: [patch.counterpartyName, l.description].filter(Boolean).join(" · ").slice(0, 500),
          licenseId: l.licenseId ?? patch.licenseId,
          vehicleId: l.vehicleId ?? patch.vehicleId,
          driverId: l.driverId ?? patch.driverId,
          counterpartyId: patch.counterpartyId,
          invoiceId,
          invoiceLineId: l.id,
          source: "invoice" as const,
          createdBy: user.id,
        };
      });
      await assertPeriodsOpen(tx, rows.map((r) => r.occurredOn));
      const created = rows.length ? await tx.insert(schema.movements).values(rows).returning() : [];
      await audit(tx, {
        entity: "invoice", entityId: invoiceId, action: "confirm", userId: user.id,
        after: { movements: created.map((m) => ({ id: m.id, amountCents: m.amountCents, category: kindById.get(m.categoryId)?.name })), acknowledgedIssues: opts.acknowledge ? report.issues.filter((i) => i.severity === "error").map((i) => i.message) : [] },
        summary: `Importada: ${created.length} movimiento(s) generado(s)`,
      });
    }
  });

  return report;
}

export async function assertPeriodsOpen(tx: Tx | DB, dates: string[]) {
  const months = [...new Set(dates.filter(Boolean).map((d) => d.slice(0, 7)))];
  for (const ym of months) {
    const [y, m] = ym.split("-").map(Number);
    const [lock] = await tx.select().from(schema.periodLocks).where(and(eq(schema.periodLocks.year, y), eq(schema.periodLocks.month, m)));
    if (lock) throw new InvoiceError(`El periodo ${String(m).padStart(2, "0")}/${y} está cerrado.`);
  }
}

/** Reabre una factura confirmada: anula (no borra) sus movimientos. */
export async function reopenInvoice(invoiceId: string, reason: string, user: CurrentUser) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    if (!inv || inv.status !== "confirmed") throw new InvoiceError("Sólo se pueden reabrir facturas confirmadas.");
    const active = await tx.select().from(schema.movements).where(and(eq(schema.movements.invoiceId, invoiceId), isNull(schema.movements.voidedAt)));
    await assertPeriodsOpen(tx, active.map((m) => m.occurredOn));
    await tx
      .update(schema.movements)
      .set({ voidedAt: new Date(), voidReason: `Factura reabierta: ${reason}`, updatedAt: new Date() })
      .where(and(eq(schema.movements.invoiceId, invoiceId), isNull(schema.movements.voidedAt)));
    await tx.update(schema.invoices).set({ status: "needs_review", confirmedAt: null, confirmedBy: null, updatedAt: new Date() }).where(eq(schema.invoices.id, invoiceId));
    await audit(tx, { entity: "invoice", entityId: invoiceId, action: "reopen", userId: user.id, before: { status: "confirmed", movements: active.map((m) => m.id) }, after: { status: "needs_review" }, summary: `Reabierta: ${reason}` });
  });
}

export async function rejectInvoice(invoiceId: string, reason: string, user: CurrentUser) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    if (!inv) throw new InvoiceError("Factura no encontrada.");
    if (inv.status === "confirmed") throw new InvoiceError("Reabre la factura antes de descartarla.");
    await tx.update(schema.invoices).set({ status: "rejected", notes: [inv.notes, `Descartada: ${reason}`].filter(Boolean).join("\n"), updatedAt: new Date() }).where(eq(schema.invoices.id, invoiceId));
    await audit(tx, { entity: "invoice", entityId: invoiceId, action: "reject", userId: user.id, before: { status: inv.status }, after: { status: "rejected" }, summary: `Descartada: ${reason}` });
  });
}

export async function restoreInvoice(invoiceId: string, user: CurrentUser) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    if (!inv || inv.status !== "rejected") throw new InvoiceError("Sólo se pueden recuperar facturas descartadas.");
    const [lines] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId));
    const status = lines.n > 0 || inv.totalCents !== null ? "needs_review" : "uploaded";
    await tx.update(schema.invoices).set({ status, updatedAt: new Date() }).where(eq(schema.invoices.id, invoiceId));
    await audit(tx, { entity: "invoice", entityId: invoiceId, action: "restore", userId: user.id, before: { status: "rejected" }, after: { status }, summary: "Recuperada" });
  });
}

/** Facturas de un emisor en una ventana de fechas (para el panel de comparación). */
export async function relatedInvoices(invoiceId: string) {
  const db = await getDb();
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!inv || (!inv.counterpartyTaxId && !inv.counterpartyName)) return [];
  const sameParty = inv.counterpartyTaxId
    ? eq(schema.invoices.counterpartyTaxId, inv.counterpartyTaxId)
    : sql`lower(${schema.invoices.counterpartyName}) = ${inv.counterpartyName!.toLowerCase()}`;
  const window = inv.issueDate
    ? or(isNull(schema.invoices.issueDate), and(gte(schema.invoices.issueDate, shift(inv.issueDate, -400)), lte(schema.invoices.issueDate, shift(inv.issueDate, 60))))
    : undefined;
  return db
    .select({ id: schema.invoices.id, number: schema.invoices.invoiceNumber, date: schema.invoices.issueDate, total: schema.invoices.totalCents, status: schema.invoices.status })
    .from(schema.invoices)
    .where(and(ne(schema.invoices.id, invoiceId), ne(schema.invoices.status, "rejected"), sameParty, window))
    .orderBy(desc(schema.invoices.issueDate))
    .limit(8);
}

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export { parseMoneyToCents };
