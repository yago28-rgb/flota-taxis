import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { logout } from "@/lib/actions/auth";
import { Card, PageHeader } from "@/components/ui";
import { ThemeToggle } from "@/components/client";
import { MoreMenu } from "@/components/shell";

export const metadata = { title: "Más" };

export default async function MorePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Más" subtitle={`${user.name} · ${user.email}`} />
      <Card className="overflow-hidden p-0">
        <MoreMenu />
      </Card>
      <Card className="mt-4 flex items-center justify-between p-4">
        <span className="text-[14px] font-medium">Apariencia</span>
        <ThemeToggle />
      </Card>
      <form action={logout} className="mt-4">
        <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-surface py-3.5 text-[15px] font-medium text-negative shadow-card">
          <LogOut className="size-4" />Cerrar sesión
        </button>
      </form>
    </>
  );
}
