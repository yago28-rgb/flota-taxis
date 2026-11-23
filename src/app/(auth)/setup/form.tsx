"use client";
import { ActionForm, FormMessage, SubmitButton } from "@/components/client";
import { Card, Field, Input } from "@/components/ui";
import { setupFirstAdmin } from "@/lib/actions/auth";

export function SetupForm() {
  return (
    <Card className="p-6">
      <h2 className="text-[17px] font-semibold">Crea la cuenta de administrador</h2>
      <p className="mb-5 mt-1 text-[13px] text-text-2">Es el primer acceso a esta instalación. Esta cuenta podrá crear al resto de usuarios.</p>
      <ActionForm action={setupFirstAdmin} className="space-y-4">
        {(s) => (
          <>
            <Field label="Nombre" htmlFor="name" error={s?.fieldErrors?.name}>
              <Input id="name" name="name" autoComplete="name" required />
            </Field>
            <Field label="Correo electrónico" htmlFor="email" error={s?.fieldErrors?.email}>
              <Input id="email" name="email" type="email" autoComplete="username" required />
            </Field>
            <Field label="Contraseña" htmlFor="password" error={s?.fieldErrors?.password} hint="Mínimo 12 caracteres, con letras y números.">
              <Input id="password" name="password" type="password" autoComplete="new-password" required />
            </Field>
            <Field label="Repite la contraseña" htmlFor="confirm" error={s?.fieldErrors?.confirm}>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
            </Field>
            <FormMessage state={s} />
            <SubmitButton className="w-full" pendingText="Creando…">Crear cuenta y entrar</SubmitButton>
          </>
        )}
      </ActionForm>
    </Card>
  );
}
