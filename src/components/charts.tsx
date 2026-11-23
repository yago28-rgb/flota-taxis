"use client";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cx } from "./ui";

type Point = { key: string; label: string; income: number; expense: number; result: number };

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const compact = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Evolución mensual: ingresos y gastos registrados en un único eje (€).
 * Dos series categóricas validadas (azul / naranja), leyenda siempre visible y vista de tabla.
 */
export function MonthlyChart({ data }: { data: Point[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const hasData = data.some((d) => d.income || d.expense);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-2">
        <div className="flex items-center gap-4 text-[12px] text-text-2" aria-label="Leyenda">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[var(--series-1)]" />Ingresos</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[var(--series-2)]" />Gastos</span>
        </div>
        <div className="inline-flex rounded-full bg-fill-2 p-0.5 text-[12px] font-medium">
          {(["chart", "table"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cx("h-6 rounded-full px-2.5 transition-all", view === v ? "bg-surface text-text shadow-card" : "text-text-2")}>
              {v === "chart" ? "Gráfico" : "Tabla"}
            </button>
          ))}
        </div>
      </div>

      {view === "chart" ? (
        <div className="relative h-[280px] px-2 pb-3">
          {!hasData && (
            <div className="absolute inset-0 z-10 grid place-items-center text-[13px] text-text-3">Sin movimientos registrados en este periodo</div>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--text-3)", fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis
                hide={!hasData}
                tickLine={false}
                axisLine={false}
                width={52}
                tick={{ fill: "var(--text-3)", fontSize: 11 }}
                tickFormatter={(v: number) => `${compact.format(v / 100)} €`}
              />
              <Tooltip cursor={{ fill: "var(--fill-2)" }} content={<ChartTooltip />} />
              <Bar dataKey="income" name="Ingresos" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive animationDuration={500} />
              <Bar dataKey="expense" name="Gastos" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive animationDuration={500} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-[300px] overflow-y-auto px-5 pb-4">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-text-2">
                <th className="py-2 font-medium">Mes</th>
                <th className="py-2 text-right font-medium">Ingresos</th>
                <th className="py-2 text-right font-medium">Gastos</th>
                <th className="py-2 text-right font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {[...data].reverse().map((d) => (
                <tr key={d.key} className="border-t border-line">
                  <td className="py-2">{d.label}</td>
                  <td className="py-2 text-right">{eur.format(d.income / 100)}</td>
                  <td className="py-2 text-right">{eur.format(d.expense / 100)}</td>
                  <td className={cx("py-2 text-right font-medium", d.result < 0 && "text-negative")}>{eur.format(d.result / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: Point }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="min-w-[180px] rounded-xl border border-line bg-surface px-3 py-2.5 text-[12px] shadow-float">
      <div className="mb-1.5 font-semibold text-text">{label}</div>
      <Row color="var(--series-1)" label="Ingresos" value={p.income} />
      <Row color="var(--series-2)" label="Gastos" value={p.expense} />
      <div className="mt-1.5 flex justify-between gap-4 border-t border-line pt-1.5 text-text">
        <span className="text-text-2">Resultado</span>
        <span className="tabular font-semibold">{eur.format(p.result / 100)}</span>
      </div>
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="inline-flex items-center gap-1.5 text-text-2">
        <span className="size-2 rounded-[2px]" style={{ background: color }} />
        {label}
      </span>
      <span className="tabular text-text">{eur.format(value / 100)}</span>
    </div>
  );
}

/** Barra de proporción compacta (p. ej. peso de cada licencia en los gastos). */
export function ShareBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((Math.abs(value) / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-fill-2" aria-hidden>
      <div className="h-full rounded-full bg-[var(--series-1)] transition-[width] duration-700 ease-[var(--ease-apple)]" style={{ width: `${pct}%` }} />
    </div>
  );
}
