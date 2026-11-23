"""Genera facturas SINTÉTICAS de ejemplo (no son facturas reales) para probar el motor de punta a punta.

    python samples/make_samples.py   → samples/out/taller.png, samples/out/gasolinera_foto.jpg, samples/out/seguro_2p.pdf
"""
from __future__ import annotations

import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)
FONT_DIR = os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts")


def font(size, bold=False):
    for name in (("arialbd.ttf" if bold else "arial.ttf"), "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(os.path.join(FONT_DIR, name), size)
        except OSError:
            continue
    return ImageFont.load_default()


def page(w=1654, h=2339):
    img = Image.new("RGB", (w, h), "white")
    return img, ImageDraw.Draw(img)


def right(d, x, y, text, f):
    d.text((x - d.textlength(text, font=f), y), text, fill="black", font=f)


def taller():
    img, d = page()
    d.text((120, 110), "TALLERES MECÁNICOS CARABANCHEL S.L.", font=font(46, True), fill="black")
    d.text((120, 175), "C/ General Ricardos 120, 28019 Madrid", font=font(30), fill="black")
    d.text((120, 215), "CIF: B12345674", font=font(30), fill="black")
    d.text((1100, 110), "FACTURA", font=font(52, True), fill="black")
    d.text((1100, 190), "Nº Factura: F-2026/0417", font=font(30), fill="black")
    d.text((1100, 230), "Fecha: 14/03/2026", font=font(30), fill="black")
    d.rectangle((110, 320, 900, 500), outline="black", width=2)
    d.text((130, 335), "Cliente:", font=font(30, True), fill="black")
    d.text((130, 380), "Antonio Pérez García", font=font(30), fill="black")
    d.text((130, 420), "NIF: 12345678Z", font=font(30), fill="black")
    d.text((1000, 360), "Matrícula: 1234 KLM", font=font(30), fill="black")
    d.text((1000, 400), "Licencia: 04567", font=font(30), fill="black")
    y = 580
    f, fb = font(30), font(30, True)
    d.line((110, y - 10, 1540, y - 10), fill="black", width=2)
    d.text((130, y), "Descripción", font=fb, fill="black")
    d.text((900, y), "Cant.", font=fb, fill="black")
    right(d, 1200, y, "Precio", fb)
    right(d, 1520, y, "Importe", fb)
    d.line((110, y + 50, 1540, y + 50), fill="black", width=2)
    rows = [
        ("Cambio de aceite 5W30", "1", "45,00", "45,00"),
        ("Filtro de aceite", "1", "12,50", "12,50"),
        ("Pastillas de freno delanteras", "2", "38,00", "76,00"),
        ("Mano de obra (horas)", "1,5", "42,00", "63,00"),
    ]
    y += 80
    for desc, q, p, a in rows:
        d.text((130, y), desc, font=f, fill="black")
        d.text((910, y), q, font=f, fill="black")
        right(d, 1200, y, p, f)
        right(d, 1520, y, a, f)
        y += 60
    y += 60
    for label, val in (("Base imponible", "196,50 €"), ("IVA 21%", "41,27 €"), ("TOTAL", "237,77 €")):
        bold = label == "TOTAL"
        d.text((1000, y), label, font=font(34 if bold else 30, bold), fill="black")
        right(d, 1520, y, val, font(34 if bold else 30, bold))
        y += 60
    d.text((120, 2150), "Forma de pago: tarjeta. Gracias por su confianza.", font=font(26), fill="black")
    img.save(os.path.join(OUT, "taller.png"))


def gasolinera():
    """Ticket estrecho, fotografiado: girado, con ruido y desenfoque."""
    img = Image.new("RGB", (720, 1300), (250, 248, 240))
    d = ImageDraw.Draw(img)
    f, fb = font(28), font(30, True)
    lines = [
        ("ESTACIÓN DE SERVICIO M-30 S.A.", fb), ("CIF A28000008", f), ("Av. de la Paz 5 Madrid", f), ("", f),
        ("FACTURA SIMPLIFICADA", fb), ("Nº: T-889120", f), ("Fecha: 02/04/2026 08:41", f), ("", f),
    ]
    y = 40
    for t, ff in lines:
        d.text((40, y), t, font=ff, fill="black")
        y += 44
    d.text((40, y), "Diesel e+  42,10 L", font=f, fill="black"); right(d, 680, y, "63,57", f); y += 44
    d.text((40, y), "Lavado exterior", font=f, fill="black"); right(d, 680, y, "6,00", f); y += 70
    for t, v in (("Base", "57,50"), ("IVA 21%", "12,07"), ("TOTAL EUR", "69,57")):
        d.text((40, y), t, font=fb if t.startswith("TOTAL") else f, fill="black"); right(d, 680, y, v, fb if t.startswith("TOTAL") else f); y += 48
    y += 30
    d.text((40, y), "Matrícula: 5678 HJK", font=f, fill="black")
    canvas = Image.new("RGB", (1100, 1600), (90, 80, 70))
    canvas.paste(img, (190, 150))
    canvas = canvas.rotate(-4, resample=Image.BICUBIC, fillcolor=(90, 80, 70)).filter(ImageFilter.GaussianBlur(1.1))
    rnd = random.Random(7)
    px = canvas.load()
    for _ in range(60000):
        x, yy = rnd.randrange(canvas.width), rnd.randrange(canvas.height)
        r, g, b = px[x, yy]
        n = rnd.randint(-25, 25)
        px[x, yy] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    canvas.save(os.path.join(OUT, "gasolinera_foto.jpg"), quality=82)


def seguro():
    p1, d = page()
    d.text((120, 110), "MUTUA DEL TAXI SEGUROS S.A.", font=font(46, True), fill="black")
    d.text((120, 175), "CIF: A08000002", font=font(30), fill="black")
    d.text((1100, 110), "FACTURA", font=font(52, True), fill="black")
    d.text((1100, 190), "Número: SG-26-00931", font=font(30), fill="black")
    d.text((1100, 230), "Fecha de emisión: 01/02/2026", font=font(30), fill="black")
    d.text((1100, 270), "Vencimiento: 01/03/2026", font=font(30), fill="black")
    d.text((120, 340), "Tomador: Antonio Pérez García  NIF 12345678Z", font=font(30), fill="black")
    d.text((120, 390), "Periodo: del 01/02/2026 al 31/01/2027", font=font(30), fill="black")
    d.text((120, 440), "Vehículo matrícula 9012 BCD - Licencia 01234", font=font(30), fill="black")
    d.text((120, 600), "Condiciones particulares en la página siguiente.", font=font(28), fill="black")
    p2, d2 = page()
    fb, f = font(30, True), font(30)
    y = 200
    d2.text((130, y), "Concepto", font=fb, fill="black"); right(d2, 1520, y, "Importe", fb); y += 70
    for desc, a in (("Prima neta seguro flota taxi", "1.180,00"), ("Recargo Consorcio", "45,20")):
        d2.text((130, y), desc, font=f, fill="black"); right(d2, 1520, y, a, f); y += 60
    y += 60
    for label, val in (("Base imponible", "1.225,20"), ("Impuesto primas 8%", "98,02"), ("Total a pagar", "1.323,22 €")):
        d2.text((1000, y), label, font=fb if label.startswith("Total") else f, fill="black"); right(d2, 1520, y, val, fb if label.startswith("Total") else f); y += 60
    p1.save(os.path.join(OUT, "seguro_2p.pdf"), save_all=True, append_images=[p2], resolution=200)


if __name__ == "__main__":
    taller(); gasolinera(); seguro()
    print("ok", os.listdir(OUT))
