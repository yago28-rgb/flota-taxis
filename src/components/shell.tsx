"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid, FileText, ArrowLeftRight, BadgeCheck, Car, Users, Sheet, History, Settings, Plus, LogOut,
} from "lucide-react";
import { cx } from "./ui";
import { ThemeToggle } from "./client";
import { logout } from "@/lib/actions/auth";

const NAV = [
  { href: "/", label: "Inicio", icon: LayoutGrid },
  { href: "/facturas", label: "Facturas", icon: FileText, badgeKey: "pending" as const },
  { href: "/movimientos", label: "Movimientos", icon: ArrowLeftRight },
  { href: "/licencias", label: "Licencias", icon: BadgeCheck },
  { href: "/vehiculos", label: "Vehículos", icon: Car },
  { href: "/conductores", label: "Conductores", icon: Users },
  { href: "/exportar", label: "Exportar", icon: Sheet },
  { href: "/historial", label: "Historial", icon: History },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

const MOBILE = ["/", "/facturas", "UPLOAD", "/movimientos", "MORE"];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ user, pending }: { user: { name: string; role: string }; pending: number }) {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-[var(--glass)] backdrop-blur-2xl backdrop-saturate-150 lg:flex">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <Logo />
        <span className="display text-[17px] font-semibold">Flota</span>
      </div>
      <div className="px-3 pb-3">
        <Link
          href="/facturas/subir"
          className="flex h-10 items-center justify-center gap-2 rounded-xl bg-accent text-[14px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-all hover:bg-accent-hover active:scale-[0.98]"
        >
          <Plus className="size-4" strokeWidth={2.4} />
          Subir factura
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Principal">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "group flex h-9 items-center gap-3 rounded-[10px] px-3 text-[14px] transition-colors duration-150",
                active ? "bg-fill text-text font-medium" : "text-text-2 hover:bg-fill-2 hover:text-text",
              )}
            >
              <item.icon className={cx("size-[18px]", active ? "text-accent" : "text-text-3 group-hover:text-text-2")} strokeWidth={1.8} />
              <span className="flex-1">{item.label}</span>
              {item.badgeKey && pending > 0 && (
                <span className="tabular rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning">{pending}</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-fill text-[13px] font-semibold text-text-2">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{user.name}</div>
            <div className="text-[11px] text-text-3">{{ admin: "Administrador", editor: "Editor", viewer: "Consulta" }[user.role]}</div>
          </div>
          <form action={logout}>
            <button className="grid size-8 place-items-center rounded-full text-text-3 hover:bg-fill-2 hover:text-text" title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
        <div className="mt-2 flex justify-center">
          <ThemeToggle compact />
        </div>
      </div>
    </aside>
  );
}

export function MobileBar({ pending }: { pending: number }) {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[var(--glass)] pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl backdrop-saturate-150 lg:hidden"
      aria-label="Principal"
    >
      <div className="mx-auto grid h-[58px] max-w-md grid-cols-5">
        {MOBILE.map((key) => {
          if (key === "UPLOAD") {
            return (
              <Link key={key} href="/facturas/subir" className="flex items-center justify-center" aria-label="Subir factura">
                <span className="grid size-11 place-items-center rounded-full bg-accent text-white shadow-raised transition-transform active:scale-95">
                  <Plus className="size-5" strokeWidth={2.4} />
                </span>
              </Link>
            );
          }
          const item = key === "MORE" ? { href: "/mas", label: "Más", icon: Settings } : NAV.find((n) => n.href === key)!;
          const active = key === "MORE" ? ["/licencias", "/vehiculos", "/conductores", "/exportar", "/historial", "/ajustes", "/mas"].some((h) => isActive(pathname, h)) : isActive(pathname, item.href);
          return (
            <Link key={key} href={item.href} className={cx("relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium", active ? "text-accent" : "text-text-3")}>
              <item.icon className="size-[22px]" strokeWidth={active ? 2 : 1.7} />
              {item.label}
              {key === "/facturas" && pending > 0 && <span className="absolute right-[calc(50%-18px)] top-1.5 size-2 rounded-full bg-warning" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function MobileHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-line bg-[var(--glass)] px-4 pt-[env(safe-area-inset-top)] backdrop-blur-2xl lg:hidden">
      <div className="flex items-center gap-2">
        <Logo small />
        <span className="display text-[15px] font-semibold">Flota</span>
      </div>
      <ThemeToggle compact />
    </header>
  );
}

export const MORE_LINKS = NAV.filter((n) => !["/", "/facturas", "/movimientos"].includes(n.href));

function Logo({ small }: { small?: boolean }) {
  return (
    <span className={cx("grid place-items-center rounded-[9px] bg-text text-bg", small ? "size-6" : "size-7")} aria-hidden>
      <svg viewBox="0 0 24 24" className={small ? "size-3.5" : "size-4"} fill="none">
        <path d="M4 15.5V12l2-4.5h12l2 4.5v3.5M4 15.5h16M4 15.5V18m16-2.5V18M7.5 12h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="8" cy="15.5" r="0.9" fill="currentColor" />
        <circle cx="16" cy="15.5" r="0.9" fill="currentColor" />
      </svg>
    </span>
  );
}

/** Lista de secciones secundarias para la pestaña «Más» en móvil. */
export function MoreMenu() {
  return (
    <ul className="divide-y divide-line">
      {MORE_LINKS.map((l) => (
        <li key={l.href}>
          <Link href={l.href} className="flex items-center gap-3 px-5 py-3.5 active:bg-fill-2">
            <span className="grid size-8 place-items-center rounded-[9px] bg-accent-soft text-accent"><l.icon className="size-4" /></span>
            <span className="flex-1 font-medium">{l.label}</span>
            <svg className="size-4 text-text-3" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </Link>
        </li>
      ))}
    </ul>
  );
}
