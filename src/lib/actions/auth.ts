"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { assertUser, endSession, startSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { str, toActionError, UserError, type ActionState } from "./util";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const password = z
  .string({ error: "Obligatorio" })
  .min(12, "Mínimo 12 caracteres")
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Debe incluir letras y números");

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = (str(fd, "email") ?? "").toLowerCase();
  const pass = String(fd.get("password") ?? "");
  const generic: ActionState = { ok: false, message: "Correo o contraseña incorrectos." };
  try {
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`).limit(1);
    if (!u || !u.active) {
      await bcrypt.hash(pass, 12); // mismo coste que una comprobación real: no revela si el correo existe
      return generic;
    }
    if (u.lockedUntil && u.lockedUntil > new Date()) {
      return { ok: false, message: "Cuenta bloqueada temporalmente por intentos fallidos. Inténtalo más tarde." };
    }
    const okPass = await bcrypt.compare(pass, u.passwordHash);
    if (!okPass) {
      const failed = u.failedLogins + 1;
      await db
        .update(schema.users)
        .set({ failedLogins: failed >= MAX_ATTEMPTS ? 0 : failed, lockedUntil: failed >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
        .where(eq(schema.users.id, u.id));
      if (failed >= MAX_ATTEMPTS) await audit(db, { entity: "user", entityId: u.id, action: "locked", userId: null, summary: "Bloqueo por intentos fallidos" });
      return generic;
    }
    await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
    await audit(db, { entity: "user", entityId: u.id, action: "login", userId: u.id });
    await startSession(u);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

/** Alta del primer administrador. Sólo funciona mientras no exista ningún usuario. */
export async function setupFirstAdmin(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const data = z
      .object({ name: z.string({ error: "Obligatorio" }).min(2, "Obligatorio").max(80), email: z.string({ error: "Obligatorio" }).email("Correo no válido"), password })
      .parse({ name: str(fd, "name"), email: str(fd, "email")?.toLowerCase(), password: fd.get("password") });
    if (fd.get("password") !== fd.get("confirm")) return { ok: false, fieldErrors: { confirm: "Las contraseñas no coinciden" } };
    const db = await getDb();
    const user = await db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.users);
      if (n > 0) throw new UserError("La configuración inicial ya se realizó.");
      const [u] = await tx.insert(schema.users).values({ name: data.name, email: data.email, passwordHash: await bcrypt.hash(data.password, 12), role: "admin" }).returning();
      await audit(tx, { entity: "user", entityId: u.id, action: "create", userId: u.id, after: { email: u.email, role: u.role }, summary: "Administrador inicial" });
      return u;
    });
    await startSession(user);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/");
}

/* ─────────────────────────── Gestión de usuarios ─────────────────────────── */

export async function saveUser(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const admin = await assertUser("admin");
    const id = str(fd, "id");
    const base = z.object({
      name: z.string({ error: "Obligatorio" }).min(2).max(80),
      email: z.string({ error: "Obligatorio" }).email("Correo no válido"),
      role: z.enum(["admin", "editor", "viewer"]),
      active: z.boolean(),
    });
    const data = base.parse({ name: str(fd, "name"), email: str(fd, "email")?.toLowerCase(), role: str(fd, "role"), active: fd.get("active") !== "off" });
    const newPass = str(fd, "password");
    const db = await getDb();
    await db.transaction(async (tx) => {
      if (id) {
        const [prev] = await tx.select().from(schema.users).where(eq(schema.users.id, id));
        if (!prev) throw new UserError("El usuario no existe.");
        if (prev.id === admin.id && (data.role !== "admin" || !data.active)) throw new UserError("No puedes quitarte a ti mismo el rol de administrador ni desactivarte.");
        const patch: Partial<typeof schema.users.$inferInsert> = { ...data, updatedAt: new Date() };
        if (newPass) patch.passwordHash = await bcrypt.hash(password.parse(newPass), 12);
        await tx.update(schema.users).set(patch).where(eq(schema.users.id, id));
        await audit(tx, { entity: "user", entityId: id, action: "update", userId: admin.id, before: { name: prev.name, email: prev.email, role: prev.role, active: prev.active }, after: { ...data, passwordChanged: Boolean(newPass) } });
      } else {
        if (!newPass) throw new UserError("Indica una contraseña inicial.");
        const [u] = await tx.insert(schema.users).values({ ...data, passwordHash: await bcrypt.hash(password.parse(newPass), 12) }).returning();
        await audit(tx, { entity: "user", entityId: u.id, action: "create", userId: admin.id, after: data });
      }
    });
    revalidatePath("/ajustes/usuarios");
    return { ok: true, message: "Usuario guardado." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function changeOwnPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const me = await assertUser("viewer");
    const current = String(fd.get("current") ?? "");
    const next = password.parse(fd.get("password"));
    if (fd.get("password") !== fd.get("confirm")) return { ok: false, fieldErrors: { confirm: "Las contraseñas no coinciden" } };
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, me.id));
    if (!(await bcrypt.compare(current, u.passwordHash))) return { ok: false, fieldErrors: { current: "Contraseña actual incorrecta" } };
    await db.update(schema.users).set({ passwordHash: await bcrypt.hash(next, 12), updatedAt: new Date() }).where(eq(schema.users.id, me.id));
    await audit(db, { entity: "user", entityId: me.id, action: "password_change", userId: me.id });
    return { ok: true, message: "Contraseña actualizada." };
  } catch (e) {
    return toActionError(e);
  }
}
