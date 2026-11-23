import { describe, expect, it } from "vitest";
import { normalizeLicense, normalizePlate, normalizeTaxId, parseMoneyToCents, centsToInput, isValidIsoDate, percentChange } from "@/lib/format";

describe("parseMoneyToCents", () => {
  it.each([
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["1234,5", 123450],
    ["12", 1200],
    ["-45,10 €", -4510],
    ["(45,10)", -4510],
    ["1.000.000", 100000000],
    [12.345, 1235],
  ])("%s → %d", (input, out) => expect(parseMoneyToCents(input)).toBe(out));

  it("devuelve null para valores vacíos o no numéricos", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("12,3,4x")).toBeNull();
  });

  it("es inverso de centsToInput", () => {
    for (const c of [0, 1, 99, 123456, -4510]) expect(parseMoneyToCents(centsToInput(c))).toBe(c);
  });
});

describe("normalización", () => {
  it("matrículas", () => expect(normalizePlate(" 1234-bcd ")).toBe("1234BCD"));
  it("NIF sin prefijo ES", () => expect(normalizeTaxId("es b-12345678")).toBe("B12345678"));
  it("licencia en mayúsculas", () => expect(normalizeLicense(" abc 12 ")).toMatch(/^ABC ?12$/));
});

describe("fechas y variaciones", () => {
  it("valida fechas ISO reales", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("28/02/2026")).toBe(false);
  });
  it("percentChange no inventa variación sin base", () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(100, 0)).toBeNull();
  });
});
