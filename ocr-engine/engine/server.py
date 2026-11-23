"""Servicio HTTP local del motor de reconocimiento.

Escucha SOLO en 127.0.0.1: la aplicación web le envía el documento y recibe el JSON estructurado.
Ningún documento sale del equipo.

    python -m engine.server            (puerto 8765, o OCR_PORT)
"""
from __future__ import annotations

import json
import os
import threading
import traceback
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from . import qwen
from .model import Context

MAX_BYTES = 30 * 1024 * 1024
_state = {"status": "loading", "error": None}


def _warmup():
    try:
        from .pipeline import engine

        engine.load()
        _state["status"] = "ready"
        print(f"Motor listo: {engine.name}", flush=True)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        _state.update(status="error", error=str(e))


@asynccontextmanager
async def lifespan(_app):
    # Los modelos se cargan en segundo plano: /health responde «loading» mientras tanto.
    threading.Thread(target=_warmup, daemon=True).start()
    yield


app = FastAPI(title="Flota OCR", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/health")
def health():
    from .pipeline import MODE, engine

    return {"status": _state["status"], "error": _state["error"], "engine": engine.name, "mode": MODE, "qwen": qwen.status()}


def _mime(data: bytes) -> str:
    if data[:5] == b"%PDF-":
        return "application/pdf"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise HTTPException(415, "Formato no admitido. Usa PDF, JPG, PNG o WEBP.")


@app.post("/extract")
def extract_endpoint(file: UploadFile = File(...), context: str = Form("{}")):
    if _state["status"] != "ready":
        raise HTTPException(503, "El motor de reconocimiento se está iniciando." if _state["status"] == "loading" else f"El motor no pudo iniciarse: {_state['error']}")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "El documento supera 30 MB.")
    mime = _mime(data)
    try:
        c = json.loads(context or "{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "Contexto no válido.")
    ctx = Context(
        owner_name=c.get("ownerName"),
        owner_tax_id=c.get("ownerTaxId"),
        known_plates=list(c.get("knownPlates") or []),
        known_licenses=list(c.get("knownLicenses") or []),
        known_drivers=list(c.get("knownDrivers") or []),
        extra_instructions=(c.get("extraInstructions") or None),
    )
    from .pipeline import process

    try:
        return process(data, mime, ctx)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(500, f"Error del motor de reconocimiento: {e}")


def main():
    port = int(os.environ.get("OCR_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
