"""Estructuras comunes entre el motor OCR y el extractor.

El extractor sólo conoce `OcrDocument`; cualquier motor OCR (PaddleOCR, Tesseract,
un servicio interno…) que produzca este formato sirve sin cambiar las reglas.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Token:
    """Fragmento de texto reconocido con su caja (x0, y0, x1, y1) en píxeles de su página."""

    text: str
    conf: float
    x0: float
    y0: float
    x1: float
    y1: float
    page: int = 0
    angle: float = 0.0  # inclinación de la línea de texto (radianes), si el motor la da
    th: float = 0.0  # altura real del texto (sin el efecto de la inclinación), si el motor la da
    shift: float = 0.0  # corrección vertical por inclinación de la página (la calcula el extractor)

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2 - self.shift

    @property
    def h(self) -> float:
        return max(1.0, self.th or (self.y1 - self.y0))


@dataclass
class Table:
    """Tabla detectada por un motor de estructura (p. ej. PP-StructureV3): filas de celdas de texto."""

    page: int
    rows: list[list[str]]
    conf: float = 0.85


@dataclass
class Page:
    index: int
    width: float
    height: float
    tokens: list[Token] = field(default_factory=list)


@dataclass
class OcrDocument:
    pages: list[Page]
    tables: list[Table] = field(default_factory=list)
    engine: str = ""

    @property
    def tokens(self) -> list[Token]:
        return [t for p in self.pages for t in p.tokens]


@dataclass
class Context:
    """Contexto local que ayuda a reconocer identificadores. Nunca sale del equipo."""

    owner_name: str | None = None
    owner_tax_id: str | None = None
    known_plates: list[str] = field(default_factory=list)
    known_licenses: list[str] = field(default_factory=list)
    known_drivers: list[str] = field(default_factory=list)
    extra_instructions: str | None = None  # sólo las usa el intérprete visual opcional (Qwen)
