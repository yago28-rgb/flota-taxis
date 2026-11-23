"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, OctagonAlert, Plus, RotateCw, Trash2, Undo2, Ban, CopyCheck } from "lucide-react";
import type { ValidationIssue } from "@/db/schema";
import type { Lookups } from "@/lib/finance";
import { submitReview, rejectAction, reopenAction, restoreAction } from "@/lib/actions/invoices";
import { centsToInput, formatCents, parseMoneyToCents } from "@/lib/format";
import { Badge, Button, Card, CardHeader, Confidence, Field, Input, Notice, Select, Spinner, Textarea, cx } from "@/components/ui";
import { ActionForm, FormMessage, Modal, SubmitButton } from "@/components/client";

type Line = {
  id?: string | null;
  description: string | null;
  quantity: number | null;
  unitPriceCents: number | null;
  taxRate: number | null;
  taxCents: number | null;
  amountCents: number | null;
  serviceDate: string | null;
  categoryId: string | null;
  licenseId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  detectedPlate?: string | null;
  detectedLicense?: string | null;
  detectedDriver?: string | null;
  confidence?: number | null;
};

export type ReviewInitial = {
  direction: "received" | "issued" | "unknown";
  documentType: string | null;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  subtotalCents: number | null;
  taxCents: number | null;
  withholdingCents: number | null;
  totalCents: number | null;
  licenseId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  notes: string | null;
  lines: Line[];
};

const MONEY = ["subtotalCents", "taxCents", "withholdingCents", "totalCents"] as const;
type MoneyKey = (typeof MONEY)[number];

/** Línea en edición: los importes se guardan como texto para no perder lo que escribe el usuario. */
type EditLine = Omit<Line, "unitPriceCents" | "taxCents" | "amountCents" | "quantity" | "taxRate"> & {
  key: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  tax: string;
  amount: string;
};

const toEdit = (l: Line): EditLine => ({
  ...l,
  key: l.id ?? crypto.randomUUID(),
  quantity: l.quantity === null ? "" : String(l.quantity).replace(".", ","),
  unitPrice: centsToInput(l.unitPriceCents),
  taxRate: l.taxRate === null ? "" : String(l.taxRate).replace(".", ","),
  tax: centsToInput(l.taxCents),
  amount: centsToInput(l.amountCents),
});

const num = (s: string) => {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : NaN;
};
const nul = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export function ReviewForm({
  id,
  status,
  editable,
  initial,
  confidence,
  evidence,
  issues: initialIssues,
  threshold,
  lookups,
  identifiers,
}: {
  id: string;
  status: string;
  editable: boolean;
  initial: ReviewInitial;
  confidence: Record<string, number>;
  evidence: Record<string, string | null>;
  issues: ValidationIssue[];
  threshold: number;
  lookups: Lookups;
  identifiers: { plates: string[]; licenses: string[]; driverNames: string[] } | null;
}) {
  const router = useRouter();
  const [h, setH] = useState(() => ({
    ...initial,
    money: Object.fromEntries(MONEY.map((k) => [k, centsToInput(initial[k])])) as Record<MoneyKey, string>,
  }));
  const [lines, setLines] = useState<EditLine[]>(() => initial.lines.map(toEdit));
  const [issues, setIssues] = useState(initialIssues);
  const [needsAck, setNeedsAck] = useState(initialIssues.some((i) => i.severity === "error"));
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof typeof h>(k: K, v: (typeof h)[K]) => {
    setH((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };
  const setMoney = (k: MoneyKey, v: string) => {
    setH((p) => ({ ...p, money: { ...p.money, [k]: v } }));
    setDirty(true);
  };
  const setLine = (key: string, patch: Partial<EditLine>) => {
    setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const issuesByField = useMemo(() => {
    const m: Record<string, ValidationIssue[]> = {};
    for (const i of issues) if (i.field) (m[i.field] ??= []).push(i);
    return m;
  }, [issues]);

  const activeCategories = lookups.categories.filter((c) => c.active);
  const lineSum = lines.reduce((s, l) => s + (parseMoneyToCents(l.amount) ?? 0), 0);

  function build() {
    const errs: Record<string, string> = {};
    const money = {} as Record<MoneyKey, number | null>;
    for (const k of MONEY) {
      const v = h.money[k].trim();
      const c = v ? parseMoneyToCents(v) : null;
      if (v && c === null) errs[k] = "Importe no válido";
      money[k] = c;
    }
    const outLines = lines.map((l, idx) => {
      const q = num(l.quantity);
      const r = num(l.taxRate);
      const up = l.unitPrice.trim() ? parseMoneyToCents(l.unitPrice) : null;
      const tx = l.tax.trim() ? parseMoneyToCents(l.tax) : null;
      const am = l.amount.trim() ? parseMoneyToCents(l.amount) : null;
      if (Number.isNaN(q)) errs[`line.${idx}.quantity`] = "Cantidad no válida";
      if (Number.isNaN(r)) errs[`line.${idx}.taxRate`] = "Tipo no válido";
      if (l.unitPrice.trim() && up === null) errs[`line.${idx}.unitPrice`] = "Importe no válido";
      if (l.tax.trim() && tx === null) errs[`line.${idx}.tax`] = "Importe no válido";
      if (l.amount.trim() && am === null) errs[`line.${idx}.amount`] = "Importe no válido";
      return {
        id: l.id ?? null,
        description: nul(l.description),
        quantity: Number.isNaN(q) ? null : q,
        unitPriceCents: up,
        taxRate: Number.isNaN(r) ? null : r,
        taxCents: tx,
        amountCents: am,
        serviceDate: nul(l.serviceDate),
        categoryId: l.categoryId || null,
        licenseId: l.licenseId || null,
        vehicleId: l.vehicleId || null,
        driverId: l.driverId || null,
        detectedPlate: l.detectedPlate ?? null,
        detectedLicense: l.detectedLicense ?? null,
        detectedDriver: l.detectedDriver ?? null,
        confidence: l.confidence ?? null,
      };
    });
    setLocalErrors(errs);
    if (Object.keys(errs).length) return null;
    return {
      direction: h.direction,
      documentType: nul(h.documentType),
      counterpartyName: nul(h.counterpartyName),
      counterpartyTaxId: nul(h.counterpartyTaxId),
      invoiceNumber: nul(h.invoiceNumber),
      issueDate: nul(h.issueDate),
      dueDate: nul(h.dueDate),
      periodStart: nul(h.periodStart),
      periodEnd: nul(h.periodEnd),
      currency: (h.currency || "EUR").toUpperCase(),
      ...money,
      licenseId: h.licenseId || null,
      vehicleId: h.vehicleId || null,
      driverId: h.driverId || null,
      notes: nul(h.notes),
      lines: outLines,
    };
  }

  function send(confirm: boolean) {
    const payload = build();
    if (!payload) {
      setMsg({ ok: false, text: "Revisa los campos marcados." });
      return;
    }
    setMsg(null);
    start(async () => {
      const r = await submitReview(id, payload, { confirm, acknowledge: ack });
      if (r.issues) {
        setIssues(r.issues);
        setNeedsAck(Boolean(r.needsAcknowledgement));
      }
      if (r.ok) {
        setDirty(false);
        setMsg({ ok: true, text: r.message ?? "Guardado." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: r.message ?? "No se pudo guardar." });
      }
    });
  }

  const hint = (field: string) => {
    const c = confidence[field];
    const ev = evidence[field];
    const fi = issuesByField[field];
    return (
      <span className="flex flex-col gap-0.5">
        {fi?.map((i, n) => (
          <span key={n} className={i.severity === "error" ? "text-negative" : i.severity === "warning" ? "text-warning" : "text-text-3"}>{i.message}</span>
        ))}
        {ev && <span className="truncate text-text-3" title={ev}>«{ev}»</span>}
        {c === undefined && editable && status !== "uploaded" && Object.keys(confidence).length > 0 && <span className="text-text-3">No encontrado en el documento</span>}
      </span>
    );
  };
  const doubtful = (field: string) => {
    const c = confidence[field];
    return (c !== undefined && c < threshold) || issuesByField[field]?.some((i) => i.severity !== "info");
  };
  const label = (text: string, field: string) => (
    <span className="inline-flex items-center gap-2">
      {text}
      <Confidence value={confidence[field]} />
    </span>
  );

  const text = (field: "counterpartyName" | "counterpartyTaxId" | "invoiceNumber" | "documentType", t: string, req?: boolean, cls?: string) => (
    <Field label={label(t, field)} required={req} hint={hint(field)} error={localErrors[field]} className={cls}>
      <Input value={h[field] ?? ""} onChange={(e) => set(field, e.target.value)} invalid={doubtful(field)} disabled={!editable} />
    </Field>
  );
  const date = (field: "issueDate" | "dueDate" | "periodStart" | "periodEnd", t: string, req?: boolean) => (
    <Field label={label(t, field)} required={req} hint={hint(field)}>
      <Input type="date" value={h[field] ?? ""} onChange={(e) => set(field, e.target.value || null)} invalid={doubtful(field)} disabled={!editable} />
    </Field>
  );
  const money = (field: MoneyKey, t: string, req?: boolean) => (
    <Field label={label(t, field)} required={req} hint={hint(field)} error={localErrors[field]}>
      <div className="relative">
        <Input inputMode="decimal" value={h.money[field]} onChange={(e) => setMoney(field, e.target.value)} invalid={doubtful(field) || Boolean(localErrors[field])} disabled={!editable} className="pr-8 text-right tabular" placeholder="—" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-text-3">€</span>
      </div>
    </Field>
  );

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  return (
    <>
      {issues.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="font-semibold">Validaciones</span>
            {errors.length > 0 && <Badge tone="negative">{errors.length} error{errors.length > 1 ? "es" : ""}</Badge>}
            {warnings.length > 0 && <Badge tone="warning">{warnings.length} aviso{warnings.length > 1 ? "s" : ""}</Badge>}
            {infos.length > 0 && <Badge>{infos.length} nota{infos.length > 1 ? "s" : ""}</Badge>}
          </div>
          <ul className="space-y-1.5 text-[13.5px]">
            {[...errors, ...warnings, ...infos].map((i, n) => (
              <li key={n} className="flex gap-2">
                {i.severity === "error" ? <OctagonAlert className="mt-0.5 size-4 shrink-0 text-negative" /> : i.severity === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> : <Info className="mt-0.5 size-4 shrink-0 text-text-3" />}
                <span>{i.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Datos del documento" subtitle={editable ? "Corrige lo que no coincida con el original. Lo que no aparezca, déjalo vacío." : undefined} />
        <fieldset disabled={!editable || pending} className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-2">
          <Field label="Sentido">
            <Select value={h.direction} onChange={(e) => set("direction", e.target.value as ReviewInitial["direction"])}>
              <option value="received">Recibida (gasto habitual)</option>
              <option value="issued">Emitida por el titular</option>
              <option value="unknown">Sin determinar</option>
            </Select>
          </Field>
          {text("documentType", "Tipo de documento")}
          {text("counterpartyName", h.direction === "issued" ? "Cliente" : "Emisor", true, "sm:col-span-2")}
          {text("counterpartyTaxId", "NIF/CIF")}
          {text("invoiceNumber", "Número")}
          {date("issueDate", "Fecha de emisión", true)}
          {date("dueDate", "Vencimiento")}
          {date("periodStart", "Periodo desde")}
          {date("periodEnd", "Periodo hasta")}
        </fieldset>
      </Card>

      <Card>
        <CardHeader title="Importes" subtitle={h.currency !== "EUR" ? `Moneda del documento: ${h.currency}` : undefined} />
        <fieldset disabled={!editable || pending} className="grid grid-cols-2 gap-4 px-5 pb-5 lg:grid-cols-4">
          {money("subtotalCents", "Base")}
          {money("taxCents", "Impuestos")}
          {money("withholdingCents", "Retención")}
          {money("totalCents", "Total", true)}
        </fieldset>
      </Card>

      <Card>
        <CardHeader
          title="Asignación"
          subtitle="Licencia, vehículo o conductor a los que corresponde. Las líneas sin asignación propia heredan esta."
          action={
            editable && lines.length > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setLines((p) => p.map((l) => ({ ...l, licenseId: h.licenseId, vehicleId: h.vehicleId, driverId: h.driverId })));
                  setDirty(true);
                }}
              >
                <CopyCheck className="size-3.5" />Aplicar a todas las líneas
              </Button>
            ) : undefined
          }
        />
        <fieldset disabled={!editable || pending} className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-3">
          <Field label="Licencia">
            <Select value={h.licenseId ?? ""} onChange={(e) => set("licenseId", e.target.value || null)}>
              <option value="">Sin asignar</option>
              {lookups.licenses.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="Vehículo">
            <Select value={h.vehicleId ?? ""} onChange={(e) => set("vehicleId", e.target.value || null)}>
              <option value="">Sin asignar</option>
              {lookups.vehicles.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="Conductor">
            <Select value={h.driverId ?? ""} onChange={(e) => set("driverId", e.target.value || null)}>
              <option value="">Sin asignar</option>
              {lookups.drivers.map((o) => <option key={o.id} value={o.id}>{o.label} · {o.code}</option>)}
            </Select>
          </Field>
          {identifiers && (identifiers.plates.length > 0 || identifiers.licenses.length > 0 || identifiers.driverNames.length > 0) && (
            <p className="text-[12.5px] text-text-2 sm:col-span-3">
              Aparece en el documento:{" "}
              {[...identifiers.licenses.map((x) => `licencia ${x}`), ...identifiers.plates.map((x) => `matrícula ${x}`), ...identifiers.driverNames].join(" · ")}
            </p>
          )}
        </fieldset>
      </Card>

      <Card>
        <CardHeader
          title="Líneas"
          subtitle={
            lines.length > 0 ? (
              <span className="tabular">
                Suma de líneas {formatCents(lineSum)}
                {h.money.subtotalCents && parseMoneyToCents(h.money.subtotalCents) !== null && ` · base ${formatCents(parseMoneyToCents(h.money.subtotalCents)!)}`}
              </span>
            ) : (
              "Cada línea genera un movimiento al confirmar. Asígnale una categoría."
            )
          }
          action={
            editable && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setLines((p) => [...p, toEdit({ description: null, quantity: null, unitPriceCents: null, taxRate: null, taxCents: null, amountCents: null, serviceDate: null, categoryId: null, licenseId: null, vehicleId: null, driverId: null })]);
                  setDirty(true);
                }}
              >
                <Plus className="size-3.5" />Añadir línea
              </Button>
            )
          }
        />
        {activeCategories.length === 0 && editable && (
          <div className="px-5 pb-3">
            <Notice tone="warning">No hay categorías. Créalas en <a href="/ajustes/categorias" className="font-medium underline">Ajustes › Categorías</a> para poder confirmar.</Notice>
          </div>
        )}
        <fieldset disabled={!editable || pending} className="divide-y divide-line border-t border-line">
          {lines.length === 0 && <p className="px-5 py-6 text-center text-[14px] text-text-3">Sin líneas.{editable && " Añade al menos una para poder confirmar."}</p>}
          {lines.map((l, idx) => {
            const e = (f: string) => localErrors[`line.${idx}.${f}`];
            const lowConf = l.confidence !== null && l.confidence !== undefined && l.confidence < threshold;
            return (
              <div key={l.key} className={cx("grid grid-cols-6 gap-3 px-5 py-4", lowConf && "bg-warning-soft/40")}>
                <div className="col-span-6 flex items-start gap-2">
                  <span className="mt-2 w-5 shrink-0 text-[12px] tabular text-text-3">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Field label={<span className="inline-flex items-center gap-2">Concepto<Confidence value={l.confidence} /></span>}>
                      <Input value={l.description ?? ""} onChange={(ev) => setLine(l.key, { description: ev.target.value })} />
                    </Field>
                  </div>
                  {editable && (
                    <button type="button" onClick={() => { setLines((p) => p.filter((x) => x.key !== l.key)); setDirty(true); }} className="mt-7 grid size-9 shrink-0 place-items-center rounded-full text-text-3 hover:bg-fill hover:text-negative" aria-label={`Quitar línea ${idx + 1}`}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                <Field label="Cantidad" error={e("quantity")} className="col-span-2 sm:col-span-1"><Input inputMode="decimal" value={l.quantity} onChange={(ev) => setLine(l.key, { quantity: ev.target.value })} className="text-right tabular" /></Field>
                <Field label="Precio" error={e("unitPrice")} className="col-span-2 sm:col-span-1"><Input inputMode="decimal" value={l.unitPrice} onChange={(ev) => setLine(l.key, { unitPrice: ev.target.value })} className="text-right tabular" /></Field>
                <Field label="IVA %" error={e("taxRate")} className="col-span-2 sm:col-span-1"><Input inputMode="decimal" value={l.taxRate} onChange={(ev) => setLine(l.key, { taxRate: ev.target.value })} className="text-right tabular" /></Field>
                <Field label="Cuota" error={e("tax")} className="col-span-3 sm:col-span-1"><Input inputMode="decimal" value={l.tax} onChange={(ev) => setLine(l.key, { tax: ev.target.value })} className="text-right tabular" /></Field>
                <Field label="Importe" error={e("amount")} className="col-span-3 sm:col-span-2"><Input inputMode="decimal" value={l.amount} onChange={(ev) => setLine(l.key, { amount: ev.target.value })} className="text-right tabular font-medium" /></Field>
                <Field label="Categoría" required className="col-span-6 sm:col-span-2">
                  <Select value={l.categoryId ?? ""} onChange={(ev) => setLine(l.key, { categoryId: ev.target.value || null })} invalid={!l.categoryId && status !== "confirmed"}>
                    <option value="">Elegir…</option>
                    {lookups.categories.filter((c) => c.active || c.id === l.categoryId).map((c) => (
                      <option key={c.id} value={c.id}>{c.label} · {c.kind === "income" ? "ingreso" : c.kind === "expense" ? "gasto" : "neutro"}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Licencia" className="col-span-3 sm:col-span-1">
                  <Select value={l.licenseId ?? ""} onChange={(ev) => setLine(l.key, { licenseId: ev.target.value || null })}>
                    <option value="">{h.licenseId ? "Como la factura" : "—"}</option>
                    {lookups.licenses.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </Select>
                </Field>
                <Field label="Vehículo" className="col-span-3 sm:col-span-1">
                  <Select value={l.vehicleId ?? ""} onChange={(ev) => setLine(l.key, { vehicleId: ev.target.value || null })}>
                    <option value="">{h.vehicleId ? "Como la factura" : "—"}</option>
                    {lookups.vehicles.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </Select>
                </Field>
                <Field label="Conductor" className="col-span-6 sm:col-span-2">
                  <Select value={l.driverId ?? ""} onChange={(ev) => setLine(l.key, { driverId: ev.target.value || null })}>
                    <option value="">{h.driverId ? "Como la factura" : "—"}</option>
                    {lookups.drivers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </Select>
                </Field>
                {(l.detectedPlate || l.detectedLicense || l.detectedDriver) && (
                  <p className="col-span-6 text-[12px] text-text-3">En la línea: {[l.detectedLicense && `licencia ${l.detectedLicense}`, l.detectedPlate && `matrícula ${l.detectedPlate}`, l.detectedDriver].filter(Boolean).join(" · ")}</p>
                )}
              </div>
            );
          })}
        </fieldset>
      </Card>

      <Card className="p-5">
        <Field label="Notas internas">
          <Textarea rows={2} value={h.notes ?? ""} onChange={(e) => set("notes", e.target.value)} disabled={!editable || pending} />
        </Field>
      </Card>

      {editable && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+76px)] z-10 lg:bottom-4">
          <Card className="glass space-y-3 p-4 shadow-float">
            {msg && <Notice tone={msg.ok ? "positive" : "negative"}>{msg.text}</Notice>}
            {needsAck && (
              <label className="flex items-start gap-2.5 text-[13.5px]">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
                <span>He comprobado el original y los datos son correctos aunque haya errores de validación.</span>
              </label>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              {dirty && <span className="text-[12.5px] text-text-3 sm:mr-auto">Cambios sin guardar</span>}
              <Button variant="secondary" onClick={() => send(false)} disabled={pending}>{pending ? <Spinner className="size-4" /> : null}Guardar y validar</Button>
              <Button onClick={() => send(true)} disabled={pending || (needsAck && !ack)}>Confirmar e importar</Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}


/* ─────────────────────── Acciones de cabecera ─────────────────────── */

export function InvoiceActions({ id, status, providerReady, hasRuns }: { id: string; status: string; providerReady: boolean; hasRuns: boolean }) {
  const router = useRouter();
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canRead = status !== "confirmed" && status !== "rejected" && status !== "processing";

  async function read() {
    setReading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/invoices/${id}/extract`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.error ?? "No se pudo leer el documento.");
    } finally {
      setReading(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {canRead && (
          <Modal
            title={hasRuns ? "Volver a leer el documento" : "Leer documento"}
            description={providerReady ? "El documento se lee en este equipo con el motor local. No sale del equipo ni tiene coste." : undefined}
            trigger={(open) => (
              <Button variant="secondary" size="sm" onClick={open} disabled={reading}>
                {reading ? <Spinner className="size-3.5" /> : <RotateCw className="size-3.5" />}
                {reading ? "Leyendo…" : hasRuns ? "Volver a leer" : "Leer documento"}
              </Button>
            )}
          >
            {(close) => (
              <div className="space-y-4 text-[14px]">
                {providerReady ? (
                  <p>{hasRuns ? "Los datos de la lectura nueva sustituirán a los actuales en el formulario. Los cambios anteriores siguen en el historial." : "Los datos leídos aparecerán en el formulario para que los revises."} Suele tardar entre 10 y 30 segundos por página.</p>
                ) : (
                  <p>El motor de reconocimiento local no está en marcha. Si lo intentas, la lectura fallará y quedará registrada como tal. Inícialo antes con «npm run ocr».</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={close}>Cancelar</Button>
                  <Button onClick={() => { close(); read(); }}>Leer</Button>
                </div>
              </div>
            )}
          </Modal>
        )}
        {status === "confirmed" && (
          <ReasonDialog id={id} action={reopenAction} title="Reabrir factura" button="Reabrir" icon={<Undo2 className="size-3.5" />} text="Los movimientos generados se anularán (no se borran) y la factura volverá a revisión." />
        )}
        {(status === "needs_review" || status === "failed" || status === "uploaded") && (
          <ReasonDialog id={id} action={rejectAction} title="Descartar factura" button="Descartar" icon={<Ban className="size-3.5" />} text="No se importará. El documento original se conserva y podrás recuperarla." danger />
        )}
        {status === "rejected" && (
          <ActionForm action={restoreAction} onSuccess={() => router.refresh()}>
            {(s) => (
              <>
                <input type="hidden" name="id" value={id} />
                <SubmitButton variant="secondary" className="h-8 px-3 text-[13px]">Recuperar</SubmitButton>
                <FormMessage state={s} />
              </>
            )}
          </ActionForm>
        )}
      </div>
      {err && <p className="max-w-sm text-right text-[12.5px] text-negative">{err}</p>}
    </div>
  );
}

function ReasonDialog({ id, action, title, button, text, icon, danger }: { id: string; action: typeof rejectAction; title: string; button: string; text: string; icon: React.ReactNode; danger?: boolean }) {
  const router = useRouter();
  return (
    <Modal title={title} description={text} trigger={(open) => <Button variant="secondary" size="sm" onClick={open}>{icon}{button}</Button>}>
      {(close) => (
        <ActionForm action={action} onSuccess={() => { close(); router.refresh(); }} className="space-y-4">
          {(s) => (
            <>
              <input type="hidden" name="id" value={id} />
              <Field label="Motivo" required error={s?.fieldErrors?.reason}>
                <Input name="reason" required minLength={3} autoFocus />
              </Field>
              <FormMessage state={s} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={close}>Cancelar</Button>
                <SubmitButton variant={danger ? "danger" : "primary"}>{button}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}
