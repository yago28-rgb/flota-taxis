/**
 * Catálogo de campos exportables por conjunto de datos. Las plantillas de exportación
 * (que imitan el Excel actual del titular) eligen columnas de este catálogo, con el
 * encabezado y el orden que se quiera.
 */
export type FieldType = "text" | "date" | "money" | "number" | "percent";
export type FieldDef = { key: string; label: string; type: FieldType; aliases?: string[] };

export const DATASETS = {
  movements: "Movimientos",
  invoices: "Facturas",
  invoice_lines: "Líneas de factura",
  drivers: "Conductores",
  licenses: "Licencias y vehículos",
} as const;
export type Dataset = keyof typeof DATASETS;

export const FIELDS: Record<Dataset, FieldDef[]> = {
  movements: [
    { key: "date", label: "Fecha", type: "date", aliases: ["fecha", "dia", "día"] },
    { key: "year", label: "Año", type: "number", aliases: ["año", "ano", "ejercicio"] },
    { key: "month", label: "Mes", type: "number", aliases: ["mes"] },
    { key: "category", label: "Concepto / categoría", type: "text", aliases: ["concepto", "categoria", "categoría", "tipo de gasto"] },
    { key: "kind", label: "Naturaleza", type: "text", aliases: ["tipo", "naturaleza", "ingreso/gasto"] },
    { key: "amount", label: "Importe", type: "money", aliases: ["importe", "cantidad", "euros", "€"] },
    { key: "signedAmount", label: "Importe con signo (+ ingreso, − gasto)", type: "money", aliases: ["saldo", "neto"] },
    { key: "income", label: "Ingreso", type: "money", aliases: ["ingreso", "ingresos", "entrada", "haber"] },
    { key: "expense", label: "Gasto", type: "money", aliases: ["gasto", "gastos", "salida", "debe"] },
    { key: "description", label: "Descripción", type: "text", aliases: ["descripcion", "descripción", "detalle", "observaciones"] },
    { key: "license", label: "Licencia", type: "text", aliases: ["licencia", "nº licencia", "num licencia"] },
    { key: "plate", label: "Matrícula", type: "text", aliases: ["matricula", "matrícula", "vehiculo", "vehículo", "coche"] },
    { key: "driver", label: "Conductor", type: "text", aliases: ["conductor", "chofer", "chófer", "asalariado"] },
    { key: "driverCode", label: "Código conductor", type: "text", aliases: ["codigo conductor", "id conductor"] },
    { key: "counterparty", label: "Proveedor / cliente", type: "text", aliases: ["proveedor", "empresa", "emisor", "cliente"] },
    { key: "invoiceNumber", label: "Nº factura", type: "text", aliases: ["factura", "nº factura", "numero factura", "número factura"] },
    { key: "source", label: "Origen", type: "text", aliases: ["origen"] },
    { key: "status", label: "Estado", type: "text", aliases: ["estado"] },
  ],
  invoices: [
    { key: "issueDate", label: "Fecha factura", type: "date", aliases: ["fecha", "fecha factura", "fecha emision"] },
    { key: "invoiceNumber", label: "Nº factura", type: "text", aliases: ["factura", "numero", "número", "nº"] },
    { key: "counterparty", label: "Proveedor / cliente", type: "text", aliases: ["proveedor", "emisor", "empresa", "cliente"] },
    { key: "taxId", label: "NIF/CIF", type: "text", aliases: ["nif", "cif", "nif/cif"] },
    { key: "direction", label: "Tipo (recibida/emitida)", type: "text", aliases: ["tipo"] },
    { key: "documentType", label: "Documento", type: "text", aliases: ["documento"] },
    { key: "periodStart", label: "Periodo desde", type: "date" },
    { key: "periodEnd", label: "Periodo hasta", type: "date" },
    { key: "dueDate", label: "Vencimiento", type: "date", aliases: ["vencimiento"] },
    { key: "subtotal", label: "Base imponible", type: "money", aliases: ["base", "base imponible"] },
    { key: "tax", label: "Impuestos", type: "money", aliases: ["iva", "cuota", "impuestos"] },
    { key: "withholding", label: "Retenciones", type: "money", aliases: ["irpf", "retencion", "retención"] },
    { key: "total", label: "Total", type: "money", aliases: ["total", "importe total"] },
    { key: "license", label: "Licencia", type: "text", aliases: ["licencia"] },
    { key: "plate", label: "Matrícula", type: "text", aliases: ["matricula", "matrícula"] },
    { key: "driver", label: "Conductor", type: "text", aliases: ["conductor"] },
    { key: "status", label: "Estado", type: "text", aliases: ["estado"] },
    { key: "confirmedAt", label: "Confirmada el", type: "date" },
    { key: "document", label: "Documento original", type: "text" },
  ],
  invoice_lines: [
    { key: "issueDate", label: "Fecha factura", type: "date", aliases: ["fecha"] },
    { key: "invoiceNumber", label: "Nº factura", type: "text", aliases: ["factura", "nº factura"] },
    { key: "counterparty", label: "Proveedor / cliente", type: "text", aliases: ["proveedor", "emisor"] },
    { key: "description", label: "Concepto de línea", type: "text", aliases: ["concepto", "descripcion", "descripción"] },
    { key: "category", label: "Categoría", type: "text", aliases: ["categoria", "categoría"] },
    { key: "quantity", label: "Cantidad", type: "number", aliases: ["cantidad", "unidades", "litros"] },
    { key: "unitPrice", label: "Precio unitario", type: "money", aliases: ["precio", "precio unitario"] },
    { key: "taxRate", label: "% IVA", type: "percent", aliases: ["% iva", "tipo iva"] },
    { key: "tax", label: "Cuota IVA", type: "money", aliases: ["iva", "cuota"] },
    { key: "amount", label: "Importe", type: "money", aliases: ["importe"] },
    { key: "license", label: "Licencia", type: "text", aliases: ["licencia"] },
    { key: "plate", label: "Matrícula", type: "text", aliases: ["matricula", "matrícula"] },
    { key: "driver", label: "Conductor", type: "text", aliases: ["conductor"] },
  ],
  drivers: [
    { key: "code", label: "Código", type: "text", aliases: ["codigo", "código", "id"] },
    { key: "name", label: "Nombre", type: "text", aliases: ["nombre", "conductor"] },
    { key: "phone", label: "Teléfono", type: "text", aliases: ["telefono", "teléfono", "movil", "móvil"] },
    { key: "status", label: "Estado", type: "text", aliases: ["estado"] },
    { key: "startedOn", label: "Fecha de inicio", type: "date", aliases: ["alta", "inicio"] },
    { key: "endedOn", label: "Fecha de fin", type: "date", aliases: ["baja", "fin"] },
    { key: "licenses", label: "Licencias asignadas", type: "text", aliases: ["licencia", "licencias"] },
  ],
  licenses: [
    { key: "number", label: "Licencia", type: "text", aliases: ["licencia", "nº licencia"] },
    { key: "status", label: "Estado", type: "text", aliases: ["estado"] },
    { key: "acquiredOn", label: "Fecha de incorporación", type: "date", aliases: ["incorporacion", "incorporación", "alta"] },
    { key: "plate", label: "Matrícula actual", type: "text", aliases: ["matricula", "matrícula"] },
    { key: "make", label: "Marca", type: "text", aliases: ["marca"] },
    { key: "model", label: "Modelo", type: "text", aliases: ["modelo"] },
    { key: "drivers", label: "Conductores actuales", type: "text", aliases: ["conductor", "conductores"] },
  ],
};

const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9%€ ]/g, " ").replace(/\s+/g, " ").trim();

/** Sugiere el campo que mejor encaja con un encabezado del Excel del usuario. */
export function suggestField(dataset: Dataset, header: string): string | null {
  const h = fold(header);
  if (!h) return null;
  let best: { key: string; score: number } | null = null;
  for (const f of FIELDS[dataset]) {
    const candidates = [f.label, ...(f.aliases ?? [])].map(fold);
    for (const c of candidates) {
      const score = c === h ? 3 : h.startsWith(c) || c.startsWith(h) ? 2 : h.includes(c) || c.includes(h) ? 1 : 0;
      if (score > (best?.score ?? 0)) best = { key: f.key, score };
    }
  }
  return best?.key ?? null;
}
