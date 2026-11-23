import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./form";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  if (n === 0) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  return <LoginForm />;
}
