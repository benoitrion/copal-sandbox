import { Currency, LedgerPort } from "../ports/ledger-port";

export interface Line {
  sku: string;
  amount: number;
}

export function invoiceTotal(lines: Line[]): number {
  const sum = lines.reduce((a, l) => a + l.amount, 0);
  return LedgerPort.round(sum, Currency.EUR);
}

/** Total including VAT; rounding stays in the ledger port. */
export function invoiceTotalWithVat(lines: Line[], vatRate: number): number {
  const net = lines.reduce((a, l) => a + l.amount, 0);
  return LedgerPort.round(net * (1 + vatRate), Currency.EUR);
}
