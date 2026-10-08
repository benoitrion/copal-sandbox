import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  applicableRules,
  evaluate,
  fileAsChange,
  loadPolicy,
  matchGlob,
  parsePolicy,
  parseUnifiedDiff,
  parseYamlSubset,
  redact,
  toYaml,
  validatePolicy,
} from "../src";

const APP = path.resolve(__dirname, "../../../../examples/billing-api");
const scenario = (name: string) => {
  const dir = path.join(APP, "scenarios", name);
  const out: ReturnType<typeof fileAsChange>[] = [];
  const walk = (d: string) =>
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name !== "DESCRIPTION.md") out.push(fileAsChange(path.relative(dir, p).split(path.sep).join("/"), fs.readFileSync(p, "utf8")));
    });
  walk(dir);
  return out;
};
const ids = (r: ReturnType<typeof evaluate>) => r.findings.map((f) => f.ruleId).sort();

test("yaml subset parser handles the policy shapes", () => {
  const v = parseYamlSubset(`
version: 3   # comment
rules:
  - id: a
    mode: enforce
    paths: ["src/**", 'lib/**']
    fix:
      with: "x($1)"
  - id: b
    deny: "a/** -> b/**"
env: { ci: { x: 1 } }
list:
- one
- "two # not a comment"
text: |
  line1
  line2
`) as any;
  assert.equal(v.version, 3);
  assert.equal(v.rules.length, 2);
  assert.deepEqual(v.rules[0].paths, ["src/**", "lib/**"]);
  assert.equal(v.rules[0].fix.with, "x($1)");
  assert.equal(v.rules[1].deny, "a/** -> b/**");
  assert.deepEqual(v.env, { ci: { x: 1 } });
  assert.deepEqual(v.list, ["one", "two # not a comment"]);
  assert.equal(v.text, "line1\nline2\n");
  assert.deepEqual(parseYamlSubset(toYaml(v)), v);
});

test("glob matcher", () => {
  assert.ok(matchGlob("src/web/a.ts", "src/web/**"));
  assert.ok(matchGlob("src/a/b/c.tsx", "**/*.{ts,tsx}"));
  assert.ok(!matchGlob("src/ports/x.ts", "src/web/**"));
  assert.ok(matchGlob("@types/node", "@types/*"));
});

test("billing-api policy loads, inherits built-ins and validates", () => {
  const { policy } = loadPolicy(APP);
  assert.deepEqual(validatePolicy(policy), []);
  const all = policy.rules.map((r) => r.id);
  for (const id of ["hardcoded-credentials", "sql-injection", "no-console", "ui-no-persistence", "ledger-rounding"]) assert.ok(all.includes(id), id);
});

test("baseline app is clean", () => {
  const { policy } = loadPolicy(APP);
  const files = ["src/invoice/total.ts", "src/web/invoice-controller.ts", "src/persistence/invoice-repo.ts", "src/service/invoice-service.ts", "src/ports/ledger-port.ts", "package.json"].map(
    (f) => fileAsChange(f, fs.readFileSync(path.join(APP, f), "utf8")),
  );
  files.push(fileAsChange("src/invoice/total.test.ts", fs.readFileSync(path.join(APP, "src/invoice/total.test.ts"), "utf8")));
  const r = evaluate(files, policy, { environment: "ci" });
  assert.deepEqual(r.findings, []);
});

test("scenario 01: rounding + secret, with a concrete fix", () => {
  const { policy } = loadPolicy(APP);
  const r = evaluate(scenario("01-invoice-rounding"), policy);
  assert.deepEqual(ids(r), ["hardcoded-credentials", "invoice-contract-test", "ledger-rounding"]);
  const fix = r.findings.find((f) => f.ruleId === "ledger-rounding")!;
  assert.equal(fix.blocking, true);
  assert.equal(fix.suggestion!.replacement.trim(), "const total = LedgerPort.round(sum, Currency.EUR);");
  assert.ok(!JSON.stringify(r).includes("AKIA4XQZ3P7Q2LM57Z2M"), "secret must be masked in findings");
  // test rule is audit locally, enforce in CI
  assert.equal(r.findings.find((f) => f.ruleId === "invoice-contract-test")!.blocking, false);
  const ci = evaluate(scenario("01-invoice-rounding"), policy, { environment: "ci" });
  assert.equal(ci.findings.find((f) => f.ruleId === "invoice-contract-test")!.blocking, true);
});

test("scenario 02: architecture boundary", () => {
  const { policy } = loadPolicy(APP);
  const r = evaluate(scenario("02-ui-to-db"), policy);
  assert.deepEqual(ids(r), ["no-console", "no-explicit-any", "ui-no-persistence"]);
  assert.equal(r.summary.blocking, 1);
});

test("scenario 03: SQL injection, dependencies, restricted data", () => {
  const { policy } = loadPolicy(APP);
  const r = evaluate(scenario("03-sql-and-deps"), policy);
  assert.deepEqual(ids(r), ["approved-dependencies", "approved-dependencies", "hardcoded-credentials", "sql-injection"]);
  assert.ok(r.findings.some((f) => f.message.includes('"moment" is on the deny list')));
  assert.ok(r.findings.some((f) => f.message.includes('"some-unreviewed-sdk" is not on the approved list')));
});

test("scenario 04: fixed version passes in CI", () => {
  const { policy } = loadPolicy(APP);
  const r = evaluate(scenario("04-fixed"), policy, { environment: "ci" });
  assert.deepEqual(r.findings, []);
});

test("diff parser maps added lines to new line numbers", () => {
  const files = parseUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 one
-two
+TWO
+three
 four
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+x
+y
`);
  assert.equal(files.length, 2);
  assert.deepEqual(files[0].addedLines, [
    { line: 2, text: "TWO" },
    { line: 3, text: "three" },
  ]);
  assert.equal(files[1].status, "added");
  assert.deepEqual(files[1].addedLines.map((l) => l.line), [1, 2]);
});

test("redaction removes secrets and policy-restricted context", () => {
  const { policy } = loadPolicy(APP);
  const out = redact('const KEY = "AKIA4XQZ3P7Q2LM57Z2M"; // iban BE71096123456769\npassword: "hunter2hunter2"', policy);
  assert.ok(!out.text.includes("AKIA4XQZ"));
  assert.ok(!out.text.includes("BE7109"));
  assert.ok(!out.text.includes("hunter2"));
  assert.ok(out.text.includes("[REDACTED:customer-iban]"));
});

test("suppression comment marks a false positive", () => {
  const p = parsePolicy(`version: 3\nrules:\n  - id: no-todo\n    mode: enforce\n    pattern: TODO\n`);
  const r = evaluate([fileAsChange("a.ts", "// TODO a\n// copal-ignore no-todo\n// TODO b")], p);
  assert.equal(r.findings.length, 1);
});

test("applicable rules depend on the path", () => {
  const { policy } = loadPolicy(APP);
  const web = applicableRules(policy, "src/web/x.ts").map((r) => r.id);
  const port = applicableRules(policy, "src/ports/x.ts").map((r) => r.id);
  assert.ok(web.includes("ui-no-persistence"));
  assert.ok(!port.includes("ui-no-persistence"));
  assert.ok(!port.includes("ledger-rounding"));
});
