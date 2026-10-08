import { describe, expect, it } from "vitest";
import { invoiceTotal, invoiceTotalWithVat } from "./total";

describe("invoiceTotal", () => {
  it("rounds half-even through the ledger", () => {
    expect(invoiceTotal([{ sku: "a", amount: 0.125 }, { sku: "b", amount: 1 }])).toBe(1.12);
  });
});

describe("invoiceTotalWithVat", () => {
  it("applies VAT before ledger rounding", () => {
    expect(invoiceTotalWithVat([{ sku: "a", amount: 10 }], 0.21)).toBe(12.1);
  });
});
