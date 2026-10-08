# invoice-contract-test — invoice maths comes with a test

**Question to ask yourself:** which example would prove this change is right?

## Why
Invoice calculations are checked against the ledger fixtures. A change to `src/invoice/x.ts` without
`src/invoice/x.test.ts` means nobody wrote down the example that proves it — and an AI-generated change is
especially likely to be "almost right".

## Work test-first
1. Write the example as a failing test (input → expected total).
2. Make it pass with the simplest code.
3. Refactor. Repeat for the next example (edge cases: zero, negative, rounding boundary).

## Practice
- Kata: [String Calculator](https://sammancoaching.org/kata_descriptions/string_calculator.html) (sammancoaching.org, CC-BY-SA 4.0).
- Learning hour: *test first, small steps*.
