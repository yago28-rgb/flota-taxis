import Link from "next/link";
import { sql } from "drizzle-orm";
import { ChevronRight, KeyRound, ScanText, Tags, Users } from "lucide-react";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { providerStatus } from "@/lib/extraction";
import { getSettings } from "@/lib/settings";
import { Badge, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  const user = await requireUser();
  const db = await getDb();
  const [settings, [{ cats }]] = await Promise.all([getSettings(), db.select({ cats: sql<number>`count(*)::int` }).from(schema.categories)]);
  const provider = await providerStatus();
  const isAdmin = user.role === "admin";

  const links = [
    { href: "/ajustes/categorias", icon: Tags, title: "Categorías", text: cats ? `${cats} categorías` : "Ninguna todavía: necesarias para confirmar facturas" },
    ...(isAdmin ? [{ href: "/ajustes/usuarios", icon: Users, title: "Usuarios y permisos", text: "Quién accede y qué puede hacer" }] : []),
    { href: "/ajustes/cuenta", icon: KeyRound, title: "Mi cuenta", text: "Cambiar contraseña" },
  ];

  return (
    <>
      <PageHeader title="Ajustes" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          {isAdmin ? (
            <SettingsForm settings={settings} />
          ) : (
            <Notice>Sólo un administrador puede cambiar los datos del titular y las reglas contables.</Notice>
          )}
        </div>
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-line">
              {links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-fill-2">
                    <span className="grid size-8 place-items-center rounded-[9px] bg-accent-soft text-accent"><l.icon className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{l.title}</span>
                      <span className="block truncate text-[12.5px] text-text-2">{l.text}</span>
                    </span>
                    <ChevronRight className="size-4 text-text-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title={<span className="inline-flex items-center gap-2"><ScanText className="size-4" />Reconocimiento automático</span>}
              action={provider.ready ? <Badge tone="positive" dot>En marcha</Badge> : <Badge tone="warning" dot>Detenido</Badge>}
            />
            <div className="space-y-3 px-5 pb-5 text-[13.5px] text-text-2">
              <p>Motor: <span className="font-medium text-text">{provider.engine ?? provider.label}</span></p>
              <p>
                Intérprete visual Qwen2.5-VL (opcional):{" "}
                <span className="font-medium text-text">
                  {!provider.qwen ? "—" : !provider.qwen.enabled ? "desactivado" : provider.qwen.available ? `activo (${provider.qwen.model})` : "activado pero no disponible"}
                </span>
                {provider.qwen?.enabled && provider.qwen.reason ? <span className="block text-[12.5px] text-warning">{provider.qwen.reason}</span> : null}
              </p>
              {provider.reason && <p className="text-warning">{provider.reason}</p>}
              {!provider.ready && (
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Abre una terminal en la carpeta del proyecto.</li>
                  <li>Ejecuta <code className="rounded bg-fill-2 px-1">npm run ocr</code> y deja la ventana abierta.</li>
                  <li>Espera a «motor listo» y recarga esta página.</li>
                </ol>
              )}
              <p className="text-[12.5px] text-text-3">
                El reconocimiento se hace en este equipo con PaddleOCR y reglas propias: sin claves de API, sin coste por factura y sin enviar documentos a servicios externos. Funciona sin Internet una vez descargados los modelos.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
