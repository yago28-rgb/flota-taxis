import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SESSION_COOKIE, SESSION_HOURS, signSession, verifySession } from "./token";

export type Role = "admin" | "editor" | "viewer";
export type CurrentUser = { id: string; name: string; email: string; role: Role };

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export function can(user: Pick<CurrentUser, "role">, min: Role): boolean {
  return RANK[user.role] >= RANK[min];
}

/** Lee la sesión y comprueba en base de datos que el usuario sigue activo. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, claims.sub)).limit(1);
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

/** Para páginas: redirige a /login si no hay sesión o el rol no alcanza. */
export async function requireUser(min: Role = "viewer"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, min)) redirect("/?denied=1");
  return user;
}

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

/** Para acciones y rutas API: lanza AuthError en lugar de redirigir. */
export async function assertUser(min: Role = "viewer"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, "Sesión no válida. Vuelve a iniciar sesión.");
  if (!can(user, min)) throw new AuthError(403, "No tienes permisos para esta acción.");
  return user;
}

export async function startSession(user: { id: string; role: Role; name: string }) {
  const token = await signSession({ sub: user.id, role: user.role, name: user.name });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
