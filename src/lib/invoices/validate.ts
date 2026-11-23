/**
 * Validaciones automáticas de una factura (funciones puras, sin acceso a base de datos).
 *
 * Severidades:
 *  - error   → impide confirmar salvo que el usuario declare expresamente que el documento es así.
 *  - warning → requiere atención, no bloquea.
 *  - info    → aviso informativo.
 * Los campos obligatorios ausentes bloquean siempre (`blocking`).
 */
import type { ValidationIssue } from "@/db/schema";
import { isValidIsoDate, todayIso } from "@/lib/format";

export type DraftLine = {
  description: string | null;
  quantity: number | null;
  unitPriceCents: number | null;
  taxRate: number | null;
  taxCents: number | null;
  amountCents: number | null;
  serviceDate: string | null;
  categoryId: string | null;
  confidence?: number | null;
};

export type InvoiceDraft = {
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  subtotalCents: number | null;
  taxCents: number | null;
  withholdingCents: number | null;
  totalCents: number | null;
  lines: DraftLine[];
};

export type ValidationContext = {
  fieldConfidence?: Record<string, number> | null;
  /** Otras facturas (no rechazadas) del mismo emisor con el mismo número. */
  sameNumberInvoiceIds?: string[];
  /** Otras facturas del mismo emisor con misma fecha y total. */
  sameDateTotalInvoiceIds?: string[];
  /** Totales de facturas confirmadas anteriores del mismo emisor (más recientes primero). */
  previousTotalsCents?: number[];
  lockedPeriod?: boolean;
  lowConfidenceThreshold?: number;
};

export type ValidationReport = {
  issues: ValidationIssue[];
  blocking: boolean; // faltan obligatorios: no se puede confirmar
  needsAcknowledgement: boolean; // hay errores: confirmar requiere declaración expresa
};

const TOLERANCE_CENTS = 2;

export const FIELD_LABELS: Record<string, string> = {
  counterpartyName: "Emisor / receptor",
  counterpartyTaxId: "NIF/CIF",
  invoiceNumber: "Número de factura",
  issueDate: "Fecha de emisión",
  dueDate: "Fecha de vencimiento",
  periodStart: "Inicio del periodo",
  periodEnd: "Fin del periodo",
  subtotalCents: "Base imponible",
  taxCents: "Impuestos",
  withholdingCents: "Retenciones",
  totalCents: "Total",
  currency: "Moneda",
  documentType: "Tipo de documento",
};

export function validateInvoice(d: InvoiceDraft, ctx: ValidationContext = {}): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (i: ValidationIssue) => issues.push(i);
  let blocking = false;

  // ── Obligatorios
  for (const f of ["counterpartyName", "issueDate", "totalCents"] as const) {
    if (d[f] === null || d[f] === "" || d[f] === undefined) {
      blocking = true;
      add({ code: "required", severity: "error", field: f, message: `Falta un dato obligatorio: ${FIELD_LABELS[f]}.` });
    }
  }
  if (!d.invoiceNumber) {
    add({ code: "missing_number", severity: "warning", field: "invoiceNumber", message: "No hay número de factura. Sin él la detección de duplicados es menos fiable." });
  }

  // ── Fechas
  const today = todayIso();
  for (const f of ["issueDate", "dueDate", "periodStart", "periodEnd"] as const) {
    const v = d[f];
    if (v && !isValidIsoDate(v)) {
      blocking = true;
      add({ code: "invalid_date", severity: "error", field: f, message: `${FIELD_LABELS[f]} no es una fecha válida.` });
    }
  }
  if (isValidIsoDate(d.issueDate)) {
    if (d.issueDate > today) add({ code: "future_date", severity: "error", field: "issueDate", message: "La fecha de emisión es posterior a hoy." });
    if (d.issueDate < "2000-01-01") add({ code: "old_date", severity: "warning", field: "issueDate", message: "La fecha de emisión es anterior al año 2000. Revísala." });
    if (isValidIsoDate(d.dueDate) && d.dueDate < d.issueDate) {
      add({ code: "due_before_issue", severity: "warning", field: "dueDate", message: "El vencimiento es anterior a la fecha de emisión." });
    }
  }
  if (isValidIsoDate(d.periodStart) && isValidIsoDate(d.periodEnd) && d.periodEnd < d.periodStart) {
    add({ code: "period_inverted", severity: "error", field: "periodEnd", message: "El fin del periodo es anterior a su inicio." });
  }

  // ── Importes
  for (const f of ["subtotalCents", "taxCents", "withholdingCents", "totalCents"] as const) {
    const v = d[f];
    if (v !== null && !Number.isFinite(v)) {
      blocking = true;
      add({ code: "invalid_amount", severity: "error", field: f, message: `${FIELD_LABELS[f]} no es un importe válido.` });
    }
  }
  if (d.totalCents === 0) add({ code: "zero_total", severity: "warning", field: "totalCents", message: "El total es 0,00 €." });
  if (d.totalCents !== null && d.totalCents < 0) {
    add({ code: "negative_total", severity: "info", field: "totalCents", message: "Total negativo: se tratará como abono o rectificación." });
  }

  if (d.subtotalCents !== null && d.taxCents !== null && d.totalCents !== null) {
    const expected = d.subtotalCents + d.taxCents - (d.withholdingCents ?? 0);
    if (Math.abs(expected - d.totalCents) > TOLERANCE_CENTS) {
      add({
        code: "total_mismatch",
        severity: "error",
        field: "totalCents",
        message: `Base + impuestos${d.withholdingCents ? " − retenciones" : ""} = ${fmt(expected)}, pero el total indicado es ${fmt(d.totalCents)}.`,
      });
    }
  }

  // ── Líneas
  const withAmount = d.lines.filter((l) => l.amountCents !== null);
  if (withAmount.length > 0 && d.subtotalCents !== null) {
    const sum = withAmount.reduce((s, l) => s + (l.amountCents ?? 0), 0);
    const tol = TOLERANCE_CENTS + withAmount.length;
    if (Math.abs(sum - d.subtotalCents) > tol) {
      // Algunas facturas imprimen importes de línea con impuestos incluidos: comprobar contra el total.
      const matchesTotal = d.totalCents !== null && Math.abs(sum - d.totalCents) <= tol;
      add({
        code: "lines_mismatch",
        severity: matchesTotal ? "info" : "error",
        message: matchesTotal
          ? `La suma de líneas (${fmt(sum)}) coincide con el total, no con la base: las líneas parecen incluir impuestos.`
          : `La suma de las líneas (${fmt(sum)}) no coincide con la base imponible (${fmt(d.subtotalCents)}).`,
      });
    }
  }
  d.lines.forEach((l, i) => {
    const n = i + 1;
    if (l.amountCents === null) {
      add({ code: "line_no_amount", severity: "error", field: `lines.${i}.amountCents`, message: `Línea ${n}: falta el importe.` });
    }
    if (l.quantity !== null && l.unitPriceCents !== null && l.amountCents !== null) {
      const expected = Math.round(l.quantity * l.unitPriceCents);
      if (Math.abs(expected - l.amountCents) > TOLERANCE_CENTS) {
        add({ code: "line_math", severity: "warning", field: `lines.${i}.amountCents`, message: `Línea ${n}: cantidad × precio = ${fmt(expected)}, pero el importe es ${fmt(l.amountCents)}.` });
      }
    }
    if (l.serviceDate && !isValidIsoDate(l.serviceDate)) {
      blocking = true;
      add({ code: "invalid_date", severity: "error", field: `lines.${i}.serviceDate`, message: `Línea ${n}: la fecha no es válida.` });
    }
    if (!l.categoryId) {
      blocking = true;
      add({ code: "line_no_category", severity: "error", field: `lines.${i}.categoryId`, message: `Línea ${n}: asigna una categoría para poder registrar el movimiento.` });
    }
    if (l.confidence !== null && l.confidence !== undefined && l.confidence < (ctx.lowConfidenceThreshold ?? 0.7)) {
      add({ code: "low_confidence", severity: "warning", field: `lines.${i}`, message: `Línea ${n}: lectura dudosa (${Math.round(l.confidence * 100)} %).` });
    }
  });
  if (d.lines.length === 0) {
    blocking = true;
    add({ code: "no_lines", severity: "error", message: "La factura no tiene líneas. Añade al menos una para registrar el movimiento." });
  }

  // ── Confianza por campo
  const threshold = ctx.lowConfidenceThreshold ?? 0.7;
  for (const [field, conf] of Object.entries(ctx.fieldConfidence ?? {})) {
    if (conf < threshold && FIELD_LABELS[field]) {
      add({ code: "low_confidence", severity: "warning", field, message: `${FIELD_LABELS[field]}: lectura dudosa (${Math.round(conf * 100)} %). Compruébalo con el original.` });
    }
  }

  // ── Duplicados y comparación con registros anteriores
  if (ctx.sameNumberInvoiceIds?.length) {
    add({ code: "duplicate_number", severity: "error", field: "invoiceNumber", message: "Ya existe una factura de este emisor con el mismo número." });
  }
  if (ctx.sameDateTotalInvoiceIds?.length) {
    add({ code: "duplicate_amount", severity: "warning", message: "Ya existe una factura de este emisor con la misma fecha y el mismo total." });
  }
  const prev = (ctx.previousTotalsCents ?? []).filter((v) => v > 0);
  if (prev.length >= 3 && d.totalCents !== null && d.totalCents > 0) {
    const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
    if (d.totalCents > avg * 2 || d.totalCents < avg * 0.4) {
      add({
        code: "unusual_amount",
        severity: "warning",
        field: "totalCents",
        message: `Importe inusual para este emisor: la media de sus últimas ${prev.length} facturas es ${fmt(Math.round(avg))}.`,
      });
    }
  }

  if (ctx.lockedPeriod) {
    blocking = true;
    add({ code: "period_locked", severity: "error", message: "El mes de esta factura está cerrado. Ábrelo antes de confirmar." });
  }

  const needsAcknowledgement = issues.some((i) => i.severity === "error");
  return { issues, blocking, needsAcknowledgement };
}

function fmt(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}
