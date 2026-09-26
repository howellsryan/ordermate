import { describe, expect, it } from "vitest";
import { parseCatalogueCsv } from "../src/client/catalogue-import-csv";

describe("catalogue CSV parsing", () => {
  it("rejects option headers that normalize to the same dimension name", () => {
    const csv = [
      "product_name,variant_name,sku,option:Size,option: Size",
      "Classic Tee,Small,TEE-S,Small,Small",
    ].join("\n");

    const parsed = parseCatalogueCsv(csv);

    expect(parsed.errors).toContainEqual(expect.objectContaining({ code: "option_header_duplicate" }));
  });

  it("keeps distinct arbitrary option dimensions", () => {
    const csv = [
      "product_name,variant_name,sku,option:Size,option:Colour",
      "Classic Tee,Small Navy,TEE-S-NV,Small,Navy",
    ].join("\n");

    const parsed = parseCatalogueCsv(csv);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].options).toEqual({ Size: "Small", Colour: "Navy" });
  });
});
