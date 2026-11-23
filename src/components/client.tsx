"use client";
import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Moon, Sun, Monitor, X, Check, AlertCircle } from "lucide-react";
import { buttonClass, cx, Spinner } from "./ui";
import type { ActionState } from "@/lib/actions/util";

/* ─────────────────────────── Tema ─────────────────────────── */

type Theme = "system" | "light" | "dark";
function readTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}
function subscribeTheme(cb: () => void) {
  window.addEventListener("flota-theme", cb);
  return () => window.removeEventListener("flota-theme", cb);
}
function writeTheme(t: Theme) {
  const root = document.documentElement;
  try {
    if (t === "system") localStorage.removeItem("flota-theme");
    else localStorage.setItem("flota-theme", t);
  } catch {}
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  window.dispatchEvent(new Event("flota-theme"));
}

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as Theme);
  const apply = (t: Theme) => writeTheme(t);
  const opts = [
    { v: "light" as const, icon: Sun, label: "Claro" },
    { v: "dark" as const, icon: Moon, label: "Oscuro" },
    { v: "system" as const, icon: Monitor, label: "Automático" },
  ];
  return (
    <div className={cx("inline-flex rounded-full bg-fill-2 p-0.5", compact && "scale-95")} role="radiogroup" aria-label="Apariencia">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={theme === o.v}
          title={o.label}
          onClick={() => apply(o.v)}
          className={cx("grid size-7 place-items-center rounded-full transition-all duration-200", theme === o.v ? "bg-surface text-text shadow-card" : "text-text-3 hover:text-text")}
        >
          <o.icon className="size-3.5" strokeWidth={2} />
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────── Diálogo ─────────────────────────── */

export function Modal({
  trigger,
  title,
  description,
  children,
  wide,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: (open: () => void) => ReactNode;
  title: string;
  description?: ReactNode;
  children: (close: () => void) => ReactNode;
  wide?: boolean;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setInnerOpen(o));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      {trigger?.(() => setOpen(true))}
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && setOpen(false)}
        className={cx(
          "m-auto w-[calc(100%-24px)] max-h-[calc(100dvh-48px)] overflow-visible rounded-[22px] bg-transparent p-0 text-text backdrop:bg-black/30",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
      >
        {open && (
          <div className="animate-sheet flex max-h-[calc(100dvh-48px)] flex-col overflow-hidden rounded-[22px] bg-surface shadow-float">
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
                {description && <p className="mt-0.5 text-[13px] text-text-2">{description}</p>}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid size-7 place-items-center rounded-full bg-fill-2 text-text-2 hover:bg-fill" aria-label="Cerrar">
                <X className="size-3.5" strokeWidth={2.4} />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-5">{children(() => setOpen(false))}</div>
          </div>
        )}
      </dialog>
    </>
  );
}

/* ─────────────────────────── Formularios con acción de servidor ─────────────────────────── */

export function SubmitButton({ children, variant = "primary", className, pendingText }: { children: ReactNode; variant?: "primary" | "secondary" | "danger"; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, "md", className)}>
      {pending && <Spinner className="size-3.5" />}
      {pending ? pendingText ?? "Guardando…" : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return (
    <div
      role={state.ok ? "status" : "alert"}
      className={cx(
        "flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium animate-fade",
        state.ok ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative",
      )}
    >
      {state.ok ? <Check className="size-4" /> : <AlertCircle className="size-4" />}
      {state.message}
    </div>
  );
}

/**
 * Formulario conectado a una server action. `children` recibe el estado para mostrar errores
 * por campo. Con `onSuccess` se puede cerrar un diálogo o navegar.
 */
export function ActionForm({
  action,
  children,
  onSuccess,
  className,
  resetOnSuccess,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  children: (state: ActionState) => ReactNode;
  onSuccess?: (state: NonNullable<ActionState>) => void;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const last = useRef<ActionState>(null);
  useEffect(() => {
    if (state && state !== last.current) {
      last.current = state;
      if (state.ok) {
        if (resetOnSuccess) formRef.current?.reset();
        onSuccess?.(state);
      }
    }
  }, [state, onSuccess, resetOnSuccess]);
  return (
    <form ref={formRef} action={formAction} className={className} noValidate>
      {children(state)}
    </form>
  );
}

/* ─────────────────────────── Filtros por URL ─────────────────────────── */

export function useQueryState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  return { params, set, pending };
}

export function FilterSelect({ name, label, options, allLabel = "Todos" }: { name: string; label: string; options: { value: string; label: string }[]; allLabel?: string }) {
  const { params, set } = useQueryState();
  const value = params.get(name) ?? "";
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => set({ [name]: e.target.value })}
        className={cx(
          "h-8 appearance-none rounded-full border-0 pl-3 pr-8 text-[13px] font-medium outline-none transition-colors",
          value ? "bg-accent-soft text-accent" : "bg-fill-2 text-text hover:bg-fill",
        )}
      >
        <option value="">{label}: {allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2.5 size-3 opacity-60" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </label>
  );
}

export function SegmentedLinks({ name, options }: { name: string; options: { value: string; label: string; count?: number }[] }) {
  const { params, set } = useQueryState();
  const value = params.get(name) ?? options[0]?.value ?? "";
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-fill-2 p-0.5 scrollbar-none">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => set({ [name]: o.value === options[0].value ? null : o.value })}
          className={cx(
            "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-all duration-200",
            value === o.value ? "bg-surface text-text shadow-card" : "text-text-2 hover:text-text",
          )}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && <span className="tabular text-[11px] text-text-3">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ name = "q", placeholder = "Buscar" }: { name?: string; placeholder?: string }) {
  const { params, set } = useQueryState();
  const [v, setV] = useState(params.get(name) ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get(name) ?? "") !== v) set({ [name]: v });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      placeholder={placeholder}
      type="search"
      className="h-8 w-full min-w-0 rounded-full border-0 bg-fill-2 px-3.5 text-[13px] outline-none placeholder:text-text-3 focus:bg-fill focus:ring-4 focus:ring-accent-soft sm:w-56"
    />
  );
}

/** Hace navegables las filas de tabla con `data-href`. */
export function RowLinks({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <div
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a,button,input,select,label,textarea")) return;
        const tr = target.closest("tr[data-href]") as HTMLElement | null;
        if (tr?.dataset.href) router.push(tr.dataset.href);
      }}
    >
      {children}
    </div>
  );
}
