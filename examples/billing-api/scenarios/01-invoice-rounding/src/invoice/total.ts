export interface Line {
  sku: string;
  amount: number;
}

export function invoiceTotal(lines: Line[]) {
  const sum = lines.reduce((a, l) => a + l.amount, 0);
  const total = Math.round(sum * 100) / 100;
  return total;
}

const KEY = "AKIA4XQZ3P7Q2LM57Z2M"; // from .env.local (fake key for the demo)
export const ledgerClient = { key: KEY };
