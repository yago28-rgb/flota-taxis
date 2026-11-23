import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Almacenamiento de documentos originales.
 *
 * Implementación local: los ficheros se guardan fuera de `public/` (nunca son accesibles
 * directamente) con un nombre derivado de su hash. Sólo se sirven mediante
 * /api/documents/[id], que exige sesión. Para usar S3/compatibles, implementar
 * `DocumentStorage` y seleccionarlo en `getStorage()`.
 */
export interface DocumentStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

class LocalStorage implements DocumentStorage {
  constructor(private root: string) {}
  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Clave de almacenamiento no válida");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { flag: "wx" }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e; // mismo hash ⇒ mismo contenido
    });
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async exists(key: string) {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

let storage: DocumentStorage | null = null;
export function getStorage(): DocumentStorage {
  storage ??= new LocalStorage(process.env.STORAGE_DIR ?? path.join(process.cwd(), "data", "documents"));
  return storage;
}

export function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function storageKeyFor(hash: string, ext: string): string {
  return `${hash.slice(0, 2)}/${hash}.${ext}`;
}

/* ─────────────── Validación de ficheros por contenido (no por extensión) ─────────────── */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type DetectedType = { mime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/heic"; ext: string };

export function detectFileType(buf: Buffer): DetectedType | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { mime: "image/webp", ext: "webp" };
  const ftyp = buf.subarray(4, 12).toString("latin1");
  if (ftyp.startsWith("ftyp") && /heic|heix|mif1|msf1|hevc/.test(ftyp)) return { mime: "image/heic", ext: "heic" };
  return null;
}
