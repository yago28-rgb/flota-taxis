"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { assertUser } from "@/lib/auth/session";
import { audit, diff } from "@/lib/audit";
import { parseMoneyToCents } from "@/lib/format";
import { assertPeriodsOpen } from "@/lib/invoices/service";
import { str, toActionError, UserError, type ActionState } from "./util";

/* ─────────────────────────── Categorías ─────────────────────────── */

const categorySchema = z.object({
  name: z.string({ error: "Obligatorio" }).min(1, "Obligatorio").max(80),
  kind: z.enum(["income", "expense", "neutral"], { error: "Elige la naturaleza" }),
  description: z.string().max(500).nullable(),
  keywords: z.array(z.string().max(40)).max(30),
  active: z.boolean(),
});

export async function saveCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const id = str(fd, "id");
    const data = categorySchema.parse({
      name: str(fd, "name"),
      kind: str(fd, "kind"),
      description: str(fd, "description"),
      keywords: (str(fd, "keywords") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      active: fd.get("active") !== "off",
    });
    const db = await getDb();
    await db.transaction(async (tx) => {
      if (id) {
        const [prev] = await tx.select().from(schema.categories).where(eq(schema.categories.id, id));
        if (!prev) throw new UserError("La categoría no existe.");
        const d = diff(prev, data);
        if (!d.changed) return;
        await tx.update(schema.categories).set({ ...data, updatedAt: new Date() }).where(eq(schema.categories.id, id));
        await audit(tx, { entity: "category", entityId: id, action: "update", userId: user.id, before: d.before, after: d.after });
      } else {
        const [row] = await tx.insert(schema.categories).values(data).returning();
        await audit(tx, { entity: "category", entityId: row.id, action: "create", userId: user.id, after: row });
      }
    });
    revalidatePath("/ajustes/categorias");
    return { ok: true, message: "Categoría guardada." };
  } catch (e) {
    return toActionError(e);
  }
}

/* ─────────────────────────── Movimientos ─────────────────────────── */

const movementSchema = z.object({
  occurredOn: z.string({ error: "Obligatorio" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
  categoryId: z.string({ error: "Elige una categoría" }).uuid("Elige una categoría"),
  amountCents: z.number({ error: "Importe no válido" }).int().refine((v) => v !== 0, "El importe no puede ser 0"),
  description: z.string().max(500).nullable(),
  licenseId: z.string().uuid().nullable(),
  vehicleId: z.string().uuid().nullable(),
  driverId: z.string().uuid().nullable(),
});

function parseMovement(fd: FormData) {
  return movementSchema.parse({
    occurredOn: str(fd, "occurredOn"),
    categoryId: str(fd, "categoryId"),
    amountCents: parseMoneyToCents(str(fd, "amount")) ?? undefined,
    description: str(fd, "description"),
    licenseId: str(fd, "licenseId"),
    vehicleId: str(fd, "vehicleId"),
    driverId: str(fd, "driverId"),
  });
}

export async function saveMovement(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const id = str(fd, "id");
    const data = parseMovement(fd);
    const db = await getDb();
    await db.transaction(async (tx) => {
      if (id) {
        const [prev] = await tx.select().from(schema.movements).where(eq(schema.movements.id, id));
        if (!prev) throw new UserError("El movimiento no existe.");
        if (prev.voidedAt) throw new UserError("El movimiento está anulado y no puede modificarse.");
        if (prev.source === "invoice") throw new UserError("Este movimiento procede de una factura: corrígelo reabriendo la factura.");
        await assertPeriodsOpen(tx, [prev.occurredOn, data.occurredOn]);
        const d = diff(prev, data);
        if (!d.changed) return;
        await tx.update(schema.movements).set({ ...data, updatedAt: new Date() }).where(eq(schema.movements.id, id));
        await audit(tx, { entity: "movement", entityId: id, action: "update", userId: user.id, before: d.before, after: d.after });
      } else {
        await assertPeriodsOpen(tx, [data.occurredOn]);
        const [row] = await tx.insert(schema.movements).values({ ...data, source: "manual", createdBy: user.id }).returning();
        await audit(tx, { entity: "movement", entityId: row.id, action: "create", userId: user.id, after: row });
      }
    });
    revalidatePath("/movimientos");
    revalidatePath("/");
    return { ok: true, message: "Movimiento guardado." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function voidMovement(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const id = z.string().uuid().parse(str(fd, "id"));
    const reason = z.string({ error: "Indica el motivo" }).min(3, "Indica el motivo").max(300).parse(str(fd, "reason"));
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [m] = await tx.select().from(schema.movements).where(and(eq(schema.movements.id, id), isNull(schema.movements.voidedAt)));
      if (!m) throw new UserError("El movimiento no existe o ya está anulado.");
      if (m.source === "invoice") throw new UserError("Este movimiento procede de una factura: reabre la factura para corregirlo.");
      await assertPeriodsOpen(tx, [m.occurredOn]);
      await tx.update(schema.movements).set({ voidedAt: new Date(), voidReason: reason, updatedAt: new Date() }).where(eq(schema.movements.id, id));
      await audit(tx, { entity: "movement", entityId: id, action: "void", userId: user.id, before: { voidedAt: null }, after: { voidReason: reason }, summary: `Anulado: ${reason}` });
    });
    revalidatePath("/movimientos");
    revalidatePath("/");
    return { ok: true, message: "Movimiento anulado. Se conserva en el historial." };
  } catch (e) {
    return toActionError(e);
  }
}

/* ─────────────────────────── Cierre de periodos ─────────────────────────── */

export async function togglePeriodLock(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("admin");
    const year = z.coerce.number().int().min(2000).max(2100).parse(fd.get("year"));
    const month = z.coerce.number().int().min(1).max(12).parse(fd.get("month"));
    const db = await getDb();
    let locked = false;
    await db.transaction(async (tx) => {
      const [lock] = await tx.select().from(schema.periodLocks).where(and(eq(schema.periodLocks.year, year), eq(schema.periodLocks.month, month)));
      if (lock) {
        await tx.delete(schema.periodLocks).where(and(eq(schema.periodLocks.year, year), eq(schema.periodLocks.month, month)));
        await audit(tx, { entity: "period", entityId: `${year}-${month}`, action: "unlock", userId: user.id, before: lock });
      } else {
        await tx.insert(schema.periodLocks).values({ year, month, lockedBy: user.id });
        await audit(tx, { entity: "period", entityId: `${year}-${month}`, action: "lock", userId: user.id, after: { year, month } });
        locked = true;
      }
    });
    revalidatePath("/movimientos");
    return { ok: true, message: locked ? "Mes cerrado." : "Mes reabierto." };
  } catch (e) {
    return toActionError(e);
  }
}
