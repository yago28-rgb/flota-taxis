"""Interpretación de la salida del OCR: de texto con posiciones a datos de factura.

Principios:
- Sólo se devuelve lo que está impreso. Si un dato no aparece o es ambiguo → value = None.
- Cada valor lleva la confianza combinada (OCR × regla) y el texto literal del que sale.
- No se calculan importes que no estén escritos; las incoherencias se avisan, no se corrigen.

El resultado sigue el esquema `ExtractionResult` de la aplicación (src/lib/extraction/types.ts).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from statistics import mean, median
from typing import Any

from .model import Context, OcrDocument, Table, Token
from .parsing import (
    find_amounts,
    find_dates,
    find_percents,
    find_plates,
    find_tax_ids,
    fold,
    normalize_plate,
    parse_amount,
    tax_id_valid,
)

# ─────────────────────────────── Líneas de texto ───────────────────────────────


@dataclass
class Line:
    page: int
    tokens: list[Token]
    index: int = 0  # posición en el documento

    @property
    def text(self) -> str:
        return " ".join(t.text.strip() for t in self.tokens if t.text.strip())

    @property
    def folded(self) -> str:
        return fold(self.text)

    @property
    def y(self) -> float:
        return mean(t.cy for t in self.tokens)

    @property
    def x0(self) -> float:
        return min(t.x0 for t in self.tokens)

    @property
    def x1(self) -> float:
        return max(t.x1 for t in self.tokens)

    @property
    def h(self) -> float:
        return median(t.h for t in self.tokens)

    @property
    def conf(self) -> float:
        return mean(t.conf for t in self.tokens) if self.tokens else 0.0


def _deskew(tokens: list[Token]) -> None:
    """Fotos ligeramente giradas: compensa la inclinación media de los textos largos para agrupar renglones."""
    angles = [t.angle for t in tokens if (t.x1 - t.x0) > 3 * t.h and abs(t.angle) < 0.35]
    a = median(angles) if len(angles) >= 3 else 0.0
    slope = math.tan(a) if abs(a) > 0.004 else 0.0
    for t in tokens:
        t.shift = t.cx * slope if slope else 0.0


def build_lines(doc: OcrDocument) -> list[Line]:
    """Agrupa los fragmentos en líneas visuales (mismo renglón), en orden de lectura."""
    lines: list[Line] = []
    for page in doc.pages:
        _deskew(page.tokens)
        toks = sorted((t for t in page.tokens if t.text.strip()), key=lambda t: (t.cy, t.x0))
        current: list[list[Token]] = []
        for t in toks:
            placed = False
            for row in current[-3:]:
                rc = median(x.cy for x in row)
                rh = median(x.h for x in row)
                overlap = min(rc + rh / 2, t.cy + t.h / 2) - max(rc - rh / 2, t.cy - t.h / 2)
                if overlap >= 0.5 * min(rh, t.h):
                    row.append(t)
                    placed = True
                    break
            if not placed:
                current.append([t])
        for row in current:
            lines.append(Line(page=page.index, tokens=sorted(row, key=lambda x: x.x0)))
    for i, ln in enumerate(lines):
        ln.index = i
    return lines


# ─────────────────────────────── Campos ───────────────────────────────


def F(value: Any = None, conf: float = 0.0, evidence: str | None = None) -> dict:
    if value is None:
        return {"value": None, "confidence": 0.0, "evidence": None}
    return {"value": value, "confidence": round(max(0.0, min(1.0, conf)), 3), "evidence": (evidence or "")[:120] or None}


TOTAL_LABELS = [
    # (clave, patrón, prioridad) — la prioridad desempata entre varias apariciones.
    ("total", r"total\s+(?:factura|a\s+pagar|documento|importe|eur(?:os)?|€)|importe\s+total|total\s+general|a\s+pagar", 3),
    ("total", r"(?<!sub)(?<!sub\s)\btotal\b(?!\s+(?:base|bruto|neto|iva|i\.v\.a|impuestos?|cuota|lineas?|unidades|uds|dto|descuento|retenc|irpf|conceptos))", 1),
    ("subtotal", r"base\s+imponible|b\.\s?imponible|base\s+imp\.?|\bsubtotal\b|importe\s+neto|total\s+(?:base|neto|bruto)|\bbase\b", 2),
    ("tax", r"total\s+(?:iva|i\.v\.a\.?|impuestos?)|cuota\s+(?:iva|i\.v\.a\.?|igic)|\b(?:i\.v\.a\.?|iva|igic)\b|\bimpuestos?\b|\bcuota\b", 2),
    ("withholding", r"retenci[oó]n|\bret\.|\birpf\b", 2),
]
_TOTAL_RX = [(k, re.compile(p, re.IGNORECASE), pr) for k, p, pr in TOTAL_LABELS]


@dataclass
class Hit:
    value: Any
    conf: float
    evidence: str
    priority: int = 0
    line: int = 0


@dataclass
class Extraction:
    lines: list[Line]
    ctx: Context
    warnings: list[str] = field(default_factory=list)


def _label_segments(line: Line) -> list[tuple[str, int, int, int]]:
    """Etiquetas de totales en una línea: (clave, inicio, fin, prioridad), sin solapes."""
    text = line.folded
    found: list[tuple[str, int, int, int]] = []
    for key, rx, pr in _TOTAL_RX:
        for m in rx.finditer(text):
            if any(not (m.end() <= s or m.start() >= e) for _, s, e, _ in found):
                continue
            found.append((key, m.start(), m.end(), pr))
    return sorted(found, key=lambda x: x[1])


def _next_line_below(lines: list[Line], ln: Line, x0: float, x1: float, max_gap: float = 2.2) -> Line | None:
    for other in lines[ln.index + 1: ln.index + 4]:
        if other.page != ln.page:
            return None
        if other.y - ln.y > max_gap * ln.h:
            return None
        if other.x1 >= x0 - ln.h and other.x0 <= x1 + 4 * ln.h:
            return other
    return None


def extract_totals(ex: Extraction) -> dict[str, Hit]:
    best: dict[str, Hit] = {}

    def offer(key: str, hit: Hit):
        cur = best.get(key)
        # Más prioridad gana; a igual prioridad, la aparición más abajo (los totales van al final).
        if cur is None or hit.priority > cur.priority or (hit.priority == cur.priority and hit.line > cur.line):
            best[key] = hit

    lines = ex.lines
    for ln in lines:
        segs = _label_segments(ln)
        if not segs:
            continue
        text = ln.folded
        # Etiquetas en fila con los valores en la línea de abajo (cuadro de totales horizontal).
        if len(segs) >= 2 and not find_amounts(ln.text):
            below = _next_line_below(lines, ln, ln.x0, ln.x1)
            if below:
                amts = _token_amounts(below)
                if len(amts) >= len(segs):
                    label_x = _label_centers(ln, segs)
                    for (key, _, _, pr), lx in zip(segs, label_x):
                        v, tok = min(amts, key=lambda a: abs(a[1].cx - lx))
                        offer(key, Hit(v, 0.85 * tok.conf, f"{ln.text} | {below.text}", pr, ln.index))
                    continue
        for i, (key, s, e, pr) in enumerate(segs):
            end = segs[i + 1][1] if i + 1 < len(segs) else len(text)
            seg_raw = ln.text[s:end] if len(ln.text) == len(text) else text[s:end]
            amts = [a for a in find_amounts(seg_raw[e - s:])]
            if key == "tax":
                # «IVA 21% s/100,00 21,00» → la cuota es el último importe.
                pass
            if amts:
                v = amts[-1][0]
                offer(key, Hit(v, 0.95 * ln.conf, ln.text, pr, ln.index))
            elif i == len(segs) - 1:
                below = _next_line_below(lines, ln, ln.x0, ln.x1, 1.8)
                if below and not _label_segments(below):
                    b = find_amounts(below.text)
                    if len(b) == 1:
                        offer(key, Hit(b[0][0], 0.8 * below.conf, f"{ln.text} {below.text}", pr, ln.index))
    return best


def _token_amounts(ln: Line) -> list[tuple[float, Token]]:
    out = []
    for t in ln.tokens:
        for v, _, _ in find_amounts(t.text):
            out.append((v, t))
    return out


def _label_centers(ln: Line, segs) -> list[float]:
    """Centro horizontal aproximado de cada etiqueta, a partir de los fragmentos que la contienen."""
    centers = []
    for key, s, e, _ in segs:
        pos = 0
        cx = None
        for t in ln.tokens:
            start, end = pos, pos + len(t.text.strip())
            if start <= s < end + 1 or start < e <= end + 1:
                cx = t.cx
                break
            pos = end + 1
        centers.append(cx if cx is not None else (ln.x0 + ln.x1) / 2)
    return centers


def extract_tax_breakdown(ex: Extraction) -> list[dict]:
    """Filas «tipo % · base · cuota» donde la cuota impresa corresponde a base × tipo."""
    rows = []
    for ln in ex.lines:
        pcts = find_percents(ln.text)
        if len(pcts) != 1:
            continue
        amts = [a[0] for a in find_amounts(ln.text)]
        if len(amts) < 2:
            continue
        rate = pcts[0]
        for i in range(len(amts) - 1):
            base, amount = amts[i], amts[i + 1]
            if abs(round(base * rate / 100, 2) - amount) <= 0.02:
                rows.append({"rate": rate, "base": base, "amount": amount, "_ev": ln.text, "_conf": ln.conf})
                break
    return rows


# ─────────────────────────────── Identificación ───────────────────────────────

CLIENT_LABEL = re.compile(r"\b(cliente|destinatario|facturar\s+a|datos\s+del\s+cliente|receptor|comprador|adquiriente|tomador|asegurado|titular|bill\s+to|senor(?:es)?|sr\.|sra\.)\b")
# Título del documento pegado al nombre por el OCR («TALLERES X S.LFACTURA», «MUTUA S.A. | FACTURA»).
DOC_TITLE_TAIL = re.compile(r"\s*(?:factura(?:\s+simplificada|\s+rectificativa|\s+proforma)?|invoice|ticket|presupuesto|albar[aá]n)\s*$", re.IGNORECASE)


def _name_text(ln: Line) -> str:
    parts = [t.text.strip() for t in ln.tokens if not DOC_TITLE_TAIL.fullmatch(t.text.strip())]
    text = " ".join(p for p in parts if p)
    return DOC_TITLE_TAIL.sub("", text).strip(" -|")
ISSUER_LABEL = re.compile(r"\b(emisor|proveedor|razon\s+social|vendedor|expedidor)\b")
COMPANY_RX = re.compile(r"\b(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?coop\.?|c\.?\s?b\.?|s\.?\s?l\.?\s?l\.?|sociedad|limitada|anonima)$|\b(s\.?l\.?u?|s\.?a\.?u?)\b", re.IGNORECASE)
NOT_NAME = re.compile(
    r"(factura|fecha|n[iº°]f|c\.?i\.?f|nie\b|tel[eé]?f?|tlf|m[oó]vil|e-?mail|@|www\.|https?:|c/|calle|avda|avenida|plaza|paseo|ctra|carretera|pol[ií]gono|p\.i\.|\bcp\b|c\.p\.|\d{5}\b|"
    r"pagina|página|cliente|destinatario|tomador|iban|swift|concepto|total|importe|base|iva|n[º°]|numero|forma de pago|"
    r"matr[ií]cula|licencia|veh[ií]culo|bastidor|kil[oó]metros|\bkm\b|periodo|per[ií]odo|vencimiento|madrid\s*$)",
    re.IGNORECASE,
)


def _is_name_like(text: str) -> bool:
    t = text.strip()
    if len(t) < 3 or not re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}", t):
        return False
    if NOT_NAME.search(t):
        return False
    digits = sum(c.isdigit() for c in t)
    return digits <= len(t) * 0.25


def extract_parties(ex: Extraction) -> dict[str, Hit | None]:
    lines, ctx = ex.lines, ex.ctx
    owner = (ctx.owner_tax_id or "").upper().replace("ES", "", 1) if ctx.owner_tax_id else None

    ids: list[tuple[str, Line, str]] = []
    for ln in lines:
        for v, lit, _ in find_tax_ids(ln.text):
            if not any(v == x[0] for x in ids):
                ids.append((v, ln, lit))

    client_lines = [ln for ln in lines if CLIENT_LABEL.search(ln.folded)]

    def in_client_block(ln: Line) -> bool:
        for cl in client_lines:
            if cl.page == ln.page and 0 <= ln.index - cl.index <= 7:
                # Mismo bloque: columna parecida o etiqueta en la misma línea.
                if cl.index == ln.index or abs(cl.x0 - ln.x0) < 0.35 * _page_width(ex, ln.page):
                    return True
        return False

    issuer_id = recipient_id = None
    for v, ln, lit in ids:
        role = "recipient" if in_client_block(ln) else "issuer"
        if owner and v == owner and not client_lines:
            role = "recipient"
        if role == "issuer" and issuer_id is None:
            issuer_id = (v, ln, lit)
        elif role == "recipient" and recipient_id is None:
            recipient_id = (v, ln, lit)
    # Sin bloque de cliente y dos identificadores: el del titular es el receptor.
    if not client_lines and owner and issuer_id and issuer_id[0] == owner and len(ids) > 1:
        other = next(x for x in ids if x[0] != owner)
        recipient_id, issuer_id = issuer_id, other

    out: dict[str, Hit | None] = {"issuerTax": None, "recipientTax": None, "issuerName": None, "recipientName": None}
    for key, item in (("issuerTax", issuer_id), ("recipientTax", recipient_id)):
        if item:
            v, ln, lit = item
            valid = tax_id_valid(v)
            out[key] = Hit(v, (0.95 if valid else 0.6) * ln.conf, ln.text)
            if not valid:
                ex.warnings.append(f"El NIF/CIF «{v}» no supera la comprobación de su dígito de control: revisa la lectura.")

    # Nombre del emisor: «Razón social: X», línea con forma societaria en la cabecera, o la más destacada.
    for ln in lines[:40]:
        m = ISSUER_LABEL.search(ln.folded)
        if m:
            rest = ln.text[m.end():].strip(" :-")
            if _is_name_like(rest):
                out["issuerName"] = Hit(rest, 0.9 * ln.conf, ln.text)
                break
    if not out["issuerName"]:
        top = [ln for ln in lines if ln.page == 0 and ln.y < 0.35 * _page_height(ex, 0) and not in_client_block(ln) and not CLIENT_LABEL.search(ln.folded)]
        if issuer_id:
            near = [ln for ln in lines if ln.page == issuer_id[1].page and 0 <= issuer_id[1].index - ln.index <= 4 and not in_client_block(ln)]
            top = near + [t for t in top if t not in near]
        names = [ln for ln in top if _is_name_like(_name_text(ln))]
        company = [ln for ln in names if COMPANY_RX.search(_name_text(ln))]
        if company:
            ln = company[0]
            out["issuerName"] = Hit(_strip_label(_name_text(ln)), 0.85 * ln.conf, ln.text)
        elif names:
            ln = max(names[:6], key=lambda x: x.h)
            out["issuerName"] = Hit(_strip_label(_name_text(ln)), 0.6 * ln.conf, ln.text)

    # Nombre del receptor: tras la etiqueta de cliente (misma línea o las siguientes de la misma columna).
    for cl in client_lines:
        m = CLIENT_LABEL.search(cl.folded)
        rest = cl.text[m.end():].strip(" :-") if m else ""
        # «Tomador: Antonio Pérez García NIF 12345678Z» → se corta en el identificador.
        rest = re.split(r"\s+(?:n\.?i\.?f|c\.?i\.?f|d\.?n\.?i|nie)\b", rest, flags=re.IGNORECASE)[0].strip(" :-,")
        if _is_name_like(rest):
            out["recipientName"] = Hit(rest, 0.85 * cl.conf, cl.text)
            break
        col = 0.2 * _page_width(ex, cl.page)
        for nxt in lines[cl.index + 1: cl.index + 5]:
            if nxt.page == cl.page and abs(nxt.x0 - cl.x0) < col and _is_name_like(nxt.text):
                out["recipientName"] = Hit(nxt.text.strip(), 0.8 * nxt.conf, f"{cl.text} | {nxt.text}")
                break
        if out["recipientName"]:
            break
    if ctx.owner_name and not out["recipientName"]:
        on = fold(ctx.owner_name)
        for ln in lines:
            if on and on in ln.folded and not (out["issuerName"] and fold(out["issuerName"].value) == on):
                out["recipientName"] = Hit(ctx.owner_name, 0.85 * ln.conf, ln.text)
                break
    return out


def _strip_label(t: str) -> str:
    return re.sub(r"^(emisor|proveedor|raz[oó]n social)\s*[:\-]\s*", "", t.strip(), flags=re.IGNORECASE)


def _page_width(ex: Extraction, page: int) -> float:
    xs = [ln.x1 for ln in ex.lines if ln.page == page]
    return max(xs) if xs else 1000.0


def _page_height(ex: Extraction, page: int) -> float:
    ys = [ln.y for ln in ex.lines if ln.page == page]
    return max(ys) if ys else 1000.0


# ─────────────────────────────── Número, tipo, fechas ───────────────────────────────

NUMBER_LABELS = [
    (r"(?:n[º°o]\.?|num(?:ero)?\.?|nro\.?)\s*(?:de\s+)?factura", 0.95),
    (r"factura\s*(?:n[º°o]\.?|num(?:ero)?\.?|nro\.?|#)", 0.95),
    (r"(?:n[º°o]\.?|num(?:ero)?\.?)\s*(?:de\s+)?(?:documento|doc\.|ticket|recibo)", 0.9),
    (r"invoice\s*(?:no\.?|number|#)", 0.9),
    (r"\bfactura\s*:", 0.85),
    (r"(?:^|\s)n[º°]\s*[:.]", 0.75),
    (r"\bnumero\s*:", 0.75),
]
NUMBER_VALUE = re.compile(r"^\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-/._]{0,30})", re.IGNORECASE)


def _plausible_number(v: str) -> bool:
    if not re.search(r"\d", v):
        return False
    if find_dates(v) or find_tax_ids(v) or "%" in v:
        return False
    return len(v) <= 30


def extract_number(ex: Extraction) -> Hit | None:
    for pattern, rule_conf in NUMBER_LABELS:
        rx = re.compile(pattern, re.IGNORECASE)
        for ln in ex.lines:
            m = rx.search(ln.folded)
            if not m:
                continue
            rest = ln.text[m.end():] if len(ln.text) == len(ln.folded) else ln.folded[m.end():]
            vm = NUMBER_VALUE.match(rest)
            if vm and _plausible_number(vm.group(1).rstrip(".")):
                return Hit(vm.group(1).rstrip("."), rule_conf * ln.conf, ln.text)
            below = _next_line_below(ex.lines, ln, ln.x0, ln.x1, 2.0)
            if below:
                first = below.tokens[0].text.strip() if below.tokens else ""
                for tok in below.tokens:
                    if abs(tok.cx - (ln.x0 + ln.x1) / 2) < 3 * ln.h or tok is below.tokens[0]:
                        first = tok.text.strip()
                        break
                vm = NUMBER_VALUE.match(first)
                if vm and _plausible_number(vm.group(1)):
                    return Hit(vm.group(1).rstrip("."), 0.8 * rule_conf * below.conf, f"{ln.text} | {below.text}")
    # «FACTURA F-2026/0012» como título.
    for ln in ex.lines[:25]:
        m = re.match(r"^\s*factura\s+([A-Z0-9][A-Z0-9\-/._]{2,30})\s*$", ln.text, re.IGNORECASE)
        if m and _plausible_number(m.group(1)):
            return Hit(m.group(1), 0.7 * ln.conf, ln.text)
    return None


DOC_TYPES = [
    (r"factura\s+simplificada", "Factura simplificada"),
    (r"factura\s+rectificativa", "Factura rectificativa"),
    (r"factura\s+proforma|\bproforma\b", "Factura proforma"),
    (r"\babono\b|nota\s+de\s+credito", "Abono"),
    (r"\bpresupuesto\b", "Presupuesto"),
    (r"\balbaran\b", "Albarán"),
    (r"\bliquidacion\b", "Liquidación"),
    (r"\brecibo\b", "Recibo"),
    (r"\bticket\b|\btique\b", "Ticket"),
    (r"\bfactura\b|\binvoice\b", "Factura"),
]


def extract_doc_type(ex: Extraction) -> Hit | None:
    head = [ln for ln in ex.lines if ln.page == 0][:30]
    for rx, label in DOC_TYPES:
        for ln in head:
            if re.search(rx, ln.folded):
                if label in ("Factura proforma", "Presupuesto", "Albarán"):
                    ex.warnings.append(f"El documento parece un {label.lower()}, no una factura.")
                return Hit(label, 0.9 * ln.conf, ln.text)
    return None


DATE_LABELS = {
    "dueDate": re.compile(r"(?:fecha\s+(?:de\s+)?)?(?:vencimiento|vto\.?)|pagar\s+antes\s+de|fecha\s+l[ií]mite"),
    "period": re.compile(r"per[ií]odo(?:\s+de\s+(?:facturaci[oó]n|servicio))?|\bdesde\b"),
    "issueDate": re.compile(r"fecha(?:\s+de)?(?:\s+(?:factura|emisi[oó]n|expedici[oó]n|documento|operaci[oó]n))?(?!\s*(?:de\s+)?(?:vencimiento|vto|pedido|entrega|albar|servicio|nacimiento))|\bdate\b"),
}


def extract_dates(ex: Extraction) -> dict[str, Hit]:
    out: dict[str, Hit] = {}
    used: set[tuple[int, str]] = set()  # (línea, literal): la misma fecha puede aparecer en varios sitios
    for key in ("dueDate", "period", "issueDate"):
        rx = DATE_LABELS[key]
        for ln in ex.lines:
            if key in out or (key == "period" and "periodStart" in out):
                break
            m = rx.search(ln.folded)
            if not m:
                continue
            rest = ln.folded[m.end():]
            ds = find_dates(rest)
            if key == "issueDate":
                ds = [d for d in ds if (ln.index, d[1]) not in used]
            if not ds:
                below = _next_line_below(ex.lines, ln, ln.x0, ln.x1, 2.0)
                if below:
                    ds = find_dates(below.text)
                    if ds:
                        conf = 0.8 * below.conf
                        ev = f"{ln.text} | {below.text}"
                    else:
                        continue
                else:
                    continue
            else:
                conf, ev = 0.95 * ln.conf, ln.text
            if key == "period":
                if len(ds) >= 2:
                    out["periodStart"] = Hit(ds[0][0], conf, ev)
                    out["periodEnd"] = Hit(ds[1][0], conf, ev)
                    used.update({(ln.index, ds[0][1]), (ln.index, ds[1][1])})
            else:
                out[key] = Hit(ds[0][0], conf, ev)
                used.add((ln.index, ds[0][1]))
    if "issueDate" not in out:
        # Sin etiqueta: la primera fecha de la cabecera, con confianza baja para que se revise.
        for ln in ex.lines[:30]:
            ds = [d for d in find_dates(ln.text) if (ln.index, d[1]) not in used]
            if ds and ln.page == 0:
                out["issueDate"] = Hit(ds[0][0], 0.55 * ln.conf, ln.text)
                break
    return out


def extract_currency(ex: Extraction) -> Hit | None:
    for ln in ex.lines:
        t = ln.folded
        if "€" in ln.text or re.search(r"\beur(os)?\b", t):
            return Hit("EUR", 0.95, ln.text)
        if "$" in ln.text or re.search(r"\busd\b", t):
            return Hit("USD", 0.8, ln.text)
    return None


# ─────────────────────────────── Líneas de detalle ───────────────────────────────

COLS = {
    "desc": r"concepto|descripci[oó]n|detalle|art[ií]culo|servicio|producto|designaci[oó]n|denominaci[oó]n|trabajo|description",
    "qty": r"cantidad|\bcant\.?|\buds?\.?\b|unidades|\bund\.?\b|\bqty\b|horas",
    "price": r"precio|p\.\s?unit|p\.?v\.?p|\bunit|tarifa|importe\s+unit",
    "tax": r"%\s*iva|\biva\b|\btipo\b|i\.v\.a",
    "disc": r"\bdto\.?|descuento",
    "amount": r"\bimporte\b|\btotal\b|\bsubtotal\b|\bneto\b|\bvalor\b|\bamount\b",
    "date": r"\bfecha\b",
    "ref": r"\bref\.?|referencia|c[oó]digo|\bcod\.?\b",
}
_COL_RX = {k: re.compile(v, re.IGNORECASE) for k, v in COLS.items()}
STOP_ROW = re.compile(
    r"base\s+imponible|\bsubtotal\b|total\s+(?:factura|a\s+pagar|base|bruto|neto|iva)|importe\s+total|forma\s+de\s+pago|vencimiento|\biban\b|observaciones|^\s*total\b|suma\s+y\s+sigue",
    re.IGNORECASE,
)


def _header_columns(cells: list[tuple[str, float]]) -> dict[str, float] | None:
    """Detecta una cabecera de tabla: devuelve {columna: x}. Requiere 2+ columnas conocidas."""
    cols: dict[str, float] = {}
    for text, x in cells:
        f = fold(text)
        for key, rx in _COL_RX.items():
            if key not in cols and rx.search(f):
                cols[key] = x
                break
    if len(cols) >= 2 and ("desc" in cols or "amount" in cols):
        return cols
    return None


def _num(text: str) -> float | None:
    t = text.strip().replace("€", "").replace("%", "").strip()
    if not re.fullmatch(r"[-−]?[\d.,\s]+", t or "x"):
        return None
    return parse_amount(t)


def _row_from_cells(cells: list[tuple[str, float, float]], cols: dict[str, float], ctx: Context, base_conf: float) -> dict | None:
    """cells: (texto, x, confianza). Asigna cada celda a la columna de cabecera más próxima."""
    order = sorted(cols.items(), key=lambda kv: kv[1])
    bounds = []
    for i, (k, x) in enumerate(order):
        left = (order[i - 1][1] + x) / 2 if i > 0 else float("-inf")
        right = (x + order[i + 1][1]) / 2 if i + 1 < len(order) else float("inf")
        bounds.append((k, left, right))

    bucket: dict[str, list[tuple[str, float]]] = {}
    for text, x, conf in cells:
        key = next((k for k, l, r in bounds if l <= x < r), order[-1][0])
        numeric = _num(text) is not None or bool(find_percents(text))
        if key in ("qty", "price", "tax", "disc", "amount") and not numeric:
            key = "desc"  # texto en una columna numérica: pertenece al concepto
        if key == "desc" and numeric and "amount" in cols and x > cols.get("desc", 0):
            pass
        bucket.setdefault(key, []).append((text, conf))

    def num_of(key: str) -> float | None:
        vals = [_num(t) for t, _ in bucket.get(key, [])]
        vals = [v for v in vals if v is not None]
        return vals[-1] if vals else None

    desc = " ".join(t for t, _ in bucket.get("desc", []) + bucket.get("ref", [])).strip() or None
    amount = num_of("amount")
    if amount is None and "amount" not in cols:
        nums = [(_num(t), x) for t, x, _ in cells if _num(t) is not None]
        amount = max(nums, key=lambda n: n[1])[0] if nums else None
    tax_rate = None
    for t, _ in bucket.get("tax", []):
        p = find_percents(t) or ([_num(t)] if _num(t) is not None else [])
        if p and p[0] is not None and 0 <= p[0] <= 30:
            tax_rate = p[0]
    serv_date = None
    for t, _ in bucket.get("date", []):
        d = find_dates(t)
        if d:
            serv_date = d[0][0]
    if desc is None and amount is None:
        return None
    confs = [c for _, _, c in cells] or [base_conf]
    joined = " ".join(t for t, _, _ in cells)
    plates = find_plates(joined, ctx.known_plates)
    lic = _find_license(joined, ctx)
    return {
        "description": desc,
        "quantity": num_of("qty"),
        "unitPrice": num_of("price"),
        "taxRate": tax_rate,
        "taxAmount": None,
        "amount": amount,
        "serviceDate": serv_date,
        "plate": plates[0] if plates else None,
        "license": lic,
        "driverName": _find_driver(joined, ctx),
        "confidence": round(base_conf * mean(confs), 3),
    }


def extract_lines_from_tables(tables: list[Table], ctx: Context) -> list[dict]:
    out: list[dict] = []
    for tb in tables:
        cols = None
        for r_i, row in enumerate(tb.rows):
            cells = [(c, float(i), tb.conf) for i, c in enumerate(row)]
            if cols is None:
                cols = _header_columns([(c, float(i)) for i, c in enumerate(row)])
                continue
            if STOP_ROW.search(fold(" ".join(row))):
                break
            r = _row_from_cells([c for c in cells if c[0].strip()], cols, ctx, 0.9)
            if r:
                out.append(r)
    return [r for r in out if r["amount"] is not None or r["description"]]


def extract_lines_from_layout(ex: Extraction) -> tuple[list[dict], bool]:
    """Reconstruye la tabla de conceptos por la posición del texto. Devuelve (líneas, con_cabecera)."""
    lines = ex.lines
    rows: list[dict] = []
    header_found = False
    i = 0
    while i < len(lines):
        ln = lines[i]
        cols = None
        if not find_amounts(ln.text):
            cols = _header_columns([(t.text, t.cx) for t in ln.tokens])
            # Cabecera partida en dos fragmentos de texto: se prueba por palabras.
            if cols is None and len(ln.tokens) <= 2:
                words = []
                for t in ln.tokens:
                    ws = t.text.split()
                    step = (t.x1 - t.x0) / max(1, len(t.text))
                    pos = 0
                    for w in ws:
                        idx = t.text.find(w, pos)
                        words.append((w, t.x0 + step * (idx + len(w) / 2)))
                        pos = idx + len(w)
                cols = _header_columns(words) if len(words) >= 3 else None
        if not cols:
            i += 1
            continue
        header_found = True
        j = i + 1
        while j < len(lines) and lines[j].page == ln.page:
            row = lines[j]
            if STOP_ROW.search(row.folded) or _header_columns([(t.text, t.cx) for t in row.tokens]):
                break
            cells = [(t.text, t.cx, t.conf) for t in row.tokens]
            r = _row_from_cells(cells, cols, ex.ctx, 0.95)
            if r:
                has_numbers = any(_num(t.text) is not None for t in row.tokens)
                if not has_numbers and rows and rows[-1]["description"] and r["amount"] is None:
                    rows[-1]["description"] = f"{rows[-1]['description']} {r['description']}".strip()
                elif r["amount"] is not None or has_numbers:
                    rows.append(r)
            j += 1
        i = j
    if header_found:
        return rows, True

    # Sin cabecera (tickets): líneas con texto a la izquierda e importe a la derecha, antes de los totales.
    stop = next((ln.index for ln in lines if STOP_ROW.search(ln.folded) or re.match(r"^\s*total\b", ln.folded)), len(lines))
    width = max((ln.x1 for ln in lines), default=1.0)
    for ln in lines[:stop]:
        if _label_segments(ln) or not ln.tokens:
            continue
        last = ln.tokens[-1]
        amt = _num(last.text)
        text_part = " ".join(t.text for t in ln.tokens[:-1]).strip()
        if amt is None or last.x1 < 0.6 * width or not re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}", text_part):
            continue
        if find_dates(ln.text) or find_tax_ids(ln.text):
            continue
        qty = price = None
        m = re.match(r"^\s*(\d+(?:[.,]\d+)?)\s*(?:x|uds?\.?|\*)\s+(.*)$", text_part, re.IGNORECASE)
        if m:
            qty = parse_amount(m.group(1)) if ("," in m.group(1) or "." in m.group(1)) else float(m.group(1))
            text_part = m.group(2)
        mids = [_num(t.text) for t in ln.tokens[1:-1] if _num(t.text) is not None]
        if mids:
            price = mids[-1]
            text_part = " ".join(t.text for t in ln.tokens[:-1] if _num(t.text) is None).strip()
        rows.append({
            "description": text_part or None,
            "quantity": qty,
            "unitPrice": price,
            "taxRate": None,
            "taxAmount": None,
            "amount": amt,
            "serviceDate": None,
            "plate": (find_plates(ln.text, ex.ctx.known_plates) or [None])[0],
            "license": _find_license(ln.text, ex.ctx),
            "driverName": _find_driver(ln.text, ex.ctx),
            "confidence": round(0.6 * ln.conf, 3),
        })
    return rows, False


# ─────────────────────────────── Licencias y conductores ───────────────────────────────

LICENSE_RX = re.compile(r"\blic(?:encia)?\.?\s*(?:n[º°o]\.?|num(?:ero)?\.?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{0,11})", re.IGNORECASE)
DRIVER_RX = re.compile(r"\b(?:conductor|ch[oó]fer|taxista|asalariado)\s*[:\-]\s*([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.\- ]{2,50})", re.IGNORECASE)


def _find_license(text: str, ctx: Context) -> str | None:
    f = fold(text)
    for k in ctx.known_licenses:
        kf = fold(k)
        if kf and re.search(rf"(?<![a-z0-9]){re.escape(kf)}(?![a-z0-9])", f):
            return k
    m = LICENSE_RX.search(text)
    if m and re.search(r"\d", m.group(1)):
        return m.group(1).upper()
    return None


def _find_driver(text: str, ctx: Context) -> str | None:
    f = fold(text)
    for name in ctx.known_drivers:
        nf = fold(name)
        if nf and len(nf) > 4 and nf in f:
            return name
    m = DRIVER_RX.search(text)
    if m:
        return re.split(r"\s{2,}|\s+(?:matr|lic|dni|nif)", m.group(1).strip(), flags=re.IGNORECASE)[0].strip()
    return None


# ─────────────────────────────── Orquestación ───────────────────────────────


def extract(doc: OcrDocument, ctx: Context) -> dict:
    lines = build_lines(doc)
    ex = Extraction(lines=lines, ctx=ctx)
    all_text = "\n".join(ln.text for ln in lines)

    readable = len(doc.tokens) >= 5 and (bool(find_amounts(all_text)) or bool(find_dates(all_text)))
    if not readable:
        ex.warnings.append("Apenas se ha reconocido texto. Repite la foto con más luz, enfocada y sin recortes.")

    avg_conf = mean(t.conf for t in doc.tokens) if doc.tokens else 0.0
    if doc.tokens and avg_conf < 0.8:
        ex.warnings.append(f"Calidad de lectura baja ({round(avg_conf * 100)} %): revisa todos los campos con el original.")

    totals = extract_totals(ex)
    breakdown = extract_tax_breakdown(ex)
    if "subtotal" not in totals and len(breakdown) == 1:
        b = breakdown[0]
        totals["subtotal"] = Hit(b["base"], 0.8 * b["_conf"], b["_ev"])
    if "tax" not in totals and len(breakdown) == 1:
        b = breakdown[0]
        totals["tax"] = Hit(b["amount"], 0.8 * b["_conf"], b["_ev"])

    # «IVA 21%  41,27» con la base en otra línea: se acepta el desglose sólo si base × tipo = cuota impresa.
    if not breakdown and "subtotal" in totals and "tax" in totals:
        sub_h, tax_h = totals["subtotal"], totals["tax"]
        pcts = find_percents(tax_h.evidence)
        if len(pcts) == 1 and abs(round(sub_h.value * pcts[0] / 100, 2) - tax_h.value) <= 0.02:
            breakdown = [{"rate": pcts[0], "base": sub_h.value, "amount": tax_h.value, "_ev": tax_h.evidence, "_conf": tax_h.conf}]

    parties = extract_parties(ex)
    number = extract_number(ex)
    doc_type = extract_doc_type(ex)
    dates = extract_dates(ex)
    currency = extract_currency(ex)

    table_rows = extract_lines_from_tables(doc.tables, ctx) if doc.tables else []
    layout_rows, with_header = extract_lines_from_layout(ex)
    if table_rows and sum(r["amount"] is not None for r in table_rows) >= sum(r["amount"] is not None for r in layout_rows):
        rows = table_rows
    else:
        rows = layout_rows
        if rows and not with_header:
            ex.warnings.append("No se ha encontrado la cabecera de la tabla de conceptos; las líneas se han deducido por su posición. Revísalas.")
    if not rows:
        ex.warnings.append("No se han reconocido líneas de detalle. Añádelas a mano si la factura las tiene.")

    # Incoherencias impresas: se avisa, no se corrige.
    sub, tax, wh, tot = (totals.get(k) for k in ("subtotal", "tax", "withholding", "total"))
    if sub and tax and tot:
        calc = round(sub.value + tax.value - (wh.value if wh else 0), 2)
        if abs(calc - tot.value) > 0.02:
            ex.warnings.append(f"Los importes leídos no cuadran: base + impuestos{' − retención' if wh else ''} = {calc:.2f}, total leído {tot.value:.2f}.")

    def h(hit: Hit | None) -> dict:
        return F(hit.value, hit.conf, hit.evidence) if hit else F()

    text_all = "\n".join(ln.text for ln in lines)
    plates = find_plates(text_all, ctx.known_plates)
    licenses = list(dict.fromkeys([l for l in (_find_license(ln.text, ctx) for ln in lines) if l]))
    drivers = list(dict.fromkeys([d for d in (_find_driver(ln.text, ctx) for ln in lines) if d]))

    return {
        "readable": readable,
        "documentType": h(doc_type),
        "issuer": {"name": h(parties["issuerName"]), "taxId": h(parties["issuerTax"])},
        "recipient": {"name": h(parties["recipientName"]), "taxId": h(parties["recipientTax"])},
        "invoiceNumber": h(number),
        "issueDate": h(dates.get("issueDate")),
        "dueDate": h(dates.get("dueDate")),
        "periodStart": h(dates.get("periodStart")),
        "periodEnd": h(dates.get("periodEnd")),
        "currency": h(currency),
        "subtotal": h(sub),
        "taxTotal": h(tax),
        "withholding": h(wh),
        "total": h(tot),
        "taxBreakdown": [{"rate": b["rate"], "base": b["base"], "amount": b["amount"]} for b in breakdown],
        "lines": rows,
        "identifiers": {"plates": [normalize_plate(p) for p in plates], "licenses": licenses, "driverNames": drivers},
        "pageCount": len(doc.pages),
        "warnings": list(dict.fromkeys(ex.warnings)),
    }
