import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classify, hintCard, detectSmell, evaluate, fileAsChange, parsePolicy, reportToMarkdown, resolvePolicy } from "../src";

const segs = ["retail", "wholesale", "partner", "public"];
const dup = segs.map((s) => `export function discount_${s}(order: Order) {\n  let total = 0;\n  for (const line of order.lines) {\n    total += line.amount * line.qty;\n  }\n  if (order.segment === "${s}") {\n    total = total * 0.9;\n  }\n  return total;\n}\n`).join("\n");

test("duplicate-block names the functions that share the copy", () => {
  const h = detectSmell("duplicate-block", dup);
  assert.equal(h.length, 1);
  assert.match(h[0].advice!, /discount_retail, discount_wholesale, discount_partner and 1 more: keep one function/);
});

test("complexity names what the branches test", () => {
  const code = `function price(order: Order) {\n  switch (order.segment) {\n${["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((c) => `    case "${c}": return 1;`).join("\n")}\n  }\n}\n`;
  const h = detectSmell("complexity", code);
  assert.match(h[0].message, /11 decision paths/);
  assert.match(h[0].advice!, /`segment`/);
});

test("long function advice spots the repeated call", () => {
  const code = `function routes(app: App) {\n${Array.from({ length: 45 }, (_, i) => `  app.get("/r${i}", handler);`).join("\n")}\n}\n`;
  assert.match(detectSmell("long-function", code)[0].advice!, /calls app\.get\(…\) 45 times/);
});

test("every finding carries a risk and a family; the PR comment ranks by risk and shows the advice", () => {
  const policy = resolvePolicy(parsePolicy("version: 4\nextends: [builtin:security, builtin:smells]\nrules: []\n"));
  const r = evaluate([fileAsChange("src/d.ts", dup + '\nconst password = "s3cr3t-Passw0rd-2026";\n')], policy, { environment: "ci" });
  const sec = r.findings.find((f) => f.kind === "Security")!;
  assert.equal(sec.risk, "high");
  const d = r.findings.find((f) => f.ruleId === "duplicate-block")!;
  assert.deepEqual([d.risk, d.kind], ["medium", "Duplication"]);
  const md = reportToMarkdown(r);
  assert.ok(md.indexOf("🔴 High") < md.indexOf("🟠 Medium"));
  assert.match(md, /Suggestion: It is repeated in/);
  assert.deepEqual(classify({ id: "x", pattern: "x", risk: "low", kind: "Tests" }, "security", "error", true), { risk: "low", kind: "Tests" });
});

test("hints say something about this code: the fields an `any` value uses, the untested function and its cases", () => {
  const { anyDetail, testDetail } = require("../src/detail");
  const code = "export function createCreditNote(original: any) {\n  if (original.total > 0) return original.id;\n  return null;\n}";
  assert.deepEqual(anyDetail("export function createCreditNote(original: any) {", code), { detail: "`original` is `any` but the code reads .total, .id", fix: "Type it: `original: { total: …; id: … }`" });
  assert.equal(testDetail("credit-note.ts", code), "`createCreditNote` has 2 cases and no test");
  assert.equal(hintCard({ ruleId: "no-explicit-any", kind: "Best practice", message: "m", coach: { question: "q?" } } as never).question, undefined, "mechanical: no question");
  assert.equal(hintCard({ ruleId: "ui-no-persistence", kind: "Architecture", message: "m", coach: { question: "q?" } } as never).question, "q?", "a team decision: asked");
});

test("baseline keeps old findings quiet; the gate judges only what the change introduces", () => {
  const { createBaseline, withoutBaseline, lineTextFrom, evaluateGate } = require("../src/baseline");
  const p = resolvePolicy(parsePolicy("version: 4\nextends: [builtin:quality]\nrules: []\n"));
  const old = fileAsChange("src/a.ts", "export function f(x: any) { return x.id; }\n");
  const b = createBaseline(evaluate([old], p).findings, lineTextFrom([old]));
  assert.ok(b.entries.length >= 1);
  // the same line moved down by an edit above it: still known
  const edited = fileAsChange("src/a.ts", "// new comment\nexport function f(x: any) { return x.id; }\nexport function g(y: any) { return y.total; }\n");
  const fresh = withoutBaseline(evaluate([edited], p).findings, b, lineTextFrom([edited]));
  assert.deepEqual(fresh.map((f: { line: number }) => f.line), [3], "only the new any on line 3 speaks");
  assert.deepEqual(evaluateGate(fresh, { maxNew: { low: 0 } }), { passed: false, reasons: ["1 new low-risk issue (max 0)"] });
  assert.deepEqual(evaluateGate([], { maxNew: { high: 0 }, requireTests: true }), { passed: true, reasons: [] });
});

test("a change over budget comes with a split: rule and tests first, then wiring, then the screen", () => {
  const { splitPlan } = require("../src/split");
  const f = (path: string, n: number) => ({ path, status: "added", addedLines: Array.from({ length: n }, (_, i) => ({ line: i + 1, text: "x" })) });
  const steps = splitPlan([f("src/pricing/discount.ts", 80), f("src/pricing/discount.test.ts", 40), f("src/api/orders.ts", 130), f("src/ui/CheckoutPage.tsx", 200), f("README.md", 5)]);
  assert.deepEqual(steps.map((s: { title: string; files: string[] }) => [s.title, s.files.length]), [["Rule and its tests", 2], ["Wiring", 1], ["Screen", 1], ["Docs and config", 1]]);
});
