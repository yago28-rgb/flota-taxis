import { describe, expect, it } from "vitest";
import { suggestField } from "@/lib/export/fields";

describe("suggestField", () => {
  it.each([
    ["Fecha", "date"],
    ["IMPORTE", "amount"],
    ["Matrícula", "plate"],
    ["matricula", "plate"],
    ["Nº Licencia", "license"],
    ["Concepto", "category"],
    ["Proveedor", "counterparty"],
  ])("«%s» → %s", (h, k) => expect(suggestField("movements", h)).toBe(k));

  it("no inventa equivalencias", () => {
    expect(suggestField("movements", "Columna rara XYZ")).toBeNull();
    expect(suggestField("movements", "")).toBeNull();
  });
});
