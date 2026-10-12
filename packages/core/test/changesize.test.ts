import { test } from "node:test";
import * as assert from "node:assert/strict";
import { BUILTIN_PACKS, evaluate, hintCard, validatePolicy } from "../src";
import type { FileChange, Policy } from "../src";

const file = (path: string, n: number): FileChange => ({ path, status: "modified", addedLines: Array.from({ length: n }, (_, i) => ({ line: i + 1, text: `x${i}` })) });
const policy: Policy = { version: 4, rules: BUILTIN_PACKS.testing.rules.filter((r) => r.id === "change-size") };

test("change-size: small change passes", () => {
  assert.equal(evaluate([file("src/a.ts", 120), file("src/a.test.ts", 40)], policy).findings.length, 0);
});

test("change-size: one finding for a large change, lockfiles excluded", () => {
  const r = evaluate([file("src/a.ts", 300), file("src/b.ts", 320), file("package-lock.json", 5000)], policy);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].message, /620 lines \(budget 400\)/);
  assert.equal(r.findings[0].blocking, false);
  assert.equal(hintCard(r.findings[0]).question, "What is the smallest step you could verify on its own?");
});

test("change-size: too many files", () => {
  const r = evaluate(Array.from({ length: 14 }, (_, i) => file(`src/f${i}.ts`, 2)), policy);
  assert.match(r.findings[0].message, /14 files \(budget 12\)/);
});

test("change-size: validation", () => {
  assert.deepEqual(validatePolicy(policy), []);
  assert.equal(validatePolicy({ version: 4, rules: [{ id: "x", changeSize: { maxLines: 0 } }] }).length, 1);
});

test("concrete test path from a glob template", async () => {
  const { concreteTestPath } = await import("../src/engine.js").catch(() => require("../src/engine"));
  assert.equal(concreteTestPath("src/**/reminders.test.ts", "src/payments/reminders.ts"), "src/payments/reminders.test.ts");
  assert.equal(concreteTestPath("src/test/java/**/FooTest.java", "src/main/java/com/x/Foo.java"), "src/test/java/com/x/FooTest.java");
  assert.equal(concreteTestPath("tests/test_a.py", "src/a.py"), "tests/test_a.py");
});
