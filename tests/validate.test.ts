import { describe, expect, it } from "vitest";
import { validateInvoice, type InvoiceDraft } from "@/lib/invoices/validate";

const CAT = "00000000-0000-0000-0000-000000000001";
const base = (p: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  counterpartyName: "Taller Ejemplo SL",
  counterpartyTaxId: "B12345678",
  invoiceNumber: "F-001",
  issueDate: "2026-03-10",
  dueDate: null,
  periodStart: null,
  periodEnd: null,
  subtotalCents: 10000,
  taxCents: 2100,
  withholdingCents: null,
  totalCents: 12100,
  lines: [{ description: "Cambio de aceite", quantity: 1, unitPriceCents: 10000, taxRate: 21, taxCents: 2100, amountCents: 10000, serviceDate: null, categoryId: CAT }],
  ...p,
});
const codes = (d: InvoiceDraft, ctx = {}) => validateInvoice(d, ctx).issues.map((i) => i.code);

describe("validateInvoice", () => {
  it("una factura coherente no tiene errores", () => {
    const r = validateInvoice(base());
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.blocking).toBe(false);
    expect(r.needsAcknowledgement).toBe(false);
  });

  it("los obligatorios ausentes bloquean", () => {
    const r = validateInvoice(base({ counterpartyName: null, totalCents: null }));
    expect(r.blocking).toBe(true);
    expect(r.issues.filter((i) => i.code === "required").map((i) => i.field).sort()).toEqual(["counterpartyName", "totalCents"]);
  });

  it("detecta descuadre base + impuestos ≠ total", () => {
    expect(codes(base({ totalCents: 12500 }))).toContain("total_mismatch");
  });

  it("tolera redondeos de hasta 2 céntimos", () => {
    expect(codes(base({ totalCents: 12102 }))).not.toContain("total_mismatch");
  });

  it("descuenta las retenciones", () => {
    expect(codes(base({ withholdingCents: 1500, totalCents: 10600 }))).not.toContain("total_mismatch");
  });

  it("detecta que la suma de líneas no coincide con la base", () => {
    const d = base();
    d.lines[0].amountCents = 9000;
    d.lines[0].unitPriceCents = 9000;
    expect(codes(d)).toContain("lines_mismatch");
  });

  it("detecta cantidad × precio incoherente", () => {
    const d = base();
    d.lines[0].quantity = 2;
    expect(codes(d)).toContain("line_math");
  });

  it("exige categoría en cada línea y al menos una línea", () => {
    const d = base();
    d.lines[0].categoryId = null;
    expect(codes(d)).toContain("line_no_category");
    expect(codes(base({ lines: [] }))).toContain("no_lines");
  });

  it("fechas: futura, inválida, vencimiento previo, periodo invertido", () => {
    expect(codes(base({ issueDate: "2999-01-01" }))).toContain("future_date");
    expect(codes(base({ issueDate: "2026-02-31" }))).toContain("invalid_date");
    expect(codes(base({ dueDate: "2026-03-01" }))).toContain("due_before_issue");
    expect(codes(base({ periodStart: "2026-03-01", periodEnd: "2026-02-01" }))).toContain("period_inverted");
  });

  it("duplicados por número y por fecha + total", () => {
    expect(codes(base(), { sameNumberInvoiceIds: ["x"] })).toContain("duplicate_number");
    expect(codes(base(), { sameDateTotalInvoiceIds: ["x"] })).toContain("duplicate_amount");
    expect(validateInvoice(base(), { sameNumberInvoiceIds: ["x"] }).needsAcknowledgement).toBe(true);
  });

  it("compara con el histórico del emisor", () => {
    expect(codes(base(), { previousTotalsCents: [3000, 3100, 2900] })).toContain("unusual_amount");
    expect(codes(base(), { previousTotalsCents: [12000, 12200, 11900] })).not.toContain("unusual_amount");
    expect(codes(base(), { previousTotalsCents: [3000] })).not.toContain("unusual_amount");
  });

  it("marca la lectura dudosa según el umbral", () => {
    expect(codes(base(), { fieldConfidence: { totalCents: 0.5 }, lowConfidenceThreshold: 0.75 })).toContain("low_confidence");
    expect(codes(base(), { fieldConfidence: { totalCents: 0.95 }, lowConfidenceThreshold: 0.75 })).not.toContain("low_confidence");
  });

  it("periodo cerrado", () => {
    expect(codes(base(), { lockedPeriod: true }).some((c) => c.includes("lock"))).toBe(true);
  });
});
