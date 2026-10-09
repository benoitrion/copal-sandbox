import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parsePolicy, resolvePolicy, testOrderFindings } from "../src";

const POLICY = resolvePolicy(
  parsePolicy(`version: 4
rules:
  - id: invoice-contract-test
    category: testing
    mode: enforce
    paths: ["src/invoice/*.ts"]
    requireTest:
      test: "src/invoice/{name}.test.ts"
    coach:
      question: "Which example would prove this invoice change is right?"
      kata: https://sammancoaching.org/kata_descriptions/string_calculator.html
`),
);

test("test commit before code → clean", () => {
  const commits = [
    { sha: "aaa1111", files: ["src/invoice/vat.test.ts"] },
    { sha: "bbb2222", files: ["src/invoice/vat.ts"] },
  ];
  assert.deepEqual(testOrderFindings(POLICY, commits), []);
});

test("test and code in the same commit → clean", () => {
  assert.deepEqual(testOrderFindings(POLICY, [{ sha: "aaa1111", files: ["src/invoice/vat.ts", "src/invoice/vat.test.ts"] }]), []);
});

test("code commit before test → one audit finding, asked as a question with the ladder", () => {
  const commits = [
    { sha: "aaa1111", files: ["src/invoice/vat.ts"] },
    { sha: "bbb2222", files: ["src/invoice/total.ts"] },
    { sha: "ccc3333", files: ["src/invoice/vat.test.ts", "src/invoice/total.test.ts"] },
  ];
  const f = testOrderFindings(POLICY, commits);
  assert.equal(f.length, 2);
  const vat = f.find((x) => x.file === "src/invoice/vat.ts")!;
  assert.equal(vat.ruleId, "invoice-contract-test");
  assert.equal(vat.mode, "audit");
  assert.equal(vat.blocking, false, "audit only, even when the rule is enforced");
  assert.match(vat.message, /\?$/);
  assert.match(vat.message, /aaa1111/);
  assert.match(vat.message, /ccc3333/);
  assert.ok(vat.coach?.question?.endsWith("?"));
  assert.ok(vat.coach?.kata, "keeps the ladder (explain → kata)");
});

test("code without any test is left to the requireTest check itself", () => {
  assert.deepEqual(testOrderFindings(POLICY, [{ sha: "aaa1111", files: ["src/invoice/vat.ts"] }]), []);
});
