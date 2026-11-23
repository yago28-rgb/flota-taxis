"use client";
import { changeOwnPassword } from "@/lib/actions/auth";
import { Field, Input } from "@/components/ui";
import { ActionForm, FormMessage, SubmitButton } from "@/components/client";

export function PasswordForm() {
  return (
    <ActionForm action={changeOwnPassword} resetOnSuccess className="space-y-4">
      {(s) => (
        <>
          <Field label="Contraseña actual" error={s?.fieldErrors?.current}><Input type="password" name="current" autoComplete="current-password" /></Field>
          <Field label="Nueva contraseña" hint="Mínimo 12 caracteres con letras y números." error={s?.fieldErrors?.password}><Input type="password" name="password" autoComplete="new-password" /></Field>
          <Field label="Repite la nueva contraseña" error={s?.fieldErrors?.confirm}><Input type="password" name="confirm" autoComplete="new-password" /></Field>
          <FormMessage state={s} />
          <SubmitButton>Cambiar contraseña</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
