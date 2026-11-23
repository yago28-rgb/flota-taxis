"""Segundo intérprete visual OPCIONAL: Qwen2.5-VL 3B ejecutado en local con Ollama.

- Desactivado por defecto (QWEN_ENABLED=1 para activarlo).
- Sólo habla con Ollama en este mismo equipo (127.0.0.1 / localhost). Sin claves, sin coste por uso.
- Sólo se consulta cuando el OCR y las reglas no han encontrado un dato clave o los importes no cuadran.
- Nunca sustituye un valor leído por el OCR: sólo rellena huecos, con confianza baja y marcado como
  procedente del modelo, para que la persona lo compruebe con el original.
"""
from __future__ import annotations

import base64
import io
import json
import os
import urllib.error
import urllib.request
from urllib.parse import urlparse

from PIL import Image

from .parsing import find_dates, fold

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("QWEN_MODEL", "qwen2.5vl:3b")
ENABLED = os.environ.get("QWEN_ENABLED", "0") == "1"
TIMEOUT = float(os.environ.get("QWEN_TIMEOUT", "180"))

_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}

SCHEMA = {
    "type": "object",
    "properties": {
        "issuer_name": {"type": ["string", "null"]},
        "issuer_tax_id": {"type": ["string", "null"]},
        "invoice_number": {"type": ["string", "null"]},
        "issue_date": {"type": ["string", "null"], "description": "DD/MM/AAAA tal como aparece"},
        "subtotal": {"type": ["number", "null"]},
        "tax_total": {"type": ["number", "null"]},
        "total": {"type": ["number", "null"]},
    },
    "required": ["issuer_name", "issuer_tax_id", "invoice_number", "issue_date", "subtotal", "tax_total", "total"],
}

PROMPT = (
    "Eres un lector de facturas españolas. Devuelve SOLO los datos que estén escritos en la imagen. "
    "Si un dato no aparece o no se lee con seguridad, devuelve null. No calcules ni completes nada. "
    "Importes con punto decimal (1.234,56 → 1234.56). Fecha tal como aparece (DD/MM/AAAA)."
)


def _assert_local(url: str) -> None:
    host = urlparse(url).hostname or ""
    if host not in _LOCAL_HOSTS:
        raise RuntimeError("OLLAMA_URL debe apuntar a este equipo (127.0.0.1 o localhost).")


def status() -> dict:
    if not ENABLED:
        return {"enabled": False, "available": False, "model": MODEL}
    try:
        _assert_local(OLLAMA_URL)
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=2) as r:
            tags = json.load(r)
        names = {m.get("name") for m in tags.get("models", [])}
        return {"enabled": True, "available": MODEL in names, "model": MODEL, "reason": None if MODEL in names else f"Falta el modelo: ollama pull {MODEL}"}
    except Exception as e:  # noqa: BLE001
        return {"enabled": True, "available": False, "model": MODEL, "reason": f"Ollama no responde en {OLLAMA_URL}: {e}"}


def _page_jpeg(img_bgr) -> str:
    pil = Image.fromarray(img_bgr[:, :, ::-1])
    pil.thumbnail((1600, 1600))
    buf = io.BytesIO()
    pil.save(buf, "JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode()


def ask(first_page_bgr, extra: str | None = None) -> dict | None:
    _assert_local(OLLAMA_URL)
    prompt = PROMPT + (f"\nParticularidades indicadas por el usuario: {extra[:1500]}" if extra else "")
    body = {
        "model": MODEL,
        "stream": False,
        "format": SCHEMA,
        "options": {"temperature": 0},
        "messages": [{"role": "user", "content": prompt, "images": [_page_jpeg(first_page_bgr)]}],
    }
    req = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        out = json.load(r)
    try:
        return json.loads(out["message"]["content"])
    except (KeyError, json.JSONDecodeError):
        return None


def needs_help(result: dict) -> bool:
    missing = any(result[k]["value"] is None for k in ("total", "issueDate")) or result["issuer"]["name"]["value"] is None
    mismatch = any("no cuadran" in w for w in result["warnings"])
    return missing or mismatch


def merge(result: dict, q: dict, ocr_text: str) -> list[str]:
    """Rellena SOLO huecos. Confianza 0.7 si el valor aparece también en el texto del OCR; 0.4 si no."""
    filled = []
    folded = fold(ocr_text)

    def seen(v) -> bool:
        if v is None:
            return False
        if isinstance(v, (int, float)):
            s = f"{v:,.2f}"
            return s.replace(",", "X").replace(".", ",").replace("X", ".") in ocr_text or f"{v:.2f}".replace(".", ",") in ocr_text or f"{v:.2f}" in ocr_text
        return fold(str(v)) in folded

    def put(target: dict, value, label: str):
        if target["value"] is None and value not in (None, ""):
            ok = seen(value)
            target.update({
                "value": value,
                "confidence": 0.7 if ok else 0.4,
                "evidence": f"Qwen2.5-VL local{' (coincide con el OCR)' if ok else ' (no confirmado por el OCR)'}",
            })
            filled.append(label)

    put(result["issuer"]["name"], q.get("issuer_name"), "emisor")
    put(result["issuer"]["taxId"], (q.get("issuer_tax_id") or "").replace(" ", "").replace("-", "").upper() or None, "NIF del emisor")
    put(result["invoiceNumber"], q.get("invoice_number"), "número")
    d = find_dates(q.get("issue_date") or "")
    put(result["issueDate"], d[0][0] if d else None, "fecha")
    put(result["subtotal"], q.get("subtotal"), "base")
    put(result["taxTotal"], q.get("tax_total"), "impuestos")
    put(result["total"], q.get("total"), "total")
    return filled
