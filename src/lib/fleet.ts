import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

const L = schema.licenses, V = schema.vehicles, D = schema.drivers, LV = schema.licenseVehicles, DA = schema.driverAssignments;

export async function licenseList(q?: string | null, status?: string | null) {
  const db = await getDb();
  const where = and(
    q ? sql`${L.number} ILIKE ${"%" + q.replace(/[%_]/g, "") + "%"}` : undefined,
    status ? eq(L.status, status as "active") : undefined,
  );
  const rows = await db.select().from(L).where(where).orderBy(asc(L.number));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const [veh, drv] = await Promise.all([
    db.select({ licenseId: LV.licenseId, plate: V.plate, make: V.make, model: V.model, vehicleId: V.id }).from(LV).innerJoin(V, eq(V.id, LV.vehicleId)).where(and(isNull(LV.endedOn), inArray(LV.licenseId, ids))),
    db.select({ licenseId: DA.licenseId, name: D.fullName, driverId: D.id }).from(DA).innerJoin(D, eq(D.id, DA.driverId)).where(and(isNull(DA.endedOn), inArray(DA.licenseId, ids))),
  ]);
  return rows.map((l) => ({
    ...l,
    vehicle: veh.find((v) => v.licenseId === l.id) ?? null,
    drivers: drv.filter((d) => d.licenseId === l.id),
  }));
}

export async function licenseDetail(id: string) {
  const db = await getDb();
  const [license] = await db.select().from(L).where(eq(L.id, id));
  if (!license) return null;
  const [vehicles, assignments] = await Promise.all([
    db.select({ a: LV, plate: V.plate, make: V.make, model: V.model }).from(LV).innerJoin(V, eq(V.id, LV.vehicleId)).where(eq(LV.licenseId, id)).orderBy(desc(LV.startedOn)),
    db.select({ a: DA, name: D.fullName, code: D.code }).from(DA).innerJoin(D, eq(D.id, DA.driverId)).where(eq(DA.licenseId, id)).orderBy(desc(DA.startedOn)),
  ]);
  return { license, vehicles, assignments };
}

export async function vehicleList(q?: string | null) {
  const db = await getDb();
  const rows = await db
    .select({ v: V, licenseNumber: L.number, licenseId: L.id })
    .from(V)
    .leftJoin(LV, and(eq(LV.vehicleId, V.id), isNull(LV.endedOn)))
    .leftJoin(L, eq(L.id, LV.licenseId))
    .where(q ? or(sql`${V.plate} ILIKE ${"%" + q.replace(/[%_\s-]/g, "") + "%"}`, sql`${V.make} ILIKE ${"%" + q + "%"}`, sql`${V.model} ILIKE ${"%" + q + "%"}`) : undefined)
    .orderBy(asc(V.plate));
  return rows;
}

export async function vehicleDetail(id: string) {
  const db = await getDb();
  const [vehicle] = await db.select().from(V).where(eq(V.id, id));
  if (!vehicle) return null;
  const history = await db.select({ a: LV, number: L.number }).from(LV).innerJoin(L, eq(L.id, LV.licenseId)).where(eq(LV.vehicleId, id)).orderBy(desc(LV.startedOn));
  return { vehicle, history };
}

export async function driverList(q?: string | null, status?: string | null) {
  const db = await getDb();
  const where = and(
    q ? or(sql`${D.fullName} ILIKE ${"%" + q.replace(/[%_]/g, "") + "%"}`, sql`${D.code} ILIKE ${"%" + q.replace(/[%_]/g, "") + "%"}`) : undefined,
    status ? eq(D.status, status as "active") : undefined,
  );
  const rows = await db.select().from(D).where(where).orderBy(asc(D.fullName));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const open = await db.select({ driverId: DA.driverId, number: L.number, licenseId: L.id }).from(DA).innerJoin(L, eq(L.id, DA.licenseId)).where(and(isNull(DA.endedOn), inArray(DA.driverId, ids)));
  // Vehículo actual = vehículo vigente de sus licencias actuales.
  const licIds = open.map((o) => o.licenseId);
  const veh = licIds.length
    ? await db.select({ licenseId: LV.licenseId, plate: V.plate }).from(LV).innerJoin(V, eq(V.id, LV.vehicleId)).where(and(isNull(LV.endedOn), inArray(LV.licenseId, licIds)))
    : [];
  return rows.map((d) => {
    const lic = open.filter((o) => o.driverId === d.id);
    return { ...d, licenses: lic, plates: veh.filter((v) => lic.some((l) => l.licenseId === v.licenseId)).map((v) => v.plate) };
  });
}

export async function driverDetail(id: string) {
  const db = await getDb();
  const [driver] = await db.select().from(D).where(eq(D.id, id));
  if (!driver) return null;
  const assignments = await db.select({ a: DA, number: L.number }).from(DA).innerJoin(L, eq(L.id, DA.licenseId)).where(eq(DA.driverId, id)).orderBy(desc(DA.startedOn));
  return { driver, assignments };
}

/** Historial de cambios de una o varias entidades. */
export async function entityHistory(pairs: { entity: string; id: string }[], limit = 30) {
  if (!pairs.length) return [];
  const db = await getDb();
  const A = schema.auditEvents;
  return db
    .select({ e: A, user: schema.users.name })
    .from(A)
    .leftJoin(schema.users, eq(schema.users.id, A.userId))
    .where(or(...pairs.map((p) => and(eq(A.entity, p.entity), eq(A.entityId, p.id)))))
    .orderBy(desc(A.createdAt))
    .limit(limit);
}
