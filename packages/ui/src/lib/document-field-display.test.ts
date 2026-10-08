import { expect, it } from "vitest";
import { displayDocumentField } from "./document-field-display";

it("masks identifier suggestions without changing non-sensitive tax fields", () => {
  expect(
    displayDocumentField({ key: "business_ein", label: "Business EIN", value: "00-0000001" }),
  ).toBe("•••• 0001");
  expect(
    displayDocumentField({
      key: "identifier",
      label: "Tax identification number",
      value: "00-0000002",
    }),
  ).toBe("•••• 0002");
  expect(displayDocumentField({ key: "tax_year", label: "Tax year", value: "2025" })).toBe("2025");
  expect(displayDocumentField({ key: "revenue", label: "Net sales", value: "125000.00" })).toBe(
    "125000.00",
  );
});
