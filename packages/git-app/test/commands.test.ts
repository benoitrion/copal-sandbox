import { test } from "node:test";
import * as assert from "node:assert/strict";
import { CopalClient } from "@copal/client";
import { runCommand } from "../src/commands";

const POLICY = `version: 4
rules:
  - id: ledger-rounding
    pattern: "Math\\\\.round"
    why: Rounding in one place keeps invoices and the ledger reconciled.
    coach:
      question: Who owns rounding in this codebase?
      reference: docs/rules/ledger-rounding.md
      kata: https://sammancoaching.org/kata_descriptions/supermarket_receipt.html
`;
const local = new CopalClient({ serverUrl: "" });
const ctx = (body: string, extra = {}) => ({ body, loadPolicy: async () => POLICY, referenceBase: "https://github.com/o/r/blob/abc/", ...extra });

test("/copal explain renders the rule as a hint card with a linked reference", async () => {
  const r = (await runCommand(ctx("/copal explain ledger-rounding"), local))!;
  assert.match(r, /\*\*Who owns rounding in this codebase\?\*\*/);
  assert.match(r, /\[docs\/rules\/ledger-rounding\.md\]\(https:\/\/github\.com\/o\/r\/blob\/abc\/docs\/rules\/ledger-rounding\.md\)/);
  assert.match(r, /supermarket_receipt/);
  assert.match((await runCommand(ctx("/copal explain nope"), local))!, /no rule `nope`/);
});

test("/copal rule drafts a rule from a reviewer's comment in a thread", async () => {
  const r = (await runCommand(
    ctx("/copal rule", { author: "lead", parent: { body: "Don't call the payment provider from controllers, go through PaymentPort.", path: "src/web/checkout.ts", url: "https://github.com/o/r/pull/7#discussion_r1" } }),
    local,
  ))!;
  assert.match(r, /```yaml/);
  assert.match(r, /paths: \["src\/web\/\*\*"\]/);
  assert.match(r, /question: "Before you write this: don't call the payment provider/);
  assert.match(r, /reference: https:\/\/github\.com\/o\/r\/pull\/7#discussion_r1/);
  assert.match(r, /copal sync-context/);
});

test("non-commands and help", async () => {
  assert.equal(await runCommand(ctx("LGTM"), local), null);
  assert.match((await runCommand(ctx("/copal help"), local))!, /\/copal explain/);
});
