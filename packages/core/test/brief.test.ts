import { test } from "node:test";
import * as assert from "node:assert/strict";
import { agentContextBlock, briefNextStep, briefToMarkdown, buildBrief, EXAMPLES_FIRST, navigatorQuestions, parsePolicy, requestCheckContext, resolvePolicy } from "../src";

const VAT = () => {
  const s = navigatorQuestions(undefined, "Add VAT to invoice totals", { force: true });
  return buildBrief(undefined, "Add VAT to invoice totals", s.questions, [
    { id: "q1", text: "100 EUR net (BE) → 121 EUR gross" },
    { id: "q2", text: "the total calculation in src/invoice" },
    { id: "q3", text: "negative amount → error; unknown country → error" },
  ], false, { outOfScope: "the PDF and the database" });
};

test("brief: answers become 2–4 examples with task, scope in/out and done-when", () => {
  const b = VAT();
  assert.deepEqual(b.examples, ["100 EUR net (BE) → 121 EUR gross", "negative amount → error", "unknown country → error"]);
  assert.deepEqual(b.scope, { in: "the total calculation in src/invoice", out: "the PDF and the database" });
  const md = briefToMarkdown(b);
  assert.match(md, /^# Task: Add VAT to invoice totals/m);
  assert.match(md, /^Scope in: the total calculation in src\/invoice$/m);
  assert.match(md, /^Scope out: the PDF and the database$/m);
  assert.equal((md.match(/^- \[ \] /gm) ?? []).length, 3);
  assert.match(md, /^Done when: /m);
  assert.equal(briefNextStep(md), 'make "100 EUR net (BE) → 121 EUR gross" pass');
});

test("at most 4 examples", () => {
  const s = navigatorQuestions(undefined, "Add VAT to invoice totals", { force: true });
  const b = buildBrief(undefined, "x", s.questions, [{ id: "q1", text: "a → 1" }, { id: "q3", text: "b → 2; c → 3; d → 4; e → 5" }]);
  assert.equal(b.examples.length, 4);
});

test("instructions: failing tests first, wait for OK, nothing beyond the examples — brief, hook and sync-context", () => {
  for (const text of [briefToMarkdown(VAT()), requestCheckContext("Add VAT to invoice totals.")!, agentContextBlock(resolvePolicy(parsePolicy("version: 4\nrules: []\n")))]) {
    assert.match(text, /failing tests/i);
    assert.match(text, /wait for the developer's OK/i);
    assert.match(text, /nothing beyond the examples/i);
  }
  assert.ok(EXAMPLES_FIRST.length > 0);
});
