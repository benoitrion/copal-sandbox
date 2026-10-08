# ui-no-persistence — controllers don't touch storage

**Question to ask yourself:** which layer should know how invoices are stored?

## Why
ADR-007: `web → service → port → persistence`. A controller that imports the repository couples HTTP handling to
the database schema: every storage change ripples into the API, and the business rules can't be tested without a
database. Controllers call services; services depend on ports; adapters in `persistence/` implement the ports.

## Instead of / prefer
```ts
// instead of (src/web)
import { InvoiceRepo } from "../persistence/invoice-repo";
// prefer
constructor(private readonly invoices: InvoiceService) {}
```

## Practice
- Kata: [Birthday Greetings](https://sammancoaching.org/kata_descriptions/birthday_greetings.html) — the classic ports-and-adapters kata (sammancoaching.org, CC-BY-SA 4.0).
- Learning hour: *ports and adapters*.
