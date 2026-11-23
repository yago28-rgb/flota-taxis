// Prueba de integración: envía documentos al motor local en marcha y valida la respuesta con el
// contrato de la aplicación (extractionSchema). Uso: npx tsx scripts/ocr-smoke.ts <ficheros...>
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { extractionSchema } from "../src/lib/extraction/types";

const url = (process.env.OCR_ENGINE_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
const MIME: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

async function main() {
  const health = await fetch(`${url}/health`).then((r) => r.json());
  console.log("health:", health.status, "·", health.engine);
  let failed = 0;
  for (const file of process.argv.slice(2)) {
    const form = new FormData();
    form.append("file", new Blob([readFileSync(file)], { type: MIME[extname(file).toLowerCase()] }), "documento");
    form.append("context", JSON.stringify({ ownerName: "Antonio Pérez García", ownerTaxId: "12345678Z", knownPlates: ["1234KLM", "5678HJK", "9012BCD"], knownLicenses: ["04567", "01234"], knownDrivers: [] }));
    const t = Date.now();
    const res = await fetch(`${url}/extract`, { method: "POST", body: form });
    const body = await res.json();
    const parsed = extractionSchema.safeParse(body.result);
    if (!res.ok || !parsed.success) {
      failed++;
      console.log(`✗ ${file}`, res.status, body.detail ?? parsed.error?.issues.slice(0, 3));
      continue;
    }
    const r = parsed.data;
    console.log(
      `✓ ${file} · ${((Date.now() - t) / 1000).toFixed(1)} s · ${body.engine.models.join(" + ")}\n` +
        `   ${r.documentType.value} ${r.invoiceNumber.value} · ${r.issueDate.value} · ${r.issuer.name.value} (${r.issuer.taxId.value})\n` +
        `   base ${r.subtotal.value} · impuestos ${r.taxTotal.value} · total ${r.total.value} · ${r.lines.length} líneas · matrículas ${r.identifiers.plates.join(", ")}` +
        (r.warnings.length ? `\n   avisos: ${r.warnings.join(" | ")}` : ""),
    );
  }
  process.exit(failed ? 1 : 0);
}
main();
