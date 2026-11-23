"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Download, FileSpreadsheet, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { DATASETS, FIELDS, type Dataset } from "@/lib/export/fields";
import { deleteTemplate, saveTemplate } from "@/lib/actions/export";
import { Button, Card, CardHeader, EmptyState, Field, Input, Notice, Select, Spinner, buttonClass, cx } from "@/components/ui";
import { Modal } from "@/components/client";

type Opt = { id: string; label: string };
type Column = { header: string; field: string; width?: number };
type Template = { id: string; name: string; dataset: string; sheetName: string | null; includeTotals: boolean; columns: Column[] };

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

type Preset = "month" | "quarter" | "year" | "custom";

export function Exporter({
  today,
  canEdit,
  initial,
  templates,
  lookups,
}: {
  today: string;
  canEdit: boolean;
  initial: { dataset: string; license: string | null; vehicle: string | null; driver: string | null };
  templates: Template[];
  lookups: { licenses: Opt[]; vehicles: Opt[]; drivers: Opt[]; categories: Opt[] };
}) {
  const [ty, tm] = today.split("-").map(Number);
  const [dataset, setDataset] = useState(initial.dataset in DATASETS || initial.dataset === "report" ? initial.dataset : "report");
  const [preset, setPreset] = useState<Preset>("month");
  const [year, setYear] = useState(ty);
  const [month, setMonth] = useState(tm);
  const [quarter, setQuarter] = useState(Math.ceil(tm / 3));
  const [from, setFrom] = useState(`${ty}-01-01`);
  const [to, setTo] = useState(today);
  const [license, setLicense] = useState(initial.license ?? "");
  const [vehicle, setVehicle] = useState(initial.vehicle ?? "");
  const [driver, setDriver] = useState(initial.driver ?? "");
  const [category, setCategory] = useState("");
  const [voided, setVoided] = useState(false);

  const range = useMemo(() => {
    if (preset === "month") return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${lastDay(year, month)}` };
    if (preset === "quarter") {
      const s = (quarter - 1) * 3 + 1;
      return { from: `${year}-${pad(s)}-01`, to: `${year}-${pad(s + 2)}-${lastDay(year, s + 2)}` };
    }
    if (preset === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
    return { from, to };
  }, [preset, year, month, quarter, from, to]);

  const href = (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ dataset, from: range.from, to: range.to, ...extra });
    if (license) q.set("license", license);
    if (vehicle) q.set("vehicle", vehicle);
    if (driver) q.set("driver", driver);
    if (category) q.set("category", category);
    if (voided) q.set("voided", "1");
    return `/api/export?${q}`;
  };
  const invalid = !range.from || !range.to || range.from > range.to;
  const years = Array.from({ length: 8 }, (_, i) => ty - 6 + i);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader title="Exportación rápida" subtitle="Elige qué datos, de qué periodo y con qué filtros." />
        <div className="space-y-5 px-5 pb-5">
          <div>
            <div className="mb-2 text-[13px] font-medium text-text-2">Contenido</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[["report", "Informe resumen"], ...Object.entries(DATASETS)].map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDataset(k)}
                  className={cx(
                    "rounded-xl px-3 py-2.5 text-left text-[13.5px] ring-1 transition-colors",
                    dataset === k ? "bg-accent-soft font-medium text-accent ring-accent" : "ring-line hover:bg-fill-2",
                  )}
                >
                  {l}
                  {k === "report" && <div className="text-[11.5px] font-normal text-text-3">Totales por mes, licencia y categoría</div>}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[13px] font-medium text-text-2">Periodo</div>
            <div className="mb-3 inline-flex rounded-full bg-fill-2 p-0.5">
              {(["month", "quarter", "year", "custom"] as Preset[]).map((p) => (
                <button key={p} type="button" onClick={() => setPreset(p)} className={cx("h-7 rounded-full px-3 text-[13px] font-medium transition-colors", preset === p ? "bg-surface shadow-card" : "text-text-2")}>
                  {{ month: "Mes", quarter: "Trimestre", year: "Año", custom: "Fechas" }[p]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {preset !== "custom" && (
                <Field label="Año">
                  <Select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
                </Field>
              )}
              {preset === "month" && (
                <Field label="Mes">
                  <Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
                </Field>
              )}
              {preset === "quarter" && (
                <Field label="Trimestre">
                  <Select value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}T</option>)}</Select>
                </Field>
              )}
              {preset === "custom" && (
                <>
                  <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                  <Field label="Hasta" error={invalid ? "Periodo no válido" : undefined}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                </>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[13px] font-medium text-text-2">Filtros</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Licencia"><Select value={license} onChange={(e) => setLicense(e.target.value)}><option value="">Todas</option>{lookups.licenses.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
              <Field label="Vehículo"><Select value={vehicle} onChange={(e) => setVehicle(e.target.value)}><option value="">Todos</option>{lookups.vehicles.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
              <Field label="Conductor"><Select value={driver} onChange={(e) => setDriver(e.target.value)}><option value="">Todos</option>{lookups.drivers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
              <Field label="Categoría"><Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Todas</option>{lookups.categories.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-[13.5px]">
              <input type="checkbox" checked={voided} onChange={(e) => setVoided(e.target.checked)} className="size-4 accent-[var(--accent)]" />
              Incluir movimientos anulados
            </label>
          </div>

          <div className="flex justify-end border-t border-line pt-4">
            <a href={invalid ? undefined : href()} aria-disabled={invalid} className={cx(buttonClass("primary", "md"), invalid && "pointer-events-none opacity-50")}>
              <Download className="size-4" />Descargar Excel
            </a>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Mis plantillas"
            subtitle="Con los encabezados y el orden de columnas de tu Excel."
            action={canEdit && <TemplateEditor />}
          />
          {templates.length === 0 ? (
            <EmptyState icon={<FileSpreadsheet className="size-5" />} title="Sin plantillas">
              Crea una e importa los encabezados de tu Excel actual para exportar con la misma estructura.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {templates.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.name}</div>
                    <div className="text-[12px] text-text-2">{DATASETS[t.dataset as Dataset] ?? t.dataset} · {t.columns.length} columnas</div>
                  </div>
                  <a href={invalid ? undefined : href({ template: t.id })} className={cx(buttonClass("secondary", "sm"), invalid && "pointer-events-none opacity-50")} title="Descarga con el periodo y filtros elegidos">
                    <Download className="size-3.5" />Descargar
                  </a>
                  {canEdit && <TemplateEditor template={t} />}
                </li>
              ))}
            </ul>
          )}
          {templates.length > 0 && <p className="px-5 pb-4 pt-1 text-[12px] text-text-3">Se aplican el periodo y los filtros de la izquierda.</p>}
        </Card>
      </div>
    </div>
  );
}

/* ─────────────────────── Editor de plantillas ─────────────────────── */

type Inspect = { sheets: { name: string; headerRow: number; columns: { index: number; header: string; suggestion: string | null }[]; sampleRows: number }[] };

function TemplateEditor({ template }: { template?: Template }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(template?.name ?? "");
  const [dataset, setDataset] = useState<Dataset>((template?.dataset as Dataset) ?? "movements");
  const [sheetName, setSheetName] = useState(template?.sheetName ?? "");
  const [includeTotals, setIncludeTotals] = useState(template?.includeTotals ?? true);
  const [columns, setColumns] = useState<Column[]>(template?.columns ?? []);
  const [error, setError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [pending, start] = useTransition();
  const fields = FIELDS[dataset];

  function reset() {
    setName(template?.name ?? "");
    setDataset((template?.dataset as Dataset) ?? "movements");
    setSheetName(template?.sheetName ?? "");
    setIncludeTotals(template?.includeTotals ?? true);
    setColumns(template?.columns ?? []);
    setError(null);
    setInspect(null);
  }

  async function readExcel(file: File) {
    setInspecting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("dataset", dataset);
      const r = await fetch("/api/export/inspect", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "No se pudo leer el Excel.");
      const withCols = (d as Inspect).sheets.filter((s) => s.columns.length > 0);
      if (!withCols.length) throw new Error("No se han encontrado encabezados en el archivo.");
      setInspect({ sheets: withCols });
      if (withCols.length === 1) applySheet(withCols[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error leyendo el Excel.");
    } finally {
      setInspecting(false);
    }
  }
  function applySheet(s: Inspect["sheets"][number]) {
    setColumns(s.columns.map((c) => ({ header: c.header, field: c.suggestion ?? "" })));
    if (!sheetName) setSheetName(s.name.slice(0, 31));
    if (!name) setName(s.name);
    setInspect(null);
  }

  function save() {
    setError(null);
    const missing = columns.findIndex((c) => !c.field);
    if (missing >= 0) {
      setError(`Asigna un dato a la columna «${columns[missing].header}» o quítala.`);
      return;
    }
    start(async () => {
      const r = await saveTemplate({ id: template?.id ?? null, name: name.trim(), dataset, sheetName: sheetName.trim() || null, includeTotals, columns });
      if (r?.ok) {
        setOpen(false);
        router.refresh();
      } else setError(r?.message ?? "No se pudo guardar.");
    });
  }

  function remove() {
    if (!template) return;
    start(async () => {
      const r = await deleteTemplate(template.id);
      if (r?.ok) {
        setOpen(false);
        router.refresh();
      } else setError(r?.message ?? "No se pudo eliminar.");
    });
  }

  const move = (i: number, d: -1 | 1) => setColumns((p) => { const n = [...p]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });
  const patch = (i: number, c: Partial<Column>) => setColumns((p) => p.map((x, j) => (j === i ? { ...x, ...c } : x)));

  return (
    <Modal
      wide
      open={open}
      onOpenChange={(o) => { setOpen(o); if (o) reset(); }}
      title={template ? "Editar plantilla" : "Nueva plantilla"}
      description="Cada columna del Excel se rellena con un dato de la aplicación. Las columnas sin equivalente se pueden quitar."
      trigger={(o) => template ? <Button variant="secondary" size="sm" onClick={o} aria-label="Editar plantilla"><Pencil className="size-3.5" /></Button> : <Button size="sm" onClick={o}><Plus className="size-3.5" />Nueva</Button>}
    >
      {() => (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Libro de gastos" /></Field>
            <Field label="Datos">
              <Select value={dataset} onChange={(e) => { setDataset(e.target.value as Dataset); setColumns([]); }} disabled={Boolean(template)}>
                {Object.entries(DATASETS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Nombre de la hoja"><Input value={sheetName} onChange={(e) => setSheetName(e.target.value)} maxLength={31} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-[13.5px]">
              <input type="checkbox" checked={includeTotals} onChange={(e) => setIncludeTotals(e.target.checked)} className="size-4 accent-[var(--accent)]" />
              Fila de totales al final
            </label>
          </div>

          <div className="rounded-2xl bg-fill-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13.5px]">
                <div className="font-medium">Copiar la estructura de tu Excel</div>
                <div className="text-text-2">Sólo se leen los encabezados; el archivo no se guarda.</div>
              </div>
              <label className={cx(buttonClass("secondary", "sm"), "cursor-pointer")}>
                {inspecting ? <Spinner className="size-3.5" /> : <Upload className="size-3.5" />}Elegir .xlsx
                <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readExcel(f); e.target.value = ""; }} />
              </label>
            </div>
            {inspect && (
              <div className="mt-3 space-y-2">
                <div className="text-[13px] text-text-2">El archivo tiene varias hojas. ¿Cuál usar?</div>
                {inspect.sheets.map((s) => (
                  <button key={s.name} type="button" onClick={() => applySheet(s)} className="flex w-full items-center justify-between rounded-xl bg-surface px-3 py-2 text-left text-[13.5px] ring-1 ring-line hover:ring-accent">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-[12px] text-text-3">{s.columns.length} columnas · {s.sampleRows} filas</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-medium text-text-2">Columnas ({columns.length})</span>
              <Button variant="secondary" size="sm" onClick={() => setColumns((p) => [...p, { header: "", field: "" }])}><Plus className="size-3.5" />Columna</Button>
            </div>
            {columns.length === 0 ? (
              <p className="rounded-xl px-3 py-4 text-center text-[13.5px] text-text-3 ring-1 ring-line">Importa tu Excel o añade columnas.</p>
            ) : (
              <ul className="space-y-2">
                {columns.map((c, i) => (
                  <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                    <Input value={c.header} onChange={(e) => patch(i, { header: e.target.value })} placeholder="Encabezado" aria-label={`Encabezado de la columna ${i + 1}`} />
                    <Select value={c.field} onChange={(e) => { const f = fields.find((x) => x.key === e.target.value); patch(i, { field: e.target.value, header: c.header || f?.label || "" }); }} invalid={!c.field} aria-label={`Dato de la columna ${i + 1}`}>
                      <option value="">Sin asignar…</option>
                      {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </Select>
                    <span className="flex">
                      <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="grid size-8 place-items-center rounded-full text-text-3 hover:bg-fill disabled:opacity-30" aria-label="Subir"><ArrowUp className="size-3.5" /></button>
                      <button type="button" disabled={i === columns.length - 1} onClick={() => move(i, 1)} className="grid size-8 place-items-center rounded-full text-text-3 hover:bg-fill disabled:opacity-30" aria-label="Bajar"><ArrowDown className="size-3.5" /></button>
                      <button type="button" onClick={() => setColumns((p) => p.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-full text-text-3 hover:bg-fill hover:text-negative" aria-label="Quitar"><X className="size-3.5" /></button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {columns.some((c) => !c.field) && <p className="mt-2 text-[12.5px] text-warning">Las columnas en rojo no tienen equivalente automático: elige el dato o quítalas.</p>}
          </div>

          {error && <Notice tone="negative">{error}</Notice>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {template && <Button variant="danger" onClick={remove} disabled={pending} className="mr-auto"><Trash2 className="size-4" />Eliminar</Button>}
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={pending || !name.trim() || columns.length === 0}>{pending && <Spinner className="size-4" />}Guardar plantilla</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
