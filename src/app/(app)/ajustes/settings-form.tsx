"use client";
import { useRouter } from "next/navigation";
import type { Settings } from "@/lib/settings";
import { saveBusinessSettings } from "@/lib/actions/settings";
import { Card, CardHeader, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { ActionForm, FormMessage, SubmitButton } from "@/components/client";

export function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  return (
    <ActionForm action={saveBusinessSettings} onSuccess={() => router.refresh()} className="space-y-4">
      {(s) => (
        <>
          <Card>
            <CardHeader title="Titular" subtitle="Sirve para distinguir facturas recibidas de emitidas." />
            <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
              <Field label="Nombre o razón social"><Input name="ownerName" defaultValue={settings.owner.name ?? ""} /></Field>
              <Field label="NIF" error={s?.fieldErrors?.ownerTaxId}><Input name="ownerTaxId" defaultValue={settings.owner.taxId ?? ""} autoCapitalize="characters" /></Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Reglas contables" subtitle="La aplicación no da por supuesta ninguna forma de cálculo: confirma la tuya." />
            <div className="space-y-4 px-5 pb-5">
              {!settings.accounting.confirmedByUser && (
                <Notice tone="warning">Esta regla aún no está confirmada. Revísala y guarda para confirmarla.</Notice>
              )}
              <Field label="Importe de cada movimiento generado desde una factura" hint="Si eres sujeto pasivo de IVA y lo recuperas, normalmente se usa la base (sin IVA). Si no lo recuperas, el total.">
                <Select name="movementAmountBasis" defaultValue={settings.accounting.movementAmountBasis}>
                  <option value="net">Base imponible de la línea (sin IVA)</option>
                  <option value="gross">Importe de la línea con IVA</option>
                </Select>
              </Field>
              <Field label="Cómo calculas ingresos, gastos y liquidaciones" hint="Explícalo con tus palabras (porcentajes con conductores, recaudación, cuotas…). Se usará para configurar las reglas exactas; ahora no se aplica automáticamente.">
                <Textarea name="businessNotes" rows={5} defaultValue={settings.businessRules.notes ?? ""} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Lectura de documentos" />
            <div className="grid gap-4 px-5 pb-5 sm:grid-cols-[1fr_200px]">
              <Field label="Instrucciones adicionales para la lectura" hint="Particularidades de tus proveedores. Las tiene en cuenta el intérprete visual local (Qwen2.5-VL) cuando está activado; las reglas del OCR no leen este texto.">
                <Textarea name="extraInstructions" rows={3} defaultValue={settings.extraction.extraInstructions ?? ""} />
              </Field>
              <Field label="Umbral de duda" hint="Por debajo, el campo se resalta para revisarlo.">
                <Select name="lowConfidenceThreshold" defaultValue={String(settings.extraction.lowConfidenceThreshold)}>
                  {[0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((v) => <option key={v} value={v}>{Math.round(v * 100)} %</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          <div className="flex items-center justify-end gap-3">
            <FormMessage state={s} />
            <SubmitButton>Guardar ajustes</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
