import Link from "next/link";
import { asc } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { UserDialog } from "./user-dialog";

export const metadata = { title: "Usuarios" };

const ROLE = { admin: "Administrador", editor: "Gestión", viewer: "Consulta" } as const;

export default async function UsersPage() {
  const me = await requireUser("admin");
  const db = await getDb();
  const users = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, active: schema.users.active, lastLoginAt: schema.users.lastLoginAt, lockedUntil: schema.users.lockedUntil })
    .from(schema.users)
    .orderBy(asc(schema.users.name));
  return (
    <>
      <Link href="/ajustes" className="mb-3 inline-flex items-center gap-1 text-[14px] text-accent"><ChevronLeft className="size-4" />Ajustes</Link>
      <PageHeader title="Usuarios y permisos" subtitle="Administrador: todo. Gestión: subir, revisar y registrar. Consulta: sólo ver y exportar." actions={<UserDialog />} />
      <Card>
        <Table>
          <thead><tr><Th>Nombre</Th><Th>Permiso</Th><Th className="hidden md:table-cell">Último acceso</Th><Th className="w-0" /></tr></thead>
          <tbody>
            {users.map((u) => (
              <Tr key={u.id} className={u.active ? undefined : "opacity-55"}>
                <Td>
                  <div className="font-medium">{u.name}{u.id === me.id && <span className="ml-2 text-[12px] font-normal text-text-3">tú</span>}</div>
                  <div className="text-[12px] text-text-2">{u.email}</div>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={u.role === "admin" ? "accent" : "neutral"}>{ROLE[u.role]}</Badge>
                    {!u.active && <Badge>Desactivado</Badge>}
                    {u.lockedUntil && u.lockedUntil > new Date() && <Badge tone="warning">Bloqueado por intentos</Badge>}
                  </div>
                </Td>
                <Td className="hidden text-[13px] text-text-2 md:table-cell">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Nunca"}</Td>
                <Td><UserDialog user={{ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active }} self={u.id === me.id} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
