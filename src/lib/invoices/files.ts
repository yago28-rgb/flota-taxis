import "server-only";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { detectFileType, MAX_UPLOAD_BYTES, type DetectedType } from "@/lib/storage";

export class UploadError extends Error {}

export type PreparedDocument = {
  data: Buffer;
  mime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  ext: string;
  name: string;
  pageCount: number;
};

function assertSupported(t: DetectedType | null, name: string): asserts t is DetectedType {
  if (!t) throw new UploadError(`«${name}» no es un PDF ni una imagen válida (JPG, PNG o WEBP).`);
  if (t.mime === "image/heic") {
    throw new UploadError(
      `«${name}» está en formato HEIC. En iPhone: Ajustes › Cámara › Formatos › «Más compatible», o súbela desde el navegador, que la convierte a JPG.`,
    );
  }
}

/**
 * Normaliza lo que sube el usuario a un único documento original:
 * - 1 PDF → se conserva tal cual.
 * - 1 imagen → se conserva tal cual.
 * - Varias imágenes (fotos de las páginas de una factura) → se unen en un PDF, en orden.
 */
export async function prepareUpload(files: { name: string; data: Buffer }[]): Promise<PreparedDocument> {
  if (files.length === 0) throw new UploadError("No se ha recibido ningún archivo.");
  const total = files.reduce((s, f) => s + f.data.length, 0);
  if (total > MAX_UPLOAD_BYTES) throw new UploadError("El documento supera el tamaño máximo de 25 MB.");

  const typed = files.map((f) => {
    const t = detectFileType(f.data);
    assertSupported(t, f.name);
    return { ...f, type: t };
  });

  if (typed.length === 1) {
    const [f] = typed;
    if (f.type.mime === "application/pdf") {
      let pageCount = 0;
      try {
        const pdf = await PDFDocument.load(f.data, { ignoreEncryption: false, updateMetadata: false });
        pageCount = pdf.getPageCount();
      } catch {
        throw new UploadError(`«${f.name}» está dañado o protegido con contraseña.`);
      }
      if (pageCount > 100) throw new UploadError("El PDF tiene más de 100 páginas. Divídelo en documentos más pequeños.");
      return { data: f.data, mime: "application/pdf", ext: "pdf", name: f.name, pageCount };
    }
    await assertDecodable(f.data, f.name);
    return { data: f.data, mime: f.type.mime as PreparedDocument["mime"], ext: f.type.ext, name: f.name, pageCount: 1 };
  }

  if (typed.some((f) => f.type.mime === "application/pdf")) {
    throw new UploadError("Para varias páginas sube un único PDF o varias fotos, pero no ambos a la vez.");
  }
  const pdf = await PDFDocument.create();
  for (const f of typed) {
    const jpeg = await sharp(f.data).rotate().jpeg({ quality: 88 }).toBuffer().catch(() => {
      throw new UploadError(`No se pudo leer la imagen «${f.name}».`);
    });
    const img = await pdf.embedJpg(jpeg);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const data = Buffer.from(await pdf.save());
  const base = typed[0].name.replace(/\.[^.]+$/, "");
  return { data, mime: "application/pdf", ext: "pdf", name: `${base} (${typed.length} páginas).pdf`, pageCount: typed.length };
}

async function assertDecodable(data: Buffer, name: string) {
  try {
    const m = await sharp(data).metadata();
    if (!m.width || !m.height) throw new Error();
    if (m.width < 300 || m.height < 300) throw new UploadError(`«${name}» tiene muy poca resolución para leerse con fiabilidad.`);
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError(`No se pudo leer la imagen «${name}».`);
  }
}

/** Prepara el original para el proveedor de IA (las imágenes se orientan y reducen; el original no cambia). */
export async function toExtractionPayload(data: Buffer, mime: string) {
  if (mime === "application/pdf") {
    if (data.length > 30 * 1024 * 1024) throw new UploadError("El PDF es demasiado grande para el reconocimiento (máx. 30 MB).");
    return { data, mimeType: "application/pdf" as const };
  }
  const out = await sharp(data)
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
  return { data: out, mimeType: "image/jpeg" as const };
}
