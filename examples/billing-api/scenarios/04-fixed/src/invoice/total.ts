import { Currency, LedgerPort } from "../ports/ledger-port";

export interface Line {
  sku: string;
  amount: number;
}

export function invoiceTotal(lines: Line[]): number {
  const sum = lines.reduce((a, l) => a + l.amount, 0);
  return LedgerPort.round(sum, Currency.EUR);
}
