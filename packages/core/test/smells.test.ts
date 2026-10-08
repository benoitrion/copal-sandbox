import { test } from "node:test";
import * as assert from "node:assert/strict";
import { detectSmell, evaluate, fileAsChange, parsePolicy, resolvePolicy, validatePolicy } from "../src";

const longTs = ["export function total(lines: Line[]) {", ...Array.from({ length: 45 }, (_, i) => `  const v${i} = lines[${i}]?.amount ?? 0;`), "  return 0;", "}"].join("\n");
const nested = `function f(a) {
  if (a) {
    for (const x of a) {
      while (x.next) {
        if (x.ok) {
          return x;
        }
      }
    }
  }
}`;
const java = `public class Invoices {
  public Invoice create(String id, Customer c, Money net, Money vat, Currency cur, Date due) {
    return null;
  }
}`;
const py = `def build(a, b, c, d, e):
    if a:
        for x in b:
            while x:
                if c:
                    return d
`;

test("long-function, deep-nesting and too-many-params across languages", () => {
  assert.equal(detectSmell("long-function", longTs, 40).length, 1);
  assert.equal(detectSmell("long-function", longTs, 50).length, 0);
  assert.deepEqual(detectSmell("deep-nesting", nested, 3).map((h) => h.line), [5]);
  assert.match(detectSmell("too-many-params", java, 4)[0].message, /6 parameters/);
  assert.equal(detectSmell("too-many-params", py, 4)[0].line, 1);
  assert.deepEqual(detectSmell("deep-nesting", py, 3).map((h) => h.line), [5]);
});

test("strings and comments don't confuse the detectors", () => {
  const src = `function g(x) {\n  const s = "{ { { { if (a) {";\n  // if (b) { if (c) { if (d) {\n  return s;\n}`;
  assert.equal(detectSmell("deep-nesting", src, 1).length, 0);
  const dup = `const a = "payment-failed";\nconst b = "payment-failed";\nlog("payment-failed");`;
  assert.equal(detectSmell("duplicated-literal", dup, 3)[0].line, 3);
});

test("builtin:smells: hints only, anchored on changed lines", () => {
  const p = resolvePolicy(parsePolicy("version: 4\nextends: [builtin:smells]\nrules: []\n"));
  assert.deepEqual(validatePolicy(p), []);
  const r = evaluate([fileAsChange("src/total.ts", longTs)], p);
  const f = r.findings.find((x) => x.ruleId === "long-function")!;
  assert.ok(f && !f.blocking && f.coach?.question, "long-function is a coached hint");
  // a PR that only touches line 10 of an existing file doesn't re-report the function declared on line 1
  const edit = { path: "src/total.ts", status: "modified" as const, addedLines: [{ line: 10, text: "x" }], content: longTs };
  assert.equal(evaluate([edit], p).findings.filter((x) => x.ruleId === "long-function").length, 0);
  assert.match(validatePolicy(parsePolicy("version: 4\nrules:\n  - id: s\n    smell: { kind: spaghetti }\n")).map((i) => i.message).join(), /unknown smell/);
});
