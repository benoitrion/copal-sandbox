# ledger-rounding — rounding belongs to the LedgerPort

**Question to ask yourself:** who owns rounding in this codebase?

## Why
Invoices and the ledger must agree to the cent. When every module rounds on its own (`Math.round(x * 100) / 100`),
small differences appear between the invoice total and the booked amount, and month-end reconciliation fails (FIN-402).
Rounding has one owner: `LedgerPort.round(amount, currency)`. It knows the currency's minor units and the
rounding mode the accountants agreed on (half-even).

## Instead of / prefer
```ts
// instead of
const total = Math.round(sum * 100) / 100;
// prefer
const total = LedgerPort.round(sum, Currency.EUR);
```

## Practice
- Kata: [Supermarket Receipt](https://sammancoaching.org/kata_descriptions/supermarket_receipt.html) — sammancoaching.org, CC-BY-SA 4.0.
- Learning hour: *naming domain concepts* — find the business word behind a number or an operation.
