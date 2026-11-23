"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/lib/auth/session";
import { rejectInvoice, reopenInvoice, restoreInvoice, saveReview, type ReviewPayload } from "@/lib/invoices/service";
import { toActionError, type ActionState } from "./util";
import type { ValidationIssue } from "@/db/schema";

const cents = z.number().int().nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal("").transform(() => null));
const id = z.string().uuid().nullable();

const lineSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  description: z.string().max(1000).nullable(),
  quantity: z.number().nullable(),
  unitPriceCents: cents,
  taxRate: z.number().min(-100).max(100).nullable(),
  taxCents: cents,
  amountCents: cents,
  serviceDate: date,
  categoryId: id,
  licenseId: id,
  vehicleId: id,
  driverId: id,
  detectedPlate: z.string().nullable().optional(),
  detectedLicense: z.string().nullable().optional(),
  detectedDriver: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

const payloadSchema = z.object({
  direction: z.enum(["received", "issued", "unknown"]),
  documentType: z.string().max(80).nullable(),
  counterpartyName: z.string().max(200).nullable(),
  counterpartyTaxId: z.string().max(30).nullable(),
  invoiceNumber: z.string().max(80).nullable(),
  issueDate: date,
  dueDate: date,
  periodStart: date,
  periodEnd: date,
  currency: z.string().length(3),
  subtotalCents: cents,
  taxCents: cents,
  withholdingCents: cents,
  totalCents: cents,
  licenseId: id,
  vehicleId: id,
  driverId: id,
  notes: z.string().max(2000).nullable(),
  lines: z.array(lineSchema).max(500),
});

export type ReviewResult = { ok: boolean; message?: string; issues?: ValidationIssue[]; blocking?: boolean; needsAcknowledgement?: boolean };

export async function submitReview(invoiceId: string, payload: unknown, opts: { confirm: boolean; acknowledge: boolean }): Promise<ReviewResult> {
  try {
    const user = await assertUser("editor");
    const p = payloadSchema.parse(payload) as ReviewPayload;
    const report = await saveReview(z.string().uuid().parse(invoiceId), p, opts, user);
    revalidatePath(`/facturas/${invoiceId}`);
    revalidatePath("/facturas");
    revalidatePath("/");
    return { ok: true, message: opts.confirm ? "Factura confirmada e importada." : "Revisión guardada.", ...report };
  } catch (e) {
    const r = toActionError(e);
    return { ok: false, message: r?.message };
  }
}

const reasonSchema = z.string({ error: "Indica el motivo" }).min(3, "Indica el motivo").max(300);

export async function reopenAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const invoiceId = z.string().uuid().parse(fd.get("id"));
    await reopenInvoice(invoiceId, reasonSchema.parse(fd.get("reason")), user);
    revalidatePath(`/facturas/${invoiceId}`);
    revalidatePath("/facturas");
    return { ok: true, message: "Factura reabierta. Sus movimientos se han anulado y constan en el historial." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function rejectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const invoiceId = z.string().uuid().parse(fd.get("id"));
    await rejectInvoice(invoiceId, reasonSchema.parse(fd.get("reason")), user);
    revalidatePath(`/facturas/${invoiceId}`);
    revalidatePath("/facturas");
    return { ok: true, message: "Factura descartada. El documento se conserva." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function restoreAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("editor");
    const invoiceId = z.string().uuid().parse(fd.get("id"));
    await restoreInvoice(invoiceId, user);
    revalidatePath(`/facturas/${invoiceId}`);
    revalidatePath("/facturas");
    return { ok: true, message: "Factura recuperada." };
  } catch (e) {
    return toActionError(e);
  }
}
