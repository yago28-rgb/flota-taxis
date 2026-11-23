"use client";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { saveUser } from "@/lib/actions/auth";
import { Button, Field, Input, Select } from "@/components/ui";
import { ActionForm, FormMessage, Modal, SubmitButton } from "@/components/client";

type U = { id: string; name: string; email: string; role: "admin" | "editor" | "viewer"; active: boolean };

export function UserDialog({ user, self }: { user?: U; self?: boolean }) {
  const router = useRouter();
  return (
    <Modal
      title={user ? "Editar usuario" : "Nuevo usuario"}
      trigger={(open) => user ? <Button variant="secondary" size="sm" onClick={open} aria-label={`Editar ${user.name}`}><Pencil className="size-3.5" /></Button> : <Button onClick={open}><Plus className="size-4" />Nuevo usuario</Button>}
    >
      {(close) => (
        <ActionForm action={saveUser} className="space-y-4" onSuccess={() => { close(); router.refresh(); }}>
          {(s) => (
            <>
              {user && <input type="hidden" name="id" value={user.id} />}
              <Field label="Nombre" required error={s?.fieldErrors?.name}><Input name="name" defaultValue={user?.name} autoFocus /></Field>
              <Field label="Correo" required error={s?.fieldErrors?.email}><Input type="email" name="email" defaultValue={user?.email} autoComplete="off" /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Permiso">
                  <Select name="role" defaultValue={user?.role ?? "viewer"} disabled={self}>
                    <option value="admin">Administrador</option>
                    <option value="editor">Gestión</option>
                    <option value="viewer">Consulta</option>
                  </Select>
                  {self && <input type="hidden" name="role" value="admin" />}
                </Field>
                <Field label="Estado">
                  <Select name="active" defaultValue={user?.active === false ? "off" : "on"} disabled={self}>
                    <option value="on">Activo</option>
                    <option value="off">Desactivado</option>
                  </Select>
                </Field>
              </div>
              <Field label={user ? "Nueva contraseña" : "Contraseña inicial"} required={!user} hint={user ? "Déjala vacía para no cambiarla." : "Mínimo 12 caracteres con letras y números. Comunícasela por un canal seguro."} error={s?.fieldErrors?.password}>
                <Input type="password" name="password" autoComplete="new-password" />
              </Field>
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
