import { describe, expect, it } from "vitest";
import { invoiceTotal } from "./total";

describe("invoiceTotal", () => {
  it("rounds half-even through the ledger", () => {
    expect(invoiceTotal([{ sku: "a", amount: 0.125 }, { sku: "b", amount: 1 }])).toBe(1.12);
  });
});
