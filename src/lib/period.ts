import { todayIso } from "./format";

export type SP = Record<string, string | string[] | undefined>;

export function one(sp: SP, key: string): string | null {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : null;
}

export function uuidParam(sp: SP, key: string): string | null {
  const v = one(sp, key);
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/** Periodo seleccionado (?y=2026&m=3). Por defecto, el mes actual en Madrid. */
export function periodFrom(sp: SP) {
  const [ty, tm] = todayIso().split("-").map(Number);
  const y = Number(one(sp, "y"));
  const m = Number(one(sp, "m"));
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : ty;
  const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : one(sp, "y") ? 0 : tm; // m=0 ⇒ año completo
  return { year, month, isCurrent: year === ty && month === tm };
}
