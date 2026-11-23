"use client";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { ActionForm, FormMessage, Modal, SubmitButton } from "./client";
import { Button, Field, Input, Select, Textarea } from "./ui";
import { assignDriver, attachVehicle, endAssignment, endVehicleAttachment, saveDriver, saveLicense, saveVehicle } from "@/lib/actions/fleet";
import { todayIso } from "@/lib/format";

type Opt = { id: string; label: string; status?: string };

const STATUS_OPTIONS = [
  { v: "active", l: "Activo" },
  { v: "inactive", l: "Inactivo" },
  { v: "suspended", l: "Suspendido" },
  { v: "retired", l: "Baja" },
];

function StatusSelect({ value }: { value?: string }) {
  return (
    <Select name="status" defaultValue={value ?? "active"}>
      {STATUS_OPTIONS.map((s) => (
        <option key={s.v} value={s.v}>{s.l}</option>
      ))}
    </Select>
  );
}

/* ─────────────────────────── Licencia ─────────────────────────── */

type License = { id: string; number: string; status: string; acquiredOn: string | null; notes: string | null };

export function LicenseDialog({ license }: { license?: License }) {
  const router = useRouter();
  return (
    <Modal
      title={license ? "Editar licencia" : "Nueva licencia"}
      trigger={(open) =>
        license ? (
          <Button variant="secondary" size="sm" onClick={open}><Pencil className="size-3.5" />Editar</Button>
        ) : (
          <Button onClick={open}><Plus className="size-4" />Nueva licencia</Button>
        )
      }
    >
      {(close) => (
        <ActionForm
          action={saveLicense}
          className="space-y-4"
          onSuccess={(s) => {
            close();
            if (!license && s.id) router.push(`/licencias/${s.id}`);
            else router.refresh();
          }}
        >
          {(s) => (
            <>
              {license && <input type="hidden" name="id" value={license.id} />}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Número o identificador" required error={s?.fieldErrors?.number}>
                  <Input name="number" defaultValue={license?.number} placeholder="Tal como figura en la licencia" autoFocus invalid={!!s?.fieldErrors?.number} />
                </Field>
                <Field label="Estado"><StatusSelect value={license?.status} /></Field>
                <Field label="Fecha de incorporación" error={s?.fieldErrors?.acquiredOn}>
                  <Input type="date" name="acquiredOn" defaultValue={license?.acquiredOn ?? ""} />
                </Field>
              </div>
              <Field label="Notas"><Textarea name="notes" defaultValue={license?.notes ?? ""} /></Field>
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

/* ─────────────────────────── Vehículo ─────────────────────────── */

type Vehicle = { id: string; plate: string; make: string | null; model: string | null; status: string; notes: string | null };

export function VehicleDialog({ vehicle, licenses, defaultLicenseId }: { vehicle?: Vehicle; licenses?: Opt[]; defaultLicenseId?: string }) {
  const router = useRouter();
  return (
    <Modal
      title={vehicle ? "Editar vehículo" : "Nuevo vehículo"}
      trigger={(open) =>
        vehicle ? (
          <Button variant="secondary" size="sm" onClick={open}><Pencil className="size-3.5" />Editar</Button>
        ) : (
          <Button onClick={open} variant={defaultLicenseId ? "secondary" : "primary"} size={defaultLicenseId ? "sm" : "md"}><Plus className="size-4" />Nuevo vehículo</Button>
        )
      }
    >
      {(close) => (
        <ActionForm action={saveVehicle} className="space-y-4" onSuccess={() => { close(); router.refresh(); }}>
          {(s) => (
            <>
              {vehicle && <input type="hidden" name="id" value={vehicle.id} />}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Matrícula" required error={s?.fieldErrors?.plate} hint="Se guarda sin espacios ni guiones.">
                  <Input name="plate" defaultValue={vehicle?.plate} autoFocus autoCapitalize="characters" invalid={!!s?.fieldErrors?.plate} />
                </Field>
                <Field label="Estado"><StatusSelect value={vehicle?.status} /></Field>
                <Field label="Marca"><Input name="make" defaultValue={vehicle?.make ?? ""} /></Field>
                <Field label="Modelo"><Input name="model" defaultValue={vehicle?.model ?? ""} /></Field>
              </div>
              {!vehicle && licenses && (
                <div className="grid gap-4 rounded-2xl bg-surface-2 p-4 sm:grid-cols-2">
                  <Field label="Adscribir a licencia" hint="Opcional. Cierra la adscripción anterior de esa licencia.">
                    <Select name="licenseId" defaultValue={defaultLicenseId ?? ""}>
                      <option value="">Sin licencia</option>
                      {licenses.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Desde"><Input type="date" name="startedOn" defaultValue={todayIso()} /></Field>
                </div>
              )}
              <Field label="Notas"><Textarea name="notes" defaultValue={vehicle?.notes ?? ""} /></Field>
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

export function AttachVehicleDialog({ licenseId, vehicles }: { licenseId: string; vehicles: Opt[] }) {
  const router = useRouter();
  return (
    <Modal
      title="Cambiar vehículo de la licencia"
      description="La adscripción actual se cerrará el día anterior y quedará en el historial."
      trigger={(open) => <Button variant="secondary" size="sm" onClick={open}>Cambiar vehículo</Button>}
    >
      {(close) => (
        <ActionForm action={attachVehicle} className="space-y-4" onSuccess={() => { close(); router.refresh(); }}>
          {(s) => (
            <>
              <input type="hidden" name="licenseId" value={licenseId} />
              <Field label="Vehículo" required error={s?.fieldErrors?.vehicleId}>
                <Select name="vehicleId" defaultValue="">
                  <option value="" disabled>Elige un vehículo</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </Select>
              </Field>
              <Field label="Desde" required error={s?.fieldErrors?.startedOn}><Input type="date" name="startedOn" defaultValue={todayIso()} /></Field>
              <FormMessage state={s} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={close}>Cancelar</Button>
                <SubmitButton>Adscribir</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}

/* ─────────────────────────── Conductor ─────────────────────────── */

type Driver = { id: string; code: string; fullName: string; phone: string | null; status: string; startedOn: string | null; endedOn: string | null; notes: string | null };

export function DriverDialog({ driver }: { driver?: Driver }) {
  const router = useRouter();
  return (
    <Modal
      title={driver ? "Editar conductor" : "Nuevo conductor"}
      description="Registra sólo los datos necesarios para la gestión."
      trigger={(open) =>
        driver ? (
          <Button variant="secondary" size="sm" onClick={open}><Pencil className="size-3.5" />Editar</Button>
        ) : (
          <Button onClick={open}><Plus className="size-4" />Nuevo conductor</Button>
        )
      }
    >
      {(close) => (
        <ActionForm
          action={saveDriver}
          className="space-y-4"
          onSuccess={(s) => {
            close();
            if (!driver && s.id) router.push(`/conductores/${s.id}`);
            else router.refresh();
          }}
        >
          {(s) => (
            <>
              {driver && <input type="hidden" name="id" value={driver.id} />}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre completo" required error={s?.fieldErrors?.fullName} className="sm:col-span-2">
                  <Input name="fullName" defaultValue={driver?.fullName} autoFocus autoComplete="off" />
                </Field>
                <Field label="Identificador interno" required error={s?.fieldErrors?.code} hint="Código propio, p. ej. C-01.">
                  <Input name="code" defaultValue={driver?.code} autoCapitalize="characters" />
                </Field>
                <Field label="Teléfono" error={s?.fieldErrors?.phone} hint="Opcional.">
                  <Input name="phone" type="tel" defaultValue={driver?.phone ?? ""} autoComplete="off" />
                </Field>
                <Field label="Estado"><StatusSelect value={driver?.status} /></Field>
                <div />
                <Field label="Fecha de inicio" error={s?.fieldErrors?.startedOn}><Input type="date" name="startedOn" defaultValue={driver?.startedOn ?? ""} /></Field>
                <Field label="Fecha de finalización" error={s?.fieldErrors?.endedOn}><Input type="date" name="endedOn" defaultValue={driver?.endedOn ?? ""} /></Field>
              </div>
              <Field label="Notas"><Textarea name="notes" defaultValue={driver?.notes ?? ""} /></Field>
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

export function AssignDriverDialog({ licenseId, driverId, licenses, drivers, hasCurrent }: { licenseId?: string; driverId?: string; licenses: Opt[]; drivers: Opt[]; hasCurrent?: boolean }) {
  const router = useRouter();
  return (
    <Modal
      title="Asignar conductor"
      description="Una licencia puede tener varios conductores a la vez. Las asignaciones anteriores se conservan."
      trigger={(open) => <Button variant="secondary" size="sm" onClick={open}><Plus className="size-3.5" />Asignar</Button>}
    >
      {(close) => (
        <ActionForm action={assignDriver} className="space-y-4" onSuccess={() => { close(); router.refresh(); }}>
          {(s) => (
            <>
              {licenseId ? (
                <input type="hidden" name="licenseId" value={licenseId} />
              ) : (
                <Field label="Licencia" required error={s?.fieldErrors?.licenseId}>
                  <Select name="licenseId" defaultValue="">
                    <option value="" disabled>Elige una licencia</option>
                    {licenses.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </Select>
                </Field>
              )}
              {driverId ? (
                <input type="hidden" name="driverId" value={driverId} />
              ) : (
                <Field label="Conductor" required error={s?.fieldErrors?.driverId}>
                  <Select name="driverId" defaultValue="">
                    <option value="" disabled>Elige un conductor</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </Select>
                </Field>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Desde" required error={s?.fieldErrors?.startedOn}><Input type="date" name="startedOn" defaultValue={todayIso()} /></Field>
                <Field label="Observación" hint="Opcional, p. ej. turno."><Input name="role" /></Field>
              </div>
              {(hasCurrent || !licenseId) && (
                <label className="flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-[13px]">
                  <input type="checkbox" name="closeOthers" className="mt-0.5 size-4 accent-[var(--accent)]" />
                  <span>
                    <span className="font-medium">Sustituye a los conductores actuales de la licencia</span>
                    <span className="block text-text-2">Sus asignaciones se cerrarán el día anterior. Déjalo sin marcar si comparten la licencia.</span>
                  </span>
                </label>
              )}
              <FormMessage state={s} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={close}>Cancelar</Button>
                <SubmitButton>Asignar</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}

/** Finalizar una asignación de conductor o adscripción de vehículo. */
export function EndDialog({ id, kind, label }: { id: string; kind: "assignment" | "vehicle"; label: string }) {
  const router = useRouter();
  return (
    <Modal title="Finalizar" description={label} trigger={(open) => <Button variant="plain" size="sm" onClick={open}>Finalizar</Button>}>
      {(close) => (
        <ActionForm action={kind === "assignment" ? endAssignment : endVehicleAttachment} className="space-y-4" onSuccess={() => { close(); router.refresh(); }}>
          {(s) => (
            <>
              <input type="hidden" name="id" value={id} />
              <Field label="Fecha de finalización" required><Input type="date" name="endedOn" defaultValue={todayIso()} /></Field>
              <FormMessage state={s} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={close}>Cancelar</Button>
                <SubmitButton>Finalizar</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}
