import { test } from "node:test";
import * as assert from "node:assert/strict";
import { groupFindings, parseBriefMarkdown, reportToMarkdown, scopeCheck } from "../src";
import type { FileChange, Finding, Report } from "../src";

const brief = `# Brief: late payment fees

**Goal:** charge a late fee on invoices paid after their due date.

**In scope:** fee calculation in src/payments.

**Out of scope:** invoice PDF layout, API changes.

**Done when:** the fee for an invoice 30 days late is computed and tested.
`;
const ch = (path: string, text = "export function x() {}"): FileChange => ({ path, status: "added", addedLines: [{ line: 1, text }] });

test("brief: hand-written format with bold labels is understood", () => {
  const b = parseBriefMarkdown(brief);
  assert.equal(b.scope.in, "fee calculation in src/payments.");
  assert.equal(b.scope.out, "invoice PDF layout, API changes.");
  assert.match(b.task, /late fee/);
  assert.equal(b.examples.length, 1);
});

test("scope: in-scope file is not flagged, out-of-scope file is", () => {
  const items = scopeCheck(brief, [ch("src/payments/late-fees.ts", "export function lateFee() {}"), ch("src/invoice/pdf.ts", "export function lateFeeLine() {}")]);
  assert.deepEqual(items.map((i) => i.file), ["src/invoice/pdf.ts"]);
  assert.match(items[0].question, /brief says not to touch/);
});

test("report: one line per rule, with where it is and how often", () => {
  const f = (line: number): Finding => ({ ruleId: "no-explicit-any", category: "quality", severity: "warning", mode: "audit", blocking: false, file: "src/a.ts", line, message: "Explicit any" } as Finding);
  const findings = [f(3), f(11), f(19), { ...f(1), file: "src/b.ts" }];
  assert.equal(groupFindings(findings).length, 2);
  const md = reportToMarkdown({ environment: "ci", policyMode: "coach", findings, blocking: false, summary: { total: 4, blocking: 0, audit: 4, byCategory: {} }, filesChecked: 2, rulesEvaluated: 1 } as Report);
  assert.match(md, /1 thing to look at/);
  assert.match(md, /`src\/a\.ts:3` and 1 other file · 4×/);
  assert.doesNotMatch(md, /\|/);
});
