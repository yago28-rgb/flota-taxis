import Link from "next/link";
import { History } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";
import { listMovements, type FinanceFilter } from "@/lib/finance";
import { Badge, Card, CardHeader, EmptyState, KIND, Money, Table, Td, Th, Tr } from "./ui";
import { RowLinks } from "./client";

export const ACTION_LABEL: Record<string, string> = {
  create: "Alta", update: "Modificación", close: "Finalización", upload: "Documento subido", extracted: "Lectura automática",
  extraction_failed: "Lectura fallida", review: "Revisión", confirm: "Confirmación", reopen: "Reapertura", reject: "Descarte",
  restore: "Recuperación", void: "Anulación", lock: "Cierre de mes", unlock: "Reapertura de mes", login: "Inicio de sesión",
  locked: "Bloqueo", export: "Exportación", delete: "Eliminación", password_change: "Cambio de contraseña",
};

export const FIELD_NAMES: Record<string, string> = {
  number: "Número", status: "Estado", acquiredOn: "Incorporación", notes: "Notas", plate: "Matrícula", make: "Marca", model: "Modelo",
  code: "Código", fullName: "Nombre", phone: "Teléfono", startedOn: "Inicio", endedOn: "Fin", role: "Observación",
  name: "Nombre", kind: "Naturaleza", keywords: "Palabras clave", active: "Activo", description: "Descripción",
  occurredOn: "Fecha", amountCents: "Importe", categoryId: "Categoría", licenseId: "Licencia", vehicleId: "Vehículo", driverId: "Conductor",
  counterpartyName: "Emisor/receptor", counterpartyTaxId: "NIF/CIF", invoiceNumber: "Nº factura", issueDate: "Fecha", dueDate: "Vencimiento",
  periodStart: "Periodo desde", periodEnd: "Periodo hasta", subtotalCents: "Base", taxCents: "Impuestos", withholdingCents: "Retenciones",
  totalCents: "Total", direction: "Tipo", documentType: "Documento", currency: "Moneda", lines: "Líneas", voidReason: "Motivo",
};

const VALUE_LABELS: Record<string, string> = {
  uploaded: "Subida", processing: "Leyendo", needs_review: "En revisión", failed: "Lectura fallida", confirmed: "Confirmada", rejected: "Descartada",
  active: "Activo", inactive: "Inactivo", suspended: "Suspendido", retired: "Baja",
  received: "Recibida", issued: "Emitida", unknown: "Sin determinar",
  income: "Ingreso", expense: "Gasto", neutral: "Neutro",
};

function short(v: unknown, key?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (key?.endsWith("Cents") && typeof v === "number") return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v / 100);
  if (Array.isArray(v)) return key === "lines" ? `${v.length} líneas` : v.join(", ");
  if (typeof v === "object") return "…";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  const s = String(v);
  if (VALUE_LABELS[s] && (key === "status" || key === "direction" || key === "kind")) return VALUE_LABELS[s];
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDate(s) : s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

export function ChangeList({ before, after }: { before: unknown; after: unknown }) {
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const keys = Object.keys(a).filter((k) => FIELD_NAMES[k] && !["id", "createdAt", "updatedAt", "issues", "fieldConfidence"].includes(k));
  if (!keys.length || !before) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[12px] text-text-2">
      {keys.slice(0, 8).map((k) => (
        <li key={k}>
          <span className="text-text-3">{FIELD_NAMES[k]}:</span> <span className="line-through decoration-text-3/50">{short(b[k], k)}</span> → <span className="text-text">{short(a[k], k)}</span>
        </li>
      ))}
    </ul>
  );
}

export function HistoryCard({ events, title = "Historial de cambios" }: { events: { e: { id: string; action: string; summary: string | null; createdAt: Date; before: unknown; after: unknown; entity: string }; user: string | null }[]; title?: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      {events.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title="Sin cambios registrados" />
      ) : (
        <ol className="relative px-5 pb-5">
          {events.map(({ e, user }) => (
            <li key={e.id} className="relative border-l border-line pb-4 pl-4 last:pb-0">
              <span className="absolute -left-[4.5px] top-1.5 size-2 rounded-full bg-text-3" />
              <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="font-medium">{e.summary ?? ACTION_LABEL[e.action] ?? e.action}</span>
                <span className="text-text-3">{formatDateTime(e.createdAt)} · {user ?? "Sistema"}</span>
              </div>
              <ChangeList before={e.before} after={e.after} />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export async function MovementsCard({ filter, title = "Movimientos recientes", limit = 10, moreHref }: { filter: FinanceFilter; title?: string; limit?: number; moreHref?: string }) {
  const { rows, total } = await listMovements(filter, limit);
  return (
    <Card>
      <CardHeader title={title} subtitle={`${total} en el periodo`} action={moreHref && total > 0 ? <Link href={moreHref} className="text-[13px] font-medium text-accent">Ver todos</Link> : null} />
      {rows.length === 0 ? (
        <EmptyState title="Sin movimientos">No hay movimientos registrados en este periodo.</EmptyState>
      ) : (
        <RowLinks>
          <Table>
            <thead>
              <tr><Th>Fecha</Th><Th>Concepto</Th><Th className="hidden sm:table-cell">Naturaleza</Th><Th align="right">Importe</Th></tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <Tr key={m.id} href={m.invoiceId ? `/facturas/${m.invoiceId}` : undefined}>
                  <Td className="whitespace-nowrap text-text-2 tabular">{formatDate(m.occurredOn)}</Td>
                  <Td>
                    <div className="font-medium">{m.category}</div>
                    {m.description && <div className="max-w-[340px] truncate text-[12px] text-text-2">{m.description}</div>}
                  </Td>
                  <Td className="hidden sm:table-cell"><Badge tone={KIND[m.kind].tone}>{KIND[m.kind].label}</Badge></Td>
                  <Td align="right" className="font-medium"><Money cents={m.amountCents} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </RowLinks>
      )}
    </Card>
  );
}
