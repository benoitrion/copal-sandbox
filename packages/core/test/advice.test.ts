import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classify, detectSmell, evaluate, fileAsChange, parsePolicy, reportToMarkdown, resolvePolicy } from "../src";

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
