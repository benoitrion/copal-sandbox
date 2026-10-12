import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parsePolicy, resolvePolicy, reviewerGuide, reviewerGuideToMarkdown } from "../src";
import type { FileChange, Finding } from "../src";

const f = (path: string, n = 10): FileChange => ({ path, status: "modified", addedLines: Array.from({ length: n }, (_, i) => ({ line: i + 1, text: "x" })) });

test("reviewer guide: tests first, risky files with reasons, low risk skimmed", () => {
  const policy = resolvePolicy(parsePolicy("version: 4\nrisk: [\"src/billing/**\"]\nrules: []\n"));
  const findings = [{ ruleId: "ledger-rounding", file: "src/orders/total.ts", line: 3 } as Finding];
  const g = reviewerGuide({
    files: [f("src/billing/invoice.ts"), f("src/orders/total.ts"), f("src/orders/total.test.ts"), f("src/ui/Page.tsx", 250), f("src/util/format.ts"), f("README.md"), f("package-lock.json", 900)],
    findings, policy, outOfScope: ["src/ui/Page.tsx"], briefUsed: true,
  });
  assert.deepEqual(g.tests, ["src/orders/total.test.ts"]);
  assert.deepEqual(g.risky.map((r) => r.path), ["src/billing/invoice.ts", "src/orders/total.ts", "src/ui/Page.tsx"]);
  assert.deepEqual(g.risky[2].reasons, ["outside the brief", "250 lines added"]);
  assert.deepEqual(g.rest, ["src/util/format.ts"]);
  assert.equal(g.lowRisk.length, 2);
  const md = reviewerGuideToMarkdown(g);
  assert.match(md, /Read first:.*task brief.*the tests/);
  assert.match(md, /risk path \(src\/billing\/\*\*\)/);
});

test("reviewer guide: no test changed is called out", () => {
  assert.match(reviewerGuideToMarkdown(reviewerGuide({ files: [f("src/a.ts")] })), /no test changed/);
});
