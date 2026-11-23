"""Pruebas de las reglas sin OCR: se construyen fragmentos de texto con posición como los daría PaddleOCR."""
import math

from engine.extractor import extract
from engine.model import Context, OcrDocument, Page, Token
from engine.parsing import find_dates, parse_amount, tax_id_valid


def doc_from(rows, angle=0.0, width=1600):
    """rows: lista de listas de (x, texto). Cada fila va 60 px por debajo de la anterior."""
    toks = []
    for i, row in enumerate(rows):
        y = 100 + i * 60
        for x, text in row:
            w = 18 * len(text)
            dy = x * math.tan(angle)
            toks.append(Token(text=text, conf=0.98, x0=x, y0=y + dy, x1=x + w, y1=y + 32 + dy, angle=angle, th=32))
    return OcrDocument(pages=[Page(index=0, width=width, height=2200, tokens=toks)])


CTX = Context(owner_name="Antonio Pérez García", owner_tax_id="12345678Z", known_plates=["1234KLM"], known_licenses=["04567"])


def test_parse_amount_formats():
    assert parse_amount("1.234,56") == 1234.56
    assert parse_amount("1,234.56") == 1234.56
    assert parse_amount("45,00 €") == 45.0
    assert parse_amount("-12,50") == -12.5


def test_dates():
    assert find_dates("Fecha: 14/03/2026")[0][0] == "2026-03-14"
    assert find_dates("10 de marzo de 2026")[0][0] == "2026-03-10"


def test_tax_ids():
    assert tax_id_valid("12345678Z")
    assert not tax_id_valid("12345678A")


INVOICE = [
    [(100, "TALLERES EJEMPLO S.L."), (1100, "FACTURA")],
    [(100, "CIF: B12345674"), (1100, "Nº Factura: F-2026/0417")],
    [(1100, "Fecha: 14/03/2026")],
    [(100, "Cliente:")],
    [(100, "Antonio Pérez García"), (1000, "Matrícula: 1234 KLM")],
    [(100, "NIF: 12345678Z")],
    [(100, "Descripción"), (900, "Cant."), (1100, "Precio"), (1400, "Importe")],
    [(100, "Cambio de aceite"), (910, "1"), (1100, "45,00"), (1400, "45,00")],
    [(100, "Pastillas de freno"), (910, "2"), (1100, "38,00"), (1400, "76,00")],
    [(1000, "Base imponible"), (1400, "121,00 €")],
    [(1000, "IVA 21%"), (1400, "25,41 €")],
    [(1000, "TOTAL"), (1400, "146,41 €")],
]


def test_full_invoice():
    r = extract(doc_from(INVOICE), CTX)
    v = lambda f: f["value"]
    assert v(r["invoiceNumber"]) == "F-2026/0417"
    assert v(r["issueDate"]) == "2026-03-14"
    assert v(r["issuer"]["name"]) == "TALLERES EJEMPLO S.L."
    assert v(r["issuer"]["taxId"]) == "B12345674"
    assert v(r["recipient"]["taxId"]) == "12345678Z"
    assert v(r["recipient"]["name"]) == "Antonio Pérez García"
    assert (v(r["subtotal"]), v(r["taxTotal"]), v(r["total"])) == (121.0, 25.41, 146.41)
    assert r["taxBreakdown"] == [{"rate": 21.0, "base": 121.0, "amount": 25.41}]
    assert [(l["description"], l["quantity"], l["amount"]) for l in r["lines"]] == [
        ("Cambio de aceite", 1.0, 45.0),
        ("Pastillas de freno", 2.0, 76.0),
    ]
    assert r["identifiers"]["plates"] == ["1234KLM"]
    assert not any("no cuadran" in w for w in r["warnings"])


def test_rotated_photo_keeps_rows():
    r = extract(doc_from(INVOICE, angle=math.radians(-3)), CTX)
    assert r["total"]["value"] == 146.41
    assert r["subtotal"]["value"] == 121.0
    assert len(r["lines"]) == 2


def test_inconsistent_totals_warn_but_not_corrected():
    rows = [row[:] for row in INVOICE]
    rows[-1] = [(1000, "TOTAL"), (1400, "150,00 €")]
    r = extract(doc_from(rows), CTX)
    assert r["total"]["value"] == 150.0  # se respeta lo impreso
    assert any("no cuadran" in w for w in r["warnings"])


def test_missing_data_is_null_not_invented():
    r = extract(doc_from([[(100, "Gracias por su visita")], [(100, "Vuelva pronto")], [(100, "Tienda")], [(100, "Madrid")], [(100, "Abierto")]]), CTX)
    assert r["total"]["value"] is None
    assert r["issueDate"]["value"] is None
    assert r["readable"] is False
    assert r["lines"] == []
