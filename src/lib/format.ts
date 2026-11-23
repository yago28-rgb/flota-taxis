/** Utilidades de formato y normalización (compartidas entre servidor y cliente). */

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const eurCompact = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCents(cents: number | null | undefined, currency = "EUR"): string {
  if (cents === null || cents === undefined) return "—";
  if (currency !== "EUR") {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
  }
  return eur.format(cents / 100);
}

export function formatCentsCompact(cents: number): string {
  return eurCompact.format(cents / 100);
}

/** Convierte "1.234,56", "1234.56", "1234,5" o un número a céntimos. Devuelve null si no es válido. */
export function parseMoneyToCents(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = String(input).trim().replace(/[€\s]/g, "");
  if (!s) return null;
  const negative = /^-|^\(.*\)$/.test(s);
  s = s.replace(/[()\-+]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma !== -1) s = s.replace(/,/g, "");
  else if (lastComma === -1 && (s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = Math.round(parseFloat(s) * 100);
  return negative ? -value : value;
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

const dateFmt = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
});
const monthFmt = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
const monthShortFmt = new Intl.DateTimeFormat("es-ES", { month: "short", timeZone: "UTC" });

/** `iso` en formato YYYY-MM-DD. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return dateTimeFmt.format(d);
}

export function monthLabel(year: number, month: number): string {
  const s = monthFmt.format(new Date(Date.UTC(year, month - 1, 1)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function monthShort(year: number, month: number): string {
  return monthShortFmt.format(new Date(Date.UTC(year, month - 1, 1))).replace(".", "");
}

/** Valida una fecha ISO real (rechaza 2025-02-30). */
export function isValidIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

/** Matrícula normalizada: mayúsculas, sin espacios ni guiones. */
export function normalizePlate(plate: string | null | undefined): string | null {
  if (!plate) return null;
  const p = plate.toUpperCase().replace(/[\s\-·.]/g, "");
  return p || null;
}

export function normalizeTaxId(id: string | null | undefined): string | null {
  if (!id) return null;
  const v = id.toUpperCase().replace(/[\s\-.]/g, "").replace(/^ES/, "");
  return v || null;
}

export function normalizeLicense(n: string | null | undefined): string | null {
  if (!n) return null;
  const v = n.toUpperCase().replace(/\s+/g, " ").trim();
  return v || null;
}

/** Compara textos ignorando mayúsculas, tildes y espacios repetidos. */
export function foldText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
