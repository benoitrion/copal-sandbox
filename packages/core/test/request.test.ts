import { test } from "node:test";
import * as assert from "node:assert/strict";
import { requestCheckContext, requestGaps } from "../src";

test("Add VAT to invoice totals → scope is the gap; one question about what not to touch", () => {
  const gaps = requestGaps("Add VAT to invoice totals.");
  assert.ok(gaps.includes("scope"));
  const ctx = requestCheckContext("Add VAT to invoice totals.")!;
  assert.match(ctx, /not touch/i);
  assert.equal((ctx.match(/\?/g) ?? []).length, 1, "exactly one question");
});

test("Continue the implementation → goal is the gap; the brief's next step is offered", () => {
  assert.deepEqual(requestGaps("Continue the implementation."), ["goal"]);
  const brief = "# Task: Add VAT to invoice totals\nNext: make \"negative amount → error\" pass\n";
  const ctx = requestCheckContext("Continue the implementation.", brief)!;
  assert.match(ctx, /1\. make "negative amount → error" pass/);
  assert.equal(requestCheckContext("Continue the implementation.")!.includes("1."), false, "no option 1 without a brief");
});

test("a clear request (goal, scope, done) → no gaps, no output", () => {
  const p = "Fix the rounding bug in InvoiceTotal.compute: 10.005 should round to 10.01. Only change that method; existing tests must pass.";
  assert.deepEqual(requestGaps(p), []);
  assert.equal(requestCheckContext(p), null);
});

test("small requests and bypasses → no output", () => {
  assert.equal(requestCheckContext("rename foo to bar"), null);
  assert.equal(requestCheckContext("Add VAT to invoice totals, just do it"), null);
  assert.equal(requestCheckContext("Add VAT to invoice totals. skip"), null);
});
