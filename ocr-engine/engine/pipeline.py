"""Orquestación: OCR → (tablas si hacen falta) → extracción → (Qwen local si hace falta)."""
from __future__ import annotations

import os
import time

from . import qwen
from .extractor import build_lines, extract
from .model import Context
from .ocr import PaddleOcrEngine, load_pages

# auto: PP-OCRv5 y, si no aparece la tabla de conceptos, PP-StructureV3 · ocr: sólo PP-OCRv5 · structure: siempre ambos
MODE = os.environ.get("OCR_MODE", "auto")

engine = PaddleOcrEngine()


def process(data: bytes, mime: str, ctx: Context) -> dict:
    t0 = time.perf_counter()
    doc = engine.read(data, mime, want_tables=(MODE == "structure"))
    result = extract(doc, ctx)
    used_structure = MODE == "structure"

    # PP-StructureV3 es lento en CPU: sólo cuando la posición del texto no ha dado ninguna línea de detalle.
    if MODE == "auto" and result["readable"] and not result["lines"]:
        doc.tables = engine.tables_for(data, mime)
        used_structure = True
        if doc.tables:
            result = extract(doc, ctx)

    qwen_used: list[str] = []
    if qwen.ENABLED and result["readable"] and qwen.needs_help(result):
        st = qwen.status()
        if st["available"]:
            try:
                images, _ = load_pages(data, mime)
                q = qwen.ask(images[0], ctx.extra_instructions)
                if q:
                    text = "\n".join(ln.text for ln in build_lines(doc))
                    qwen_used = qwen.merge(result, q, text)
                    if qwen_used:
                        result["warnings"].append(
                            "Completado con Qwen2.5-VL (local): " + ", ".join(qwen_used) + ". Compruébalo con el original."
                        )
            except Exception as e:  # noqa: BLE001
                result["warnings"].append(f"El intérprete visual local no respondió: {e}")
        else:
            result["warnings"].append(f"Intérprete visual local no disponible: {st.get('reason')}")

    total_pages = getattr(doc, "total_pages", len(doc.pages))
    result["pageCount"] = total_pages
    if total_pages > len(doc.pages):
        result["warnings"].append(f"Sólo se han leído las primeras {len(doc.pages)} de {total_pages} páginas.")

    models = [engine.name] + (["PP-StructureV3"] if used_structure else []) + ([f"Qwen2.5-VL ({qwen.MODEL})"] if qwen_used else [])
    return {
        "result": result,
        "engine": {"models": models, "seconds": round(time.perf_counter() - t0, 2), "pages": len(doc.pages), "tokens": len(doc.tokens)},
    }
