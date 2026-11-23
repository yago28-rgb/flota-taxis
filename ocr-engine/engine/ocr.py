"""Motores OCR. La aplicación sólo depende de la interfaz `OcrEngine` → `OcrDocument`.

PaddleOcrEngine:
- PP-OCRv5 (detección + reconocimiento, modelo latino para español) para todo el texto.
- PP-StructureV3 (opcional) para reconstruir tablas cuando la posición del texto no basta.
Todo se ejecuta en local. Los modelos se descargan una única vez y quedan en caché.
"""
from __future__ import annotations

import io
import os
import threading
from html.parser import HTMLParser
from typing import Protocol

import numpy as np
from PIL import Image, ImageOps

from .model import OcrDocument, Page, Table, Token

# Sin comprobaciones de conectividad al arrancar: funciona sin Internet con los modelos en caché.
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

MAX_PAGES = int(os.environ.get("OCR_MAX_PAGES", "30"))
PDF_DPI = int(os.environ.get("OCR_PDF_DPI", "200"))
MAX_SIDE = int(os.environ.get("OCR_MAX_SIDE", "2400"))


class OcrEngine(Protocol):
    name: str

    def read(self, data: bytes, mime: str, want_tables: bool = False) -> OcrDocument: ...


# ─────────────────────────────── Entrada ───────────────────────────────


def load_pages(data: bytes, mime: str) -> tuple[list[np.ndarray], int]:
    """Devuelve las páginas como imágenes BGR y el número total de páginas del documento."""
    if mime == "application/pdf":
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(data)
        total = len(pdf)
        imgs = []
        for i in range(min(total, MAX_PAGES)):
            pil = pdf[i].render(scale=PDF_DPI / 72).to_pil().convert("RGB")
            imgs.append(_to_bgr(_limit(pil)))
        pdf.close()
        return imgs, total
    pil = Image.open(io.BytesIO(data))
    pil = ImageOps.exif_transpose(pil).convert("RGB")
    return [_to_bgr(_limit(pil))], 1


def _limit(pil: Image.Image) -> Image.Image:
    w, h = pil.size
    s = MAX_SIDE / max(w, h)
    return pil.resize((round(w * s), round(h * s)), Image.LANCZOS) if s < 1 else pil


def _to_bgr(pil: Image.Image) -> np.ndarray:
    return np.ascontiguousarray(np.asarray(pil)[:, :, ::-1])


# ─────────────────────────────── Tablas HTML ───────────────────────────────


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._span = 1

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._cell = []
            self._span = int(dict(attrs).get("colspan", "1") or 1)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._row.extend([""] * (self._span - 1))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if any(c.strip() for c in self._row):
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def html_table_rows(html: str) -> list[list[str]]:
    p = _TableParser()
    p.feed(html)
    return p.rows


# ─────────────────────────────── PaddleOCR ───────────────────────────────


def _get(obj, key, default=None):
    try:
        return obj[key]
    except (KeyError, TypeError, IndexError):
        return getattr(obj, key, default)


def _tokens_from_ocr(res, page: int) -> tuple[list[Token], tuple[int, int] | None]:
    texts = list(_get(res, "rec_texts", []) or [])
    scores = list(_get(res, "rec_scores", []) or [])
    boxes = _get(res, "rec_boxes", None)
    if boxes is None or len(boxes) == 0:
        polys = _get(res, "rec_polys", []) or []
        boxes = [[float(np.min(p[:, 0])), float(np.min(p[:, 1])), float(np.max(p[:, 0])), float(np.max(p[:, 1]))] for p in polys]
    polys = list(_get(res, "rec_polys", []) or [])
    toks = []
    for i, (t, s, b) in enumerate(zip(texts, scores, boxes)):
        if not str(t).strip():
            continue
        x0, y0, x1, y1 = (float(v) for v in list(b)[:4])
        angle = th = 0.0
        if i < len(polys) and len(polys[i]) >= 4:
            p = np.asarray(polys[i], dtype=float)  # esquinas: sup-izq, sup-der, inf-der, inf-izq
            angle = float(np.arctan2(p[1][1] - p[0][1], p[1][0] - p[0][0]))
            th = float(np.hypot(*(p[3] - p[0])))
        toks.append(Token(text=str(t), conf=float(s), x0=x0, y0=y0, x1=x1, y1=y1, page=page, angle=angle, th=th))
    size = None
    pre = _get(res, "doc_preprocessor_res", None)
    if pre is not None:
        img = _get(pre, "output_img", None)
        if img is not None:
            size = (img.shape[1], img.shape[0])
    return toks, size


def _model_overrides() -> dict:
    """OCR_DET_MODEL / OCR_REC_MODEL permiten fijar modelos concretos (p. ej. PP-OCRv5_mobile_det, más rápido)."""
    o = {}
    if os.environ.get("OCR_DET_MODEL"):
        o["text_detection_model_name"] = os.environ["OCR_DET_MODEL"]
    if os.environ.get("OCR_REC_MODEL"):
        o["text_recognition_model_name"] = os.environ["OCR_REC_MODEL"]
    return o


def _model_label() -> str:
    det, rec = os.environ.get("OCR_DET_MODEL"), os.environ.get("OCR_REC_MODEL")
    return " + ".join(x for x in (det, rec) if x) or "modelos PP-OCR por defecto"


class PaddleOcrEngine:
    def __init__(self, lang: str | None = None, device: str | None = None):
        self.lang = lang or os.environ.get("OCR_LANG", "es")
        self.device = device or os.environ.get("OCR_DEVICE", "cpu")
        self._ocr = None
        self._structure = None
        self._lock = threading.Lock()
        self.name = f"PaddleOCR ({self.lang})"

    def load(self) -> None:
        if self._ocr is None:
            from paddleocr import PaddleOCR

            import paddleocr

            self._ocr = PaddleOCR(
                lang=self.lang,
                device=self.device,
                use_doc_orientation_classify=True,  # fotos giradas
                use_doc_unwarping=os.environ.get("OCR_UNWARP") == "1",  # fotos muy curvadas (más lento)
                use_textline_orientation=True,
                **_model_overrides(),
            )
            self.name = f"PaddleOCR {paddleocr.__version__} ({_model_label()}, {self.lang})"

    def load_structure(self) -> None:
        if self._structure is None:
            from paddleocr import PPStructureV3

            kwargs = dict(
                device=self.device,
                use_doc_orientation_classify=True,
                use_doc_unwarping=False,
                use_table_recognition=True,
                use_seal_recognition=False,
                use_formula_recognition=False,
                use_chart_recognition=False,
            )
            try:
                self._structure = PPStructureV3(lang=self.lang, **kwargs)
            except TypeError:
                self._structure = PPStructureV3(**kwargs)

    def read(self, data: bytes, mime: str, want_tables: bool = False) -> OcrDocument:
        images, total = load_pages(data, mime)
        with self._lock:
            self.load()
            pages: list[Page] = []
            for i, img in enumerate(images):
                res = list(self._ocr.predict(img))[0]
                toks, size = _tokens_from_ocr(res, i)
                w, h = size or (img.shape[1], img.shape[0])
                pages.append(Page(index=i, width=float(w), height=float(h), tokens=toks))
            tables = self.read_tables(images) if want_tables else []
        doc = OcrDocument(pages=pages, tables=tables, engine=self.name)
        doc.total_pages = total  # type: ignore[attr-defined]
        return doc

    def read_tables(self, images: list[np.ndarray]) -> list[Table]:
        """PP-StructureV3: tablas en HTML → filas de celdas. Llamar con el lock tomado."""
        self.load_structure()
        tables: list[Table] = []
        for i, img in enumerate(images):
            res = list(self._structure.predict(img))[0]
            for t in _get(res, "table_res_list", []) or []:
                html = _get(t, "pred_html", "") or ""
                rows = html_table_rows(html)
                if rows:
                    tables.append(Table(page=i, rows=rows))
        return tables

    def tables_for(self, data: bytes, mime: str) -> list[Table]:
        images, _ = load_pages(data, mime)
        with self._lock:
            return self.read_tables(images)
