"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, FileUp, Images, X, Check, ScanText, ShieldCheck, ArrowUp, ArrowDown } from "lucide-react";
import { Button, Card, Notice, Spinner, cx } from "@/components/ui";

type Item = { id: string; file: File; url: string | null };
type Phase = "idle" | "uploading" | "reading" | "done" | "error";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";
const MAX = 25 * 1024 * 1024;

export function Uploader({ provider }: { provider: { ready: boolean; reason: string | null; label: string } }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => () => items.forEach((i) => i.url && URL.revokeObjectURL(i.url)), [items]);

  const add = useCallback((files: FileList | File[]) => {
    setError(null);
    setDuplicate(null);
    const list = Array.from(files);
    setItems((prev) => {
      const next = [...prev];
      for (const f of list) {
        const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
        if (isPdf && (next.length > 0 || list.length > 1)) {
          setError("Un PDF se sube solo. Para varias páginas, sube un único PDF o varias fotos.");
          continue;
        }
        if (next.some((n) => n.file.type === "application/pdf")) {
          setError("Ya has añadido un PDF. Quítalo para subir fotos.");
          continue;
        }
        next.push({ id: crypto.randomUUID(), file: f, url: f.type.startsWith("image/") && !/hei[cf]/.test(f.type) ? URL.createObjectURL(f) : null });
      }
      return next;
    });
  }, []);

  const total = items.reduce((s, i) => s + i.file.size, 0);
  const tooBig = total > MAX;
  const move = (idx: number, d: -1 | 1) =>
    setItems((p) => {
      const n = [...p];
      const [x] = n.splice(idx, 1);
      n.splice(idx + d, 0, x);
      return n;
    });

  async function submit() {
    if (!items.length || tooBig) return;
    setError(null);
    setDuplicate(null);
    setPhase("uploading");
    try {
      const fd = new FormData();
      items.forEach((i) => fd.append("files", i.file, i.file.name));
      const up = await fetch("/api/invoices/upload", { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upData.error ?? "No se pudo subir el documento.");
      if (upData.duplicate) {
        setPhase("idle");
        setDuplicate(upData.invoiceId);
        return;
      }
      const id: string = upData.invoiceId;
      if (!provider.ready) {
        // Sin proveedor de IA: no se simula ninguna lectura. Se abre la factura para introducir los datos a mano.
        setPhase("done");
        router.push(`/facturas/${id}?subida=1`);
        return;
      }
      setPhase("reading");
      const ex = await fetch(`/api/invoices/${id}/extract`, { method: "POST" });
      await ex.json().catch(() => ({}));
      setPhase("done");
      router.push(`/facturas/${id}`);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Error inesperado.");
    }
  }

  const busy = phase === "uploading" || phase === "reading" || phase === "done";

  if (busy) {
    return (
      <Card className="mx-auto max-w-xl p-8 animate-in">
        <ol className="space-y-5">
          <Step state={phase === "uploading" ? "active" : "done"} icon={FileUp} title="Subiendo y guardando el original" text="El documento se guarda tal cual, cifrado en tránsito y sólo accesible para usuarios autorizados." />
          <Step state={phase === "reading" ? "active" : phase === "uploading" ? "pending" : "done"} icon={ScanText} title={provider.ready ? `Leyendo el documento · ${provider.label}` : "Reconocimiento automático no disponible"} text={provider.ready ? "Lectura local con PaddleOCR: 10–30 segundos por página. Sólo se extrae lo que aparece escrito." : "Introducirás los datos manualmente."} />
          <Step state={phase === "done" ? "active" : "pending"} icon={ShieldCheck} title="Validando importes, fechas y duplicados" text="Después podrás revisar y corregir cada campo." />
        </ol>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {!provider.ready && (
        <Notice tone="warning" title="El reconocimiento automático no está disponible">
          {provider.reason} El documento se guardará y podrás introducir sus datos manualmente. <Link href="/ajustes" className="font-medium underline">Ver cómo activarlo</Link>
        </Notice>
      )}

      <Card
        className={cx("border-2 border-dashed p-0 transition-colors animate-in", drag ? "border-accent bg-accent-soft" : "border-transparent")}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
      >
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent"><FileUp className="size-6" /></div>
          <h2 className="text-[19px] font-semibold">Añade el documento</h2>
          <p className="mt-1 max-w-md text-[14px] text-text-2">
            Una factura por subida. Si tiene varias páginas, haz una foto de cada una en orden o sube el PDF completo.
          </p>
          <div className="mt-6 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
            <Button size="lg" onClick={() => camera.current?.click()} className="sm:hidden"><Camera className="size-4" />Hacer foto</Button>
            <Button size="lg" variant="secondary" onClick={() => picker.current?.click()} className="sm:col-span-2"><Images className="size-4" />Elegir archivos</Button>
          </div>
          <p className="mt-3 hidden text-[12px] text-text-3 sm:block">o arrástralos aquí · PDF, JPG, PNG o WEBP · máx. 25 MB</p>
          <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
          <input ref={picker} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
        </div>
      </Card>

      {duplicate && (
        <Notice tone="warning" title="Este documento ya se había subido" action={<Link href={`/facturas/${duplicate}`} className="shrink-0 font-medium underline">Abrir</Link>}>
          Es exactamente el mismo archivo. No se ha creado una factura nueva.
        </Notice>
      )}
      {error && <Notice tone="negative">{error}</Notice>}

      {items.length > 0 && (
        <Card className="animate-in">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <div className="text-[13px] text-text-2">
              {items.length === 1 ? "1 archivo" : `${items.length} páginas`} · {(total / 1024 / 1024).toFixed(1)} MB
              {tooBig && <span className="ml-2 text-negative">supera 25 MB</span>}
            </div>
            {items.length > 1 && <span className="text-[12px] text-text-3">Se unirán en un PDF en este orden</span>}
          </div>
          <ul className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-4">
            {items.map((it, idx) => (
              <li key={it.id} className="group relative overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line">
                <div className="aspect-[3/4] w-full">
                  {it.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.url} alt={`Página ${idx + 1}`} className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center text-text-3"><FileUp className="size-8" /></div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-[11px]">
                  <span className="truncate text-text-2">{items.length > 1 ? `Pág. ${idx + 1}` : it.file.name}</span>
                  <span className="flex shrink-0">
                    {idx > 0 && <button type="button" onClick={() => move(idx, -1)} className="grid size-6 place-items-center rounded-full hover:bg-fill" aria-label="Mover antes"><ArrowUp className="size-3" /></button>}
                    {idx < items.length - 1 && <button type="button" onClick={() => move(idx, 1)} className="grid size-6 place-items-center rounded-full hover:bg-fill" aria-label="Mover después"><ArrowDown className="size-3" /></button>}
                  </span>
                </div>
                <button type="button" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-white backdrop-blur" aria-label="Quitar">
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
            {items.length > 0 && items[0].file.type.startsWith("image/") && (
              <Button variant="secondary" onClick={() => camera.current?.click()} className="sm:hidden"><Camera className="size-4" />Añadir página</Button>
            )}
            <Button variant="secondary" onClick={() => setItems([])}>Quitar todo</Button>
            <Button onClick={submit} disabled={tooBig}>{provider.ready ? "Subir y leer" : "Subir documento"}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Step({ state, icon: Icon, title, text }: { state: "pending" | "active" | "done"; icon: typeof FileUp; title: string; text: string }) {
  return (
    <li className={cx("flex gap-4 transition-opacity duration-300", state === "pending" && "opacity-40")}>
      <span className={cx("grid size-10 shrink-0 place-items-center rounded-full", state === "done" ? "bg-positive-soft text-positive" : state === "active" ? "bg-accent-soft text-accent" : "bg-fill-2 text-text-3")}>
        {state === "done" ? <Check className="size-5" /> : state === "active" ? <Spinner className="size-5" /> : <Icon className="size-5" />}
      </span>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-[13px] text-text-2">{text}</div>
      </div>
    </li>
  );
}
