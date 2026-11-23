"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useQueryState } from "./client";
import { cx } from "./ui";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Selector de periodo: mes concreto o año completo. */
export function PeriodPicker({ year, month, allowYear = true }: { year: number; month: number; allowYear?: boolean }) {
  const { set, pending } = useQueryState();
  const go = (y: number, m: number) => set({ y: String(y), m: String(m) });
  const step = (delta: number) => {
    if (month === 0) return go(year + delta, 0);
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    go(d.getUTCFullYear(), d.getUTCMonth() + 1);
  };
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => thisYear - 6 + i);

  return (
    <div className={cx("inline-flex h-8 items-center rounded-full bg-fill-2 p-0.5 transition-opacity", pending && "opacity-60")}>
      <button type="button" onClick={() => step(-1)} className="grid size-7 place-items-center rounded-full text-text-2 hover:bg-surface hover:text-text" aria-label="Periodo anterior">
        <ChevronLeft className="size-4" />
      </button>
      <label className="relative">
        <span className="sr-only">Mes</span>
        <select
          value={month}
          onChange={(e) => go(year, Number(e.target.value))}
          className="h-7 appearance-none bg-transparent px-1.5 text-[13px] font-medium outline-none"
        >
          {allowYear && <option value={0}>Año completo</option>}
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Año</span>
        <select value={year} onChange={(e) => go(Number(e.target.value), month)} className="h-7 appearance-none bg-transparent px-1 text-[13px] font-medium tabular outline-none">
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => step(1)} className="grid size-7 place-items-center rounded-full text-text-2 hover:bg-surface hover:text-text" aria-label="Periodo siguiente">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
