import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SetupForm } from "./form";

export const metadata = { title: "Configuración inicial" };

export default async function SetupPage() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  if (n > 0) redirect("/login");
  return <SetupForm />;
}
