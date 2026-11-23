import Link from "next/link";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

export { clsx as cx };

/* ─────────────────────────── Botones ─────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "plain";
type ButtonSize = "sm" | "md" | "lg";

const btnBase =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background,color,box-shadow,transform,opacity] duration-200 ease-[var(--ease-apple)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 select-none";
const btnVariant: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover shadow-[0_1px_2px_rgba(0,0,0,0.12)]",
  secondary: "bg-fill-2 text-text hover:bg-fill",
  ghost: "text-accent hover:bg-accent-soft",
  danger: "bg-negative-soft text-negative hover:bg-negative hover:text-white",
  plain: "text-text-2 hover:text-text hover:bg-fill-2",
};
const btnSize: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] rounded-full",
  md: "h-9 px-4 text-[14px] rounded-full",
  lg: "h-11 px-5 text-[15px] rounded-full",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return clsx(btnBase, btnVariant[variant], btnSize[size], className);
}

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...p} />;
}

export function ButtonLink({ variant = "primary", size = "md", className, ...p }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...p} />;
}

/* ─────────────────────────── Superficies ─────────────────────────── */

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={clsx("rounded-[var(--radius-card)] bg-surface shadow-card", className)} {...p} />;
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 pb-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-text">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-text-2">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between animate-in">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[13px] font-medium text-text-2">{eyebrow}</div>}
        <h1 className="display text-[28px] font-semibold leading-tight text-text sm:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[15px] text-text-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, children, action }: { title: string; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-[13px] text-text-2">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ─────────────────────────── Formularios ─────────────────────────── */

const control =
  "w-full rounded-[10px] border border-line-strong bg-surface px-3 text-[15px] text-text placeholder:text-text-3 transition-[border,box-shadow] duration-150 outline-none focus:border-accent focus:ring-4 focus:ring-accent-soft disabled:opacity-60 disabled:bg-surface-2";

export function inputClass(className?: string, invalid?: boolean) {
  return clsx(control, "h-10", invalid && "border-negative focus:border-negative focus:ring-negative-soft", className);
}

export function Input({ className, invalid, ...p }: ComponentProps<"input"> & { invalid?: boolean }) {
  return <input className={inputClass(className, invalid)} aria-invalid={invalid || undefined} {...p} />;
}

export function Select({ className, invalid, children, ...p }: ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <div className="relative">
      <select className={clsx(inputClass(className, invalid), "appearance-none pr-9")} aria-invalid={invalid || undefined} {...p}>
        {children}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-text-3" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Textarea({ className, invalid, ...p }: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return <textarea className={clsx(control, "min-h-[88px] py-2.5 leading-relaxed", invalid && "border-negative", className)} {...p} />;
}

export function Field({ label, hint, error, children, className, htmlFor, required }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string; htmlFor?: string; required?: boolean }) {
  // Si no se indica `htmlFor`, la etiqueta envuelve al control y queda asociada a él.
  const caption = (
    <span className="text-[13px] font-medium text-text-2">
      {label}
      {required && <span className="text-negative"> *</span>}
    </span>
  );
  const note = error ? <span className="text-[12px] text-negative" role="alert">{error}</span> : hint ? <span className="text-[12px] text-text-3">{hint}</span> : null;
  if (htmlFor) {
    return (
      <div className={clsx("flex flex-col gap-1.5", className)}>
        <label htmlFor={htmlFor}>{caption}</label>
        {children}
        {note}
      </div>
    );
  }
  return (
    <label className={clsx("flex flex-col gap-1.5", className)}>
      {caption}
      {children}
      {note}
    </label>
  );
}

/* ─────────────────────────── Indicadores ─────────────────────────── */

type Tone = "neutral" | "accent" | "positive" | "negative" | "warning";
const tones: Record<Tone, string> = {
  neutral: "bg-fill-2 text-text-2",
  accent: "bg-accent-soft text-accent",
  positive: "bg-positive-soft text-positive",
  negative: "bg-negative-soft text-negative",
  warning: "bg-warning-soft text-warning",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  uploaded: { label: "Sin procesar", tone: "neutral" },
  processing: { label: "Procesando", tone: "accent" },
  needs_review: { label: "Pendiente de revisión", tone: "warning" },
  failed: { label: "Error de lectura", tone: "negative" },
  confirmed: { label: "Confirmada", tone: "positive" },
  rejected: { label: "Descartada", tone: "neutral" },
};

export const ASSET_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Activo", tone: "positive" },
  inactive: { label: "Inactivo", tone: "neutral" },
  suspended: { label: "Suspendido", tone: "warning" },
  retired: { label: "Baja", tone: "neutral" },
};

export const KIND: Record<string, { label: string; tone: Tone }> = {
  income: { label: "Ingreso", tone: "positive" },
  expense: { label: "Gasto", tone: "negative" },
  neutral: { label: "Neutro", tone: "neutral" },
};

export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: Tone }>; value: string }) {
  const s = map[value] ?? { label: value, tone: "neutral" as Tone };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function Notice({ tone = "accent", title, children, className, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={clsx("flex items-start gap-3 rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed", tones[tone], className)} role={tone === "negative" ? "alert" : "status"}>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={clsx(title && "mt-0.5", "opacity-90")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center animate-fade">
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-fill-2 text-text-2">{icon}</div>}
      <h3 className="text-[17px] font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-[14px] text-text-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ─────────────────────────── Tablas ─────────────────────────── */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[14px]">{children}</table>
    </div>
  );
}
export function Th({ children, className, align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return (
    <th className={clsx("sticky top-0 whitespace-nowrap border-b border-line bg-surface px-4 py-2.5 text-[12px] font-medium text-text-2", align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left", className)}>
      {children}
    </th>
  );
}
export function Td({ children, className, align = "left", colSpan }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center"; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={clsx("border-b border-line px-4 py-3 align-middle", align === "right" ? "text-right tabular" : align === "center" ? "text-center" : "", className)}>
      {children}
    </td>
  );
}
export function Tr({ children, className, href }: { children: ReactNode; className?: string; href?: string }) {
  return <tr className={clsx("transition-colors duration-150 last:[&>td]:border-0", href && "cursor-pointer hover:bg-fill-2", className)} data-href={href}>{children}</tr>;
}

/* ─────────────────────────── Números ─────────────────────────── */

export function Money({ cents, className, signed, tone }: { cents: number | null | undefined; className?: string; signed?: boolean; tone?: "auto" | "none" }) {
  if (cents === null || cents === undefined) return <span className={clsx("text-text-3", className)}>—</span>;
  const s = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", signDisplay: signed ? "exceptZero" : "auto" }).format(cents / 100);
  return (
    <span className={clsx("tabular whitespace-nowrap", tone === "auto" && (cents > 0 ? "text-positive" : cents < 0 ? "text-negative" : ""), className)}>{s}</span>
  );
}

export function Delta({ value, inverse }: { value: number | null; inverse?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-[12px] text-text-3">sin referencia</span>;
  const up = value > 0;
  const good = inverse ? !up : up;
  const flat = Math.abs(value) < 0.05;
  return (
    <span className={clsx("inline-flex items-center gap-0.5 text-[12px] font-medium tabular", flat ? "text-text-2" : good ? "text-positive" : "text-negative")}>
      {!flat && (
        <svg viewBox="0 0 12 12" className={clsx("size-3", !up && "rotate-180")} aria-hidden>
          <path d="M6 2.5l3.5 4h-7z" fill="currentColor" />
        </svg>
      )}
      {Math.abs(value).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %
    </span>
  );
}

export function Confidence({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const pct = Math.round(value * 100);
  const tone = value >= 0.9 ? "text-positive" : value >= 0.75 ? "text-text-2" : "text-warning";
  return (
    <span className={clsx("inline-flex items-center gap-1 text-[11px] font-medium tabular", tone)} title={`Confianza de lectura: ${pct} %`}>
      <span className="relative inline-block h-1 w-6 overflow-hidden rounded-full bg-fill">
        <span className="absolute inset-y-0 left-0 rounded-full bg-current" style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx("size-4 animate-[spin_0.8s_linear_infinite]", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-4 py-2.5 text-[14px]">
          <dt className="text-text-2">{it.label}</dt>
          <dd className="text-right font-medium">{it.value ?? <span className="text-text-3">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
