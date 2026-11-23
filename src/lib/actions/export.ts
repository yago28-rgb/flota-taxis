"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { assertUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { DATASETS, FIELDS, type Dataset } from "@/lib/export/fields";
import { toActionError, UserError } from "./util";

const templateSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().min(1, "Pon un nombre a la plantilla").max(80),
  dataset: z.enum(Object.keys(DATASETS) as [Dataset, ...Dataset[]]),
  sheetName: z.string().max(31).nullable(),
  includeTotals: z.boolean(),
  columns: z.array(z.object({ header: z.string().min(1).max(80), field: z.string(), width: z.number().min(4).max(100).optional() })).min(1, "Añade al menos una columna").max(80),
});

export async function saveTemplate(input: unknown) {
  try {
    const user = await assertUser("editor");
    const t = templateSchema.parse(input);
    const valid = new Set(FIELDS[t.dataset].map((f) => f.key));
    const bad = t.columns.find((c) => !valid.has(c.field));
    if (bad) throw new UserError(`La columna «${bad.header}» no tiene un campo válido asignado.`);
    const db = await getDb();
    const id = await db.transaction(async (tx) => {
      const values = { name: t.name, dataset: t.dataset, sheetName: t.sheetName, includeTotals: t.includeTotals, columns: t.columns };
      if (t.id) {
        const [prev] = await tx.select().from(schema.exportTemplates).where(eq(schema.exportTemplates.id, t.id));
        if (!prev) throw new UserError("La plantilla no existe.");
        await tx.update(schema.exportTemplates).set({ ...values, updatedAt: new Date() }).where(eq(schema.exportTemplates.id, t.id));
        await audit(tx, { entity: "export_template", entityId: t.id, action: "update", userId: user.id, before: prev, after: values });
        return t.id;
      }
      const [row] = await tx.insert(schema.exportTemplates).values({ ...values, createdBy: user.id }).returning();
      await audit(tx, { entity: "export_template", entityId: row.id, action: "create", userId: user.id, after: values });
      return row.id;
    });
    revalidatePath("/exportar");
    return { ok: true, id, message: "Plantilla guardada." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteTemplate(id: string) {
  try {
    const user = await assertUser("editor");
    const db = await getDb();
    await db.transaction(async (tx) => {
      const [prev] = await tx.select().from(schema.exportTemplates).where(eq(schema.exportTemplates.id, z.string().uuid().parse(id)));
      if (!prev) throw new UserError("La plantilla no existe.");
      await tx.delete(schema.exportTemplates).where(eq(schema.exportTemplates.id, id));
      await audit(tx, { entity: "export_template", entityId: id, action: "delete", userId: user.id, before: prev });
    });
    revalidatePath("/exportar");
    return { ok: true, message: "Plantilla eliminada." };
  } catch (e) {
    return toActionError(e);
  }
}
