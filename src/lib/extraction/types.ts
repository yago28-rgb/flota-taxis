/**
 * Contrato entre el motor de reconocimiento y la lógica de negocio.
 *
 * El motor local (ocr-engine/: PaddleOCR + reglas en Python) devuelve un `ExtractionResult`
 * que se valida con este esquema. Cualquier otro motor que se añada debe cumplir el mismo
 * contrato; la lógica de negocio nunca conoce el motor concreto.
 */
import { z } from "zod";

/** Campo extraído: valor literal del documento + confianza + texto de evidencia. */
const field = <T extends z.ZodType>(value: T) =>
  z.object({
    value: value.nullable().describe("Valor tal como aparece en el documento; null si no aparece o no es legible"),
    confidence: z.number().describe("Confianza entre 0 y 1"),
    evidence: z.string().nullable().describe("Fragmento literal del documento del que sale el valor"),
  });

const money = field(z.number().describe("Importe en unidades monetarias con decimales, p. ej. 1234.56"));
const text = field(z.string());
const isoDate = field(z.string().describe("Fecha en formato YYYY-MM-DD"));

export const extractionSchema = z.object({
  readable: z.boolean().describe("false si el documento no es legible o no es un documento económico"),
  documentType: text.describe("Tipo de documento tal como figura: factura, factura simplificada, ticket, abono, liquidación, recibo…"),
  issuer: z.object({ name: text, taxId: text }),
  recipient: z.object({ name: text, taxId: text }),
  invoiceNumber: text,
  issueDate: isoDate,
  dueDate: isoDate,
  periodStart: isoDate,
  periodEnd: isoDate,
  currency: text.describe("Código ISO 4217, p. ej. EUR"),
  subtotal: money.describe("Base imponible total"),
  taxTotal: money.describe("Cuota total de impuestos (IVA/IGIC…)"),
  withholding: money.describe("Retenciones (IRPF…) si aparecen"),
  total: money.describe("Total del documento"),
  taxBreakdown: z.array(
    z.object({
      rate: z.number().nullable(),
      base: z.number().nullable(),
      amount: z.number().nullable(),
    }),
  ),
  lines: z.array(
    z.object({
      description: z.string().nullable(),
      quantity: z.number().nullable(),
      unitPrice: z.number().nullable(),
      taxRate: z.number().nullable().describe("Porcentaje, p. ej. 21"),
      taxAmount: z.number().nullable(),
      amount: z.number().nullable().describe("Importe de la línea tal como figura (normalmente sin impuestos)"),
      serviceDate: z.string().nullable().describe("YYYY-MM-DD si la línea tiene fecha propia"),
      plate: z.string().nullable().describe("Matrícula si aparece en la línea"),
      license: z.string().nullable().describe("Número de licencia si aparece en la línea"),
      driverName: z.string().nullable().describe("Nombre de conductor si aparece en la línea"),
      confidence: z.number(),
    }),
  ),
  identifiers: z.object({
    plates: z.array(z.string()).describe("Matrículas que aparecen en el documento"),
    licenses: z.array(z.string()).describe("Números de licencia que aparecen"),
    driverNames: z.array(z.string()).describe("Nombres de conductores que aparecen"),
  }),
  pageCount: z.number().nullable(),
  warnings: z.array(z.string()).describe("Problemas de lectura: zonas ilegibles, recortes, dudas"),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;
export type ExtractedField<T> = { value: T | null; confidence: number; evidence: string | null };

export type ExtractionInput = {
  data: Buffer;
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  context: ExtractionContext;
};

/** Contexto que ayuda a reconocer identificadores. Sólo viaja al motor local de este equipo. */
export type ExtractionContext = {
  ownerName?: string | null;
  ownerTaxId?: string | null;
  knownPlates: string[];
  knownLicenses: string[];
  knownDrivers?: string[];
  extraInstructions?: string | null;
};

export type ExtractionOutput = {
  result: ExtractionResult;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export interface ExtractionProvider {
  readonly id: string;
  readonly label: string;
  /** Devuelve null si está listo, o el motivo por el que no puede usarse. */
  configurationError(): string | null;
  extract(input: ExtractionInput): Promise<ExtractionOutput>;
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
