"use client";
import { useRouter } from "next/navigation";
import { Ban, Lock, LockOpen, Pencil, Plus } from "lucide-react";
import { ActionForm, FormMessage, Modal, SubmitButton } from "./client";
import { Button, Field, Input, Select, Textarea } from "./ui";
import { saveCategory, saveMovement, togglePeriodLock, voidMovement } from "@/lib/actions/finance";
import { centsToInput, todayIso } from "@/lib/format";

type Opt = { id: string; label: string };
type Cat = { id: string; label: string; kind: "income" | "expense" | "neutral"; active: boolean };
const KIND_LABEL = { income: "ingreso", expense: "gasto", neutral: "neutro" } as const;

export type MovementInput = {
  id: string;
  occurredOn: string;
  categoryId: string;
  amountCents: number;
  description: string | null;
  licenseId: string | null;
  vehicleId: string | null;
  driverId: string | null;
};

export function MovementDialog({ movement, lookups }: { movement?: MovementInput; lookups: { licenses: Opt[]; vehicles: Opt[]; drivers: Opt[]; categories: Cat[] } }) {
  const router = useRouter();
  const cats = lookups.categories.filter((c) => c.active || c.id === movement?.categoryId);
  return (
    <Modal
      wide
      title={movement ? "Editar movimiento" : "Nuevo movimiento manual"}
      description="Para apuntes que no proceden de una factura (recaudación, liquidaciones, cuotas…)."
      trigger={(open) =>
        movement ? (
          <button type="button" onClick={open} className="grid size-8 place-items-center rounded-full text-text-3 hover:bg-fill hover:text-text" aria-label="Editar movimiento"><Pencil className="size-3.5" /></button>
        ) : (
          <Button onClick={open}><Plus className="size-4" />Nuevo movimiento</Button>
        )
      }
    >
      {(close) =>
        cats.length === 0 ? (
          <p className="text-[14px] text-text-2">Primero crea al menos una categoría en <a href="/ajustes/categorias" className="text-accent underline">Ajustes › Categorías</a>.</p>
        ) : (
          <ActionForm action={saveMovement} className="space-y-4" onSuccess={() => { close(); router.refresh(); }}>
            {(s) => (
              <>
                {movement && <input type="hidden" name="id" value={movement.id} />}
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Fecha" required error={s?.fieldErrors?.occurredOn}>
                    <Input type="date" name="occurredOn" defaultValue={movement?.occurredOn ?? todayIso()} />
                  </Field>
                  <Field label="Categoría" required error={s?.fieldErrors?.categoryId} className="sm:col-span-2">
                    <Select name="categoryId" defaultValue={movement?.categoryId ?? ""}>
                      <option value="">Elegir…</option>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.label} · {KIND_LABEL[c.kind]}</option>)}
                    </Select>
                  </Field>
                  <Field label="Importe (€)" required error={s?.fieldErrors?.amountCents} hint="Negativo para abonos o devoluciones">
                    <Input name="amount" inputMode="decimal" defaultValue={movement ? centsToInput(movement.amountCents) : ""} className="text-right tabular" />
                  </Field>
                  <Field label="Concepto" className="sm:col-span-2">
                    <Input name="description" defaultValue={movement?.description ?? ""} maxLength={500} />
                  </Field>
                  <Field label="Licencia">
                    <Select name="licenseId" defaultValue={movement?.licenseId ?? ""}>
                      <option value="">—</option>
                      {lookups.licenses.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Vehículo">
                    <Select name="vehicleId" defaultValue={movement?.vehicleId ?? ""}>
                      <option value="">—</option>
                      {lookups.vehicles.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Conductor">
                    <Select name="driverId" defaultValue={movement?.driverId ?? ""}>
                      <option value="">—</option>
                      {lookups.drivers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                  </Field>
                </div>
                <FormMessage state={s} />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={close}>Cancelar</Button>
                  <SubmitButton>Guardar</SubmitButton>
                </div>
              </>
            )}
          </ActionForm>
        )
      }
    </Modal>
  );
}

export function VoidMovementDialog({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Modal
      title="Anular movimiento"
      description="No se borra: queda marcado como anulado, con el motivo, y deja de contar en los totales."
      trigger={(open) => <button type="button" onClick={open} className="grid size-8 place-items-center rounded-full text-text-3 hover:bg-fill hover:text-negative" aria-label="Anular movimiento"><Ban className="size-3.5" /></button>}
    >
      {(close) => (
        <ActionForm action={voidMovement} className="space-y-4" onSuccess={() => { close(); router.refresh(); }}>
          {(s) => (
            <>
              <input type="hidden" name="id" value={id} />
              <Field label="Motivo" required><Input name="reason" autoFocus /></Field>
              <FormMessage state={s} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={close}>Cancelar</Button>
                <SubmitButton variant="danger">Anular</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}

export function PeriodLockButton({ year, month, locked }: { year: number; month: number; locked: boolean }) {
  const router = useRouter();
  return (
    <Modal
      title={locked ? "Reabrir el mes" : "Cerrar el mes"}
      description={locked ? "Se podrán volver a crear, modificar o anular movimientos de este mes." : "Impide crear, modificar o anular movimientos y confirmar facturas con fecha de este mes. Útil tras presentar impuestos."}
      trigger={(open) => (
        <Button variant="secondary" size="sm" onClick={open}>
          {locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
          {locked ? "Reabrir mes" : "Cerrar mes"}
        </Button>
      )}
    >
      {(close) => (
        <ActionForm action={togglePeriodLock} className="space-y-4" onSuccess={() => { close(); router.refresh(); }}>
          {(s) => (
            <>
              <input type="hidden" name="year" value={year} />
              <input type="hidden" name="month" value={month} />
              <FormMessage state={s} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={close}>Cancelar</Button>
                <SubmitButton>{locked ? "Reabrir" : "Cerrar"}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}

export type CategoryInput = { id: string; name: string; kind: "income" | "expense" | "neutral"; description: string | null; keywords: string[]; active: boolean };

export function CategoryDialog({ category }: { category?: CategoryInput }) {
  const router = useRouter();
  return (
    <Modal
      title={category ? "Editar categoría" : "Nueva categoría"}
      description="La naturaleza decide si suma como ingreso, como gasto, o no computa (neutro)."
      trigger={(open) =>
        category ? (
          <Button variant="secondary" size="sm" onClick={open}><Pencil className="size-3.5" />Editar</Button>
        ) : (
          <Button onClick={open}><Plus className="size-4" />Nueva categoría</Button>
        )
      }
    >
      {(close) => (
        <ActionForm action={saveCategory} className="space-y-4" onSuccess={() => { close(); router.refresh(); }}>
          {(s) => (
            <>
              {category && <input type="hidden" name="id" value={category.id} />}
              <Field label="Nombre" required error={s?.fieldErrors?.name}>
                <Input name="name" defaultValue={category?.name} autoFocus placeholder="p. ej. Combustible" />
              </Field>
              <Field label="Naturaleza" required error={s?.fieldErrors?.kind}>
                <Select name="kind" defaultValue={category?.kind ?? ""}>
                  <option value="">Elegir…</option>
                  <option value="expense">Gasto</option>
                  <option value="income">Ingreso</option>
                  <option value="neutral">Neutro (no computa en el resultado)</option>
                </Select>
              </Field>
              <Field label="Palabras clave" hint="Separadas por comas. Si aparecen en una línea de factura, se sugiere esta categoría.">
                <Input name="keywords" defaultValue={category?.keywords.join(", ")} placeholder="gasóleo, repsol, cepsa" />
              </Field>
              <Field label="Descripción">
                <Textarea name="description" rows={2} defaultValue={category?.description ?? ""} />
              </Field>
              {category && (
                <Field label="Estado">
                  <Select name="active" defaultValue={category.active ? "on" : "off"}>
                    <option value="on">Activa</option>
                    <option value="off">Inactiva (no se ofrece en nuevas facturas)</option>
                  </Select>
                </Field>
              )}
              <FormMessage state={s} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={close}>Cancelar</Button>
                <SubmitButton>Guardar</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}
