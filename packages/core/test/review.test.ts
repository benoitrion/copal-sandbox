import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileAsChange, loadPolicy, reviewChange } from "../src";

const APP = path.resolve(__dirname, "../../../../examples/billing-api");
const total = () => fileAsChange("src/invoice/total.ts", fs.readFileSync(path.join(APP, "scenarios/01-invoice-rounding/src/invoice/total.ts"), "utf8"));

test("Review my change on billing-api scenario 01: three hint cards with Ask me / Explain / Show me", () => {
  const { policy } = loadPolicy(APP);
  const r = reviewChange([total()], policy);
  assert.deepEqual(r.cards.map((c) => c.ruleId).sort(), ["hardcoded-credentials", "invoice-contract-test", "ledger-rounding"]);
  for (const c of r.cards as { ruleId: string; actions: string[]; markdown: string; file: string; line: number }[]) {
    assert.deepEqual(c.actions, ["Ask me", "Explain", "Show me"], c.ruleId);
    assert.ok(c.markdown.includes(`\`${c.ruleId}\``), "same format as the PR comment");
    assert.ok(c.file && c.line > 0);
  }
  assert.deepEqual(r.scope, [], "no brief → no scope questions");
});

test("Review my change adds the scope check when a brief exists", () => {
  const { policy } = loadPolicy(APP);
  const brief = "# Task: Add a settings page\n\nScope in: src/web\n\n## Examples\n- [ ] GET /settings → 200\n";
  const r = reviewChange([total()], policy, { brief });
  assert.equal(r.scope.length, 1);
  assert.match(r.scope[0].question, /Not in the brief: src\/invoice\/total\.ts/);
});
