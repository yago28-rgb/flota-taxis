"use client";
import { ActionForm, FormMessage, SubmitButton } from "@/components/client";
import { Card, Field, Input } from "@/components/ui";
import { login } from "@/lib/actions/auth";

export function LoginForm() {
  return (
    <Card className="p-6">
      <ActionForm action={login} className="space-y-4">
        {(s) => (
          <>
            <Field label="Correo electrónico" htmlFor="email">
              <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
            </Field>
            <Field label="Contraseña" htmlFor="password">
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </Field>
            <FormMessage state={s} />
            <SubmitButton className="w-full" pendingText="Entrando…">Iniciar sesión</SubmitButton>
          </>
        )}
      </ActionForm>
    </Card>
  );
}
