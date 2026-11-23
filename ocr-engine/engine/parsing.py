"""Reconocimiento de valores sueltos: importes, fechas, NIF/CIF, matrículas.

Funciones puras. Devuelven None cuando el texto no es inequívoco: nunca completan
ni adivinan cifras o fechas.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date

# ─────────────────────────────── Texto ───────────────────────────────


def fold(s: str) -> str:
    """Minúsculas sin acentos, para comparar etiquetas."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


# ─────────────────────────────── Importes ───────────────────────────────

# 1.234,56 · 1234,56 · 1 234,56 · 1,234.56 · 1234.56 · -12,00 · 12,00- · (12,00)
AMOUNT_RE = re.compile(
    r"(?<![\w/.,-])"
    r"(?P<neg>[-−–]\s?)?\(?"
    r"(?P<num>\d{1,3}(?:[.  ]\d{3})+(?:[.,]\d{1,2})|\d{1,3}(?:,\d{3})+\.\d{1,2}|\d+[.,]\d{2}|\d+[.,]\d(?!\d))"
    r"\)?(?P<negpost>-)?"
    r"\s?(?P<cur>€|eur\b|euros?\b)?"
    r"(?![\w%/]|[.,]\d)",
    re.IGNORECASE,
)
PERCENT_RE = re.compile(r"(\d{1,2}(?:[.,]\d{1,2})?)\s?%")


def parse_amount(raw: str) -> float | None:
    """Convierte un importe escrito en formato español o inglés a float. None si es ambiguo."""
    s = raw.strip().replace(" ", " ").replace("€", "").strip()
    neg = s.startswith(("-", "−", "–")) or s.endswith("-") or (s.startswith("(") and s.endswith(")"))
    s = re.sub(r"[()\-−–\s]", "", s)
    if not s or not re.fullmatch(r"[\d.,]+", s):
        return None
    last_c, last_d = s.rfind(","), s.rfind(".")
    if last_c > last_d:  # 1.234,56
        s = s.replace(".", "").replace(",", ".")
    elif last_d > last_c and last_c != -1:  # 1,234.56
        s = s.replace(",", "")
    elif last_c == -1 and s.count(".") > 1:  # 1.234.567
        s = s.replace(".", "")
    elif last_d == -1 and s.count(",") > 1:
        s = s.replace(",", "")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def find_amounts(text: str) -> list[tuple[float, str, int]]:
    """Importes de una línea: (valor, texto literal, posición). Excluye porcentajes, fechas y años."""
    out: list[tuple[float, str, int]] = []
    for m in AMOUNT_RE.finditer(text):
        tail = text[m.end(): m.end() + 2]
        if "%" in tail:
            continue
        lit = m.group(0).strip()
        num = m.group("num")
        # Una fecha tipo 10.03.2026 o 10,03 seguida de /2026 no es un importe.
        if re.fullmatch(r"\d{1,2}[.,]\d{2}", num) and re.match(r"[./-]\d{2,4}", text[m.end():]):
            continue
        v = parse_amount(("-" if (m.group("neg") or m.group("negpost")) else "") + num)
        if v is not None:
            out.append((v, lit, m.start()))
    return out


def find_percents(text: str) -> list[float]:
    vals = []
    for m in PERCENT_RE.finditer(text):
        try:
            vals.append(float(m.group(1).replace(",", ".")))
        except ValueError:
            pass
    return vals


# ─────────────────────────────── Fechas ───────────────────────────────

MONTHS = {
    "enero": 1, "ene": 1, "febrero": 2, "feb": 2, "marzo": 3, "mar": 3, "abril": 4, "abr": 4,
    "mayo": 5, "may": 5, "junio": 6, "jun": 6, "julio": 7, "jul": 7, "agosto": 8, "ago": 8,
    "septiembre": 9, "setiembre": 9, "sep": 9, "sept": 9, "set": 9, "octubre": 10, "oct": 10,
    "noviembre": 11, "nov": 11, "diciembre": 12, "dic": 12,
}
DATE_NUM_RE = re.compile(r"(?<!\d)(\d{1,2})\s?[/\-.]\s?(\d{1,2})\s?[/\-.]\s?(\d{4}|\d{2})(?!\d)")
DATE_ISO_RE = re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")
DATE_TXT_RE = re.compile(r"(?<!\d)(\d{1,2})\s*(?:de\s+)?([a-záéíóú]{3,10})\.?\s*(?:de\s+|del\s+)?(\d{4})(?!\d)", re.IGNORECASE)


def _mk(y: int, m: int, d: int) -> str | None:
    try:
        dt = date(y, m, d)
    except ValueError:
        return None
    if not (1990 <= dt.year <= 2100):
        return None
    return dt.isoformat()


def find_dates(text: str) -> list[tuple[str, str, int]]:
    """Fechas inequívocas de una línea en formato español (día/mes/año): (ISO, literal, posición)."""
    out: list[tuple[str, str, int]] = []
    for m in DATE_ISO_RE.finditer(text):
        iso = _mk(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if iso:
            out.append((iso, m.group(0), m.start()))
    for m in DATE_NUM_RE.finditer(text):
        d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
        year = int(y) if len(y) == 4 else 2000 + int(y)
        iso = _mk(year, mo, d)
        if iso and not any(abs(p - m.start()) < 3 for _, _, p in out):
            out.append((iso, m.group(0), m.start()))
    for m in DATE_TXT_RE.finditer(text):
        mon = MONTHS.get(fold(m.group(2)).rstrip("."))
        if mon:
            iso = _mk(int(m.group(3)), mon, int(m.group(1)))
            if iso:
                out.append((iso, m.group(0), m.start()))
    return sorted(out, key=lambda x: x[2])


# ─────────────────────────────── NIF / CIF / NIE ───────────────────────────────

_NIF_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"
TAXID_RE = re.compile(
    r"(?<![A-Z0-9])(?:ES[\s-]?)?([ABCDEFGHJKLMNPQRSUVW][\s.-]?\d{2}[\s.]?\d{3}[\s.]?\d{2}[\s.-]?[0-9A-J]|\d{2}[\s.]?\d{3}[\s.]?\d{3}[\s.-]?[A-Z]|[XYZ][\s.-]?\d{7}[\s.-]?[A-Z])(?![A-Z0-9])",
    re.IGNORECASE,
)


def clean_tax_id(raw: str) -> str:
    s = re.sub(r"[\s.\-]", "", raw.upper())
    return s[2:] if s.startswith("ES") and len(s) > 9 else s


def tax_id_valid(s: str) -> bool:
    """Comprueba el dígito/letra de control de NIF, NIE y CIF."""
    s = clean_tax_id(s)
    if re.fullmatch(r"\d{8}[A-Z]", s):
        return _NIF_LETTERS[int(s[:8]) % 23] == s[8]
    if re.fullmatch(r"[XYZ]\d{7}[A-Z]", s):
        n = int("XYZ".index(s[0]).__str__() + s[1:8])
        return _NIF_LETTERS[n % 23] == s[8]
    if re.fullmatch(r"[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]", s):
        digits = s[1:8]
        even = sum(int(digits[i]) for i in (1, 3, 5))
        odd = sum(sum(divmod(int(digits[i]) * 2, 10)) for i in (0, 2, 4, 6))
        ctrl = (10 - (even + odd) % 10) % 10
        return s[8] in (str(ctrl), "JABCDEFGHI"[ctrl])
    return False


def find_tax_ids(text: str) -> list[tuple[str, str, int]]:
    out = []
    for m in TAXID_RE.finditer(text.upper()):
        v = clean_tax_id(m.group(1))
        if len(v) == 9:
            out.append((v, m.group(0).strip(), m.start()))
    return out


# ─────────────────────────────── Matrículas ───────────────────────────────

PLATE_RE = re.compile(r"(?<![A-Z0-9])(\d{4})[\s-]?([BCDFGHJKLMNPRSTVWXYZ]{3})(?![A-Z0-9])", re.IGNORECASE)
OLD_PLATE_RE = re.compile(r"(?<![A-Z0-9])(M|MA|B|V|SE|TO|GU|CU|AV|SG)[\s-](\d{4})[\s-]([A-Z]{1,2})(?![A-Z0-9])")


def normalize_plate(s: str) -> str:
    return re.sub(r"[\s-]", "", s.upper())


def find_plates(text: str, known: list[str]) -> list[str]:
    found: list[str] = []
    up = text.upper()
    for m in PLATE_RE.finditer(up):
        found.append(m.group(1) + m.group(2))
    for m in OLD_PLATE_RE.finditer(up):
        found.append(m.group(1) + m.group(2) + m.group(3))
    compact = re.sub(r"[\s-]", "", up)
    for k in known:
        nk = normalize_plate(k)
        if nk and nk in compact and nk not in found:
            found.append(nk)
    return list(dict.fromkeys(found))
