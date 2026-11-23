import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { Card, CardHeader, KeyValue, PageHeader } from "@/components/ui";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <Link href="/ajustes" className="mb-3 inline-flex items-center gap-1 text-[14px] text-accent"><ChevronLeft className="size-4" />Ajustes</Link>
      <PageHeader title="Mi cuenta" />
      <div className="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-5">
          <KeyValue items={[{ label: "Nombre", value: user.name }, { label: "Correo", value: user.email }, { label: "Permiso", value: { admin: "Administrador", editor: "Gestión", viewer: "Consulta" }[user.role] }]} />
        </Card>
        <Card>
          <CardHeader title="Cambiar contraseña" />
          <div className="px-5 pb-5"><PasswordForm /></div>
        </Card>
      </div>
    </>
  );
}
