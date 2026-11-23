import { inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { MobileBar, MobileHeader, Sidebar } from "@/components/shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.invoices)
    .where(inArray(schema.invoices.status, ["needs_review", "failed", "uploaded"]));

  return (
    <div className="min-h-dvh">
      <Sidebar user={user} pending={n} />
      <MobileHeader />
      <main className="lg:pl-[248px]">
        <div className="mx-auto w-full max-w-[1280px] px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">{children}</div>
      </main>
      <MobileBar pending={n} />
    </div>
  );
}
