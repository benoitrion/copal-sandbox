import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  buildBrief,
  containsCode,
  evaluate,
  findingToMarkdown,
  formatReport,
  hintCard,
  kataSuggestions,
  navigatorQuestions,
  parsePolicy,
  resolvePolicy,
  taskScope,
  referenceLink,
  validatePolicy,
} from "../src";

const V4 = `
version: 4
project: demo
mode: coach
extends: [builtin:hexagonal]
navigator:
  enabled: true
  maxQuestions: 3
rules:
  - id: no-float-money
    pattern: "parseFloat\\\\("
    severity: audit
    message: Money parsed as float
    why: Floats lose cents.
    coach:
      question: "What happens to 0.1 + 0.2 cents after a thousand invoices?"
      reference: docs/rules/money.md
      example: { bad: "parseFloat(amount)", good: "Money.of(amount)" }
      kata: https://sammancoaching.org/kata_descriptions/supermarket_receipt.html
      escalateAfter: 2
    fix: Use the Money value object.
  - id: aws
    secrets: true
    severity: block
`;

const change = (path: string, lines: string[]) => ({ path, status: "modified" as const, addedLines: lines.map((text, i) => ({ line: i + 1, text })) });

test("v4 policy parses, validates and normalises severity aliases", () => {
  const p = resolvePolicy(parsePolicy(V4));
  assert.deepEqual(validatePolicy(p), []);
  assert.equal(p.version, 4);
  assert.equal(p.mode, "coach");
  const aws = p.rules.find((r) => r.id === "aws")!;
  assert.equal(aws.mode, "enforce");
  assert.equal(p.rules.find((r) => r.id === "no-float-money")!.mode, "audit");
  assert.ok(p.rules.some((r) => r.id === "domain-no-infra"), "builtin:hexagonal merged");
});

test("v3 files still validate unchanged", () => {
  const p = parsePolicy("version: 3\nrules:\n  - id: a\n    pattern: foo\n");
  assert.deepEqual(validatePolicy(p), []);
  assert.equal(evaluate([change("x.ts", ["foo"])], p).policyMode, "audit");
});

test("questions that contain code are rejected", () => {
  const p = parsePolicy('version: 4\nrules:\n  - id: a\n    pattern: foo\n    coach:\n      question: "Use `const x = Money.of(y);` instead?"\n');
  assert.match(validatePolicy(p).map((i) => i.message).join(), /must not contain code/);
  assert.equal(containsCode("Who should own this call — the domain or an adapter?"), false);
  assert.equal(containsCode("try const total = sum(lines);"), true);
});

test("findings carry coaching and render as hint cards (fix hidden until Show me)", () => {
  const p = resolvePolicy(parsePolicy(V4));
  const r = evaluate([change("src/invoice.ts", ["const t = parseFloat(amount);"]), change("src/domain/pay.ts", ["import { http } from '../infra/http';"])], p);
  assert.equal(r.policyMode, "coach");
  const money = r.findings.find((f) => f.ruleId === "no-float-money")!;
  const card = hintCard(money);
  assert.equal(card.question, "What happens to 0.1 + 0.2 cents after a thousand invoices?");
  assert.equal(card.maxLevel, 3);
  assert.equal(card.fix, "Use the Money value object.");
  const text = formatReport(r);
  assert.match(text, /hint\(s\) to think about/);
  assert.match(text, /What happens to 0\.1/);
  assert.doesNotMatch(text, /Use the Money value object/);
  assert.match(formatReport(r, { showMe: true }), /Use the Money value object/);
  const md = findingToMarkdown(money);
  assert.match(md, /Copal coach/);
  assert.match(md, /<summary>Show me<\/summary>/);
  assert.doesNotMatch(md, /```suggestion/);
  assert.ok(r.findings.some((f) => f.ruleId === "domain-no-infra"), "hexagonal boundary detected");
});

test("navigator: skips small tasks, asks at most 3 code-free questions for features", () => {
  const p = resolvePolicy(parsePolicy(V4));
  assert.equal(taskScope("fix typo in README"), "small");
  assert.equal(navigatorQuestions(p, "rename variable").engage, false);
  assert.equal(navigatorQuestions(p, "add VAT to invoices, just do it").engage, false);
  const s = navigatorQuestions(p, "Add VAT calculation to invoice totals for EU customers");
  assert.equal(s.engage, true);
  assert.deepEqual(s.questions.map((q) => q.kind), ["first-example", "placement", "risk"]);
  assert.ok(s.questions.every((q) => !containsCode(q.text)));
  assert.match(s.questions[1].text, /domain/);
  const brief = buildBrief(p, "Add VAT", s.questions, [
    { id: "q1", text: "100 EUR net in BE gives 121 EUR gross" },
    { id: "q2", text: "src/invoice/vat.ts, pure function" },
    { id: "q3", text: "negative amounts; unknown country" },
  ]);
  assert.equal(brief.firstTest, "100 EUR net in BE gives 121 EUR gross");
  assert.deepEqual(brief.edgeCases, ["negative amounts", "unknown country"]);
  assert.match(brief.instructions[0], /failing test/);
});

test("kata escalation per developer and learning hour per team", () => {
  const p = resolvePolicy(parsePolicy(V4));
  const now = Date.parse("2026-10-08T12:00:00Z");
  const at = "2026-10-06T10:00:00Z";
  const occ = [
    { ruleId: "no-float-money", developer: "ana", at },
    { ruleId: "no-float-money", developer: "ana", at },
    { ruleId: "domain-no-infra", developer: "ana", at },
    { ruleId: "domain-no-infra", developer: "ana", at },
    { ruleId: "domain-no-infra", developer: "ana", at },
    { ruleId: "domain-no-infra", developer: "bob", at },
    { ruleId: "domain-no-infra", developer: "bob", at },
    { ruleId: "domain-no-infra", developer: "bob", at },
    { ruleId: "domain-no-infra", developer: "old", at: "2026-08-01T00:00:00Z" },
  ];
  const s = kataSuggestions(p, occ, now);
  assert.ok(s.some((x) => x.ruleId === "no-float-money" && x.developer === "ana" && x.kata?.includes("supermarket")));
  assert.ok(s.some((x) => x.ruleId === "domain-no-infra" && x.developer === "bob" && x.kata?.includes("birthday_greetings")));
  assert.ok(s.some((x) => x.ruleId === "domain-no-infra" && !x.developer && x.learningHour === "ports-and-adapters"));
  assert.ok(!s.some((x) => x.developer === "old"));
});

test("references link to the file at the reviewed commit", () => {
  assert.equal(referenceLink("docs/rules/a.md"), "`docs/rules/a.md`");
  assert.equal(referenceLink("docs/rules/a.md", "https://github.com/o/r/blob/abc"), "[docs/rules/a.md](https://github.com/o/r/blob/abc/docs/rules/a.md)");
  assert.equal(referenceLink("https://wiki.example.com/x"), "[wiki.example.com/x](https://wiki.example.com/x)");
});
