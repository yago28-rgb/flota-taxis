"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { assertUser } from "@/lib/auth/session";
import { audit, diff } from "@/lib/audit";
import { normalizeLicense, normalizePlate, todayIso } from "@/lib/format";
import { optDate, str, toActionError, UserError, type ActionState } from "./util";

const status = z.enum(["active", "inactive", "suspended", "retired"]);

/* ─────────────────────────── Licencias ─────────────────────────── */

const licenseSchema = z.object({
  number: z.string({ error: "Obligatorio" }).min(1, "Obligatorio").max(40),
  status,
  acquiredOn: optDate,
  notes: z.string().max(2000).nullable(),
});

export async function saveLicense(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const id = str(fd, "id");
    const data = licenseSchema.parse({
      number: normalizeLicense(str(fd, "number")),
      status: str(fd, "status") ?? "active",
      acquiredOn: str(fd, "acquiredOn"),
      notes: str(fd, "notes"),
    });
    const db = await getDb();
    const savedId = await db.transaction(async (tx) => {
      if (id) {
        const [prev] = await tx.select().from(schema.licenses).where(eq(schema.licenses.id, id));
        if (!prev) throw new UserError("La licencia no existe.");
        const d = diff(prev, data);
        if (!d.changed) return id;
        await tx.update(schema.licenses).set({ ...data, updatedAt: new Date() }).where(eq(schema.licenses.id, id));
        await audit(tx, { entity: "license", entityId: id, action: "update", userId: user.id, before: d.before, after: d.after });
        return id;
      }
      const [row] = await tx.insert(schema.licenses).values(data).returning();
      await audit(tx, { entity: "license", entityId: row.id, action: "create", userId: user.id, after: row, summary: `Alta de licencia ${row.number}` });
      return row.id;
    });
    revalidatePath("/licencias");
    return { ok: true, message: "Licencia guardada.", id: savedId };
  } catch (e) {
    return toActionError(e);
  }
}

/* ─────────────────────────── Vehículos ─────────────────────────── */

const vehicleSchema = z.object({
  plate: z.string({ error: "Obligatorio" }).regex(/^[A-Z0-9]{4,10}$/, "Matrícula no válida"),
  make: z.string().max(60).nullable(),
  model: z.string().max(60).nullable(),
  status,
  notes: z.string().max(2000).nullable(),
});

export async function saveVehicle(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const id = str(fd, "id");
    const data = vehicleSchema.parse({
      plate: normalizePlate(str(fd, "plate")),
      make: str(fd, "make"),
      model: str(fd, "model"),
      status: str(fd, "status") ?? "active",
      notes: str(fd, "notes"),
    });
    const db = await getDb();
    const savedId = await db.transaction(async (tx) => {
      if (id) {
        const [prev] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, id));
        if (!prev) throw new UserError("El vehículo no existe.");
        const d = diff(prev, data);
        if (!d.changed) return id;
        await tx.update(schema.vehicles).set({ ...data, updatedAt: new Date() }).where(eq(schema.vehicles.id, id));
        await audit(tx, { entity: "vehicle", entityId: id, action: "update", userId: user.id, before: d.before, after: d.after });
        return id;
      }
      const [row] = await tx.insert(schema.vehicles).values(data).returning();
      await audit(tx, { entity: "vehicle", entityId: row.id, action: "create", userId: user.id, after: row, summary: `Alta de vehículo ${row.plate}` });
      // Adscripción opcional a una licencia en el alta.
      const licenseId = str(fd, "licenseId");
      if (licenseId) {
        const startedOn = str(fd, "startedOn") ?? todayIso();
        await attachVehicleTx(tx, licenseId, row.id, startedOn, user.id);
      }
      return row.id;
    });
    revalidatePath("/vehiculos");
    revalidatePath("/licencias");
    return { ok: true, message: "Vehículo guardado.", id: savedId };
  } catch (e) {
    return toActionError(e);
  }
}

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

async function attachVehicleTx(tx: Tx, licenseId: string, vehicleId: string, startedOn: string, userId: string) {
  // Cierra la adscripción abierta de la licencia y la del vehículo (el historial se conserva).
  const open = await tx
    .select()
    .from(schema.licenseVehicles)
    .where(and(isNull(schema.licenseVehicles.endedOn), sql`(${schema.licenseVehicles.licenseId} = ${licenseId} OR ${schema.licenseVehicles.vehicleId} = ${vehicleId})`));
  for (const o of open) {
    if (o.startedOn > startedOn) throw new UserError("La fecha de inicio es anterior a una adscripción vigente. Revisa el historial.");
    const endedOn = prevDay(startedOn) < o.startedOn ? o.startedOn : prevDay(startedOn);
    await tx.update(schema.licenseVehicles).set({ endedOn }).where(eq(schema.licenseVehicles.id, o.id));
    await audit(tx, { entity: "license_vehicle", entityId: o.id, action: "close", userId, before: { endedOn: null }, after: { endedOn } });
  }
  const [row] = await tx.insert(schema.licenseVehicles).values({ licenseId, vehicleId, startedOn }).returning();
  await audit(tx, { entity: "license_vehicle", entityId: row.id, action: "create", userId, after: row, summary: "Vehículo adscrito a licencia" });
}

function prevDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function attachVehicle(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const parsed = z
      .object({ licenseId: z.string().uuid("Elige una licencia"), vehicleId: z.string().uuid("Elige un vehículo"), startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida") })
      .parse({ licenseId: str(fd, "licenseId"), vehicleId: str(fd, "vehicleId"), startedOn: str(fd, "startedOn") });
    const db = await getDb();
    await db.transaction((tx) => attachVehicleTx(tx, parsed.licenseId, parsed.vehicleId, parsed.startedOn, user.id));
    revalidatePath("/licencias");
    revalidatePath("/vehiculos");
    return { ok: true, message: "Vehículo adscrito. La adscripción anterior queda en el historial." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function endVehicleAttachment(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const id = z.string().uuid().parse(str(fd, "id"));
    const endedOn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida").parse(str(fd, "endedOn"));
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(schema.licenseVehicles).where(eq(schema.licenseVehicles.id, id));
      if (!row || row.endedOn) throw new UserError("La adscripción no está vigente.");
      if (endedOn < row.startedOn) throw new UserError("La fecha de fin es anterior al inicio.");
      await tx.update(schema.licenseVehicles).set({ endedOn }).where(eq(schema.licenseVehicles.id, id));
      await audit(tx, { entity: "license_vehicle", entityId: id, action: "close", userId: user.id, before: { endedOn: null }, after: { endedOn } });
    });
    revalidatePath("/licencias");
    revalidatePath("/vehiculos");
    return { ok: true, message: "Adscripción finalizada." };
  } catch (e) {
    return toActionError(e);
  }
}

/* ─────────────────────────── Conductores ─────────────────────────── */

const driverSchema = z.object({
  code: z.string({ error: "Obligatorio" }).min(1, "Obligatorio").max(30),
  fullName: z.string({ error: "Obligatorio" }).min(2, "Obligatorio").max(120),
  phone: z.string().max(30).regex(/^[+\d\s()-]*$/, "Teléfono no válido").nullable(),
  status,
  startedOn: optDate,
  endedOn: optDate,
  notes: z.string().max(2000).nullable(),
});

export async function saveDriver(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const id = str(fd, "id");
    const data = driverSchema.parse({
      code: str(fd, "code")?.toUpperCase() ?? null,
      fullName: str(fd, "fullName"),
      phone: str(fd, "phone"),
      status: str(fd, "status") ?? "active",
      startedOn: str(fd, "startedOn"),
      endedOn: str(fd, "endedOn"),
      notes: str(fd, "notes"),
    });
    if (data.startedOn && data.endedOn && data.endedOn < data.startedOn) {
      return { ok: false, message: "La fecha de fin es anterior a la de inicio.", fieldErrors: { endedOn: "Anterior al inicio" } };
    }
    const db = await getDb();
    const savedId = await db.transaction(async (tx) => {
      if (id) {
        const [prev] = await tx.select().from(schema.drivers).where(eq(schema.drivers.id, id));
        if (!prev) throw new UserError("El conductor no existe.");
        const d = diff(prev, data);
        if (!d.changed) return id;
        await tx.update(schema.drivers).set({ ...data, updatedAt: new Date() }).where(eq(schema.drivers.id, id));
        await audit(tx, { entity: "driver", entityId: id, action: "update", userId: user.id, before: d.before, after: d.after });
        return id;
      }
      const [row] = await tx.insert(schema.drivers).values(data).returning();
      await audit(tx, { entity: "driver", entityId: row.id, action: "create", userId: user.id, after: row, summary: `Alta de conductor ${row.code}` });
      return row.id;
    });
    revalidatePath("/conductores");
    return { ok: true, message: "Conductor guardado.", id: savedId };
  } catch (e) {
    return toActionError(e);
  }
}

export async function assignDriver(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const p = z
      .object({
        driverId: z.string().uuid("Elige un conductor"),
        licenseId: z.string().uuid("Elige una licencia"),
        startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
        role: z.string().max(80).nullable(),
        closeOthers: z.boolean(),
      })
      .parse({
        driverId: str(fd, "driverId"),
        licenseId: str(fd, "licenseId"),
        startedOn: str(fd, "startedOn"),
        role: str(fd, "role"),
        closeOthers: fd.get("closeOthers") === "on",
      });
    const db = await getDb();
    await db.transaction(async (tx) => {
      if (p.closeOthers) {
        // El usuario decide expresamente sustituir a los conductores vigentes de la licencia.
        const open = await tx.select().from(schema.driverAssignments).where(and(eq(schema.driverAssignments.licenseId, p.licenseId), isNull(schema.driverAssignments.endedOn)));
        for (const o of open) {
          const endedOn = prevDay(p.startedOn) < o.startedOn ? o.startedOn : prevDay(p.startedOn);
          await tx.update(schema.driverAssignments).set({ endedOn }).where(eq(schema.driverAssignments.id, o.id));
          await audit(tx, { entity: "driver_assignment", entityId: o.id, action: "close", userId: user.id, before: { endedOn: null }, after: { endedOn } });
        }
      }
      const [row] = await tx.insert(schema.driverAssignments).values({ driverId: p.driverId, licenseId: p.licenseId, startedOn: p.startedOn, role: p.role }).returning();
      await audit(tx, { entity: "driver_assignment", entityId: row.id, action: "create", userId: user.id, after: row, summary: "Conductor asignado a licencia" });
    });
    revalidatePath("/licencias");
    revalidatePath("/conductores");
    return { ok: true, message: "Asignación registrada." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function endAssignment(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const id = z.string().uuid().parse(str(fd, "id"));
    const endedOn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida").parse(str(fd, "endedOn"));
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(schema.driverAssignments).where(eq(schema.driverAssignments.id, id));
      if (!row || row.endedOn) throw new UserError("La asignación no está vigente.");
      if (endedOn < row.startedOn) throw new UserError("La fecha de fin es anterior al inicio.");
      await tx.update(schema.driverAssignments).set({ endedOn }).where(eq(schema.driverAssignments.id, id));
      await audit(tx, { entity: "driver_assignment", entityId: id, action: "close", userId: user.id, before: { endedOn: null }, after: { endedOn } });
    });
    revalidatePath("/licencias");
    revalidatePath("/conductores");
    return { ok: true, message: "Asignación finalizada." };
  } catch (e) {
    return toActionError(e);
  }
}
