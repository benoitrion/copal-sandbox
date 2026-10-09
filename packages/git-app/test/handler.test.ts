import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { verifyGitHubSignature, verifyGitLabToken, handleWebhook } from "../src/handler";

test("GitHub HMAC signature verification", () => {
  const body = '{"a":1}';
  const sig = "sha256=" + crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.ok(verifyGitHubSignature("s3cret", body, sig));
  assert.ok(!verifyGitHubSignature("s3cret", body + " ", sig));
  assert.ok(!verifyGitHubSignature("s3cret", body, undefined));
  assert.ok(verifyGitHubSignature(undefined, body, undefined), "no secret configured → accept (dev only)");
});

test("GitLab token verification", () => {
  assert.ok(verifyGitLabToken("t", "t"));
  assert.ok(!verifyGitLabToken("t", "x"));
  assert.ok(!verifyGitLabToken("t", undefined));
});

test("irrelevant events are ignored without network calls", async () => {
  assert.equal(await handleWebhook({ provider: "github", event: "ping", payload: {} }), "pong");
  assert.equal(await handleWebhook({ provider: "github", event: "pull_request", payload: { action: "closed", repository: { full_name: "a/b" } } }), "ignored pull_request/closed");
  assert.equal(await handleWebhook({ provider: "gitlab", event: "Merge Request Hook", payload: { object_attributes: { action: "update" }, project: { id: 1 } } }), "ignored MR action update");
});

test("PR summary lists what goes beyond .copal/brief.md (never changes the status)", async () => {
  const { runCheck } = require("../src/handler");
  const brief = "# Task: Add VAT to invoice totals\n\nScope in: the total calculation in src/invoice\nScope out: the PDF\n\n## Examples\n- [ ] 100 EUR net (BE) → 121 EUR gross\n";
  const file = (path: string, text: string) => ({ path, status: "added", addedLines: [{ line: 1, text }] });
  const run = async (files: unknown[], findings: unknown[] = []) => {
    const posted: { review?: string; comments: string[]; status?: string } = { comments: [] };
    const provider = {
      name: "github",
      label: "acme/billing-api#9",
      load: async () => ({ files, headSha: "abc", title: "VAT", author: "ana", policyText: "version: 4\nrules: []\n", briefText: brief, ref: "acme/billing-api#9" }),
      setStatus: async (_s: string, state: string) => void (posted.status = state),
      postReview: async (_s: string, _r: unknown, _f: unknown, extra?: string) => void (posted.review = extra ?? ""),
      comment: async (b: string) => void posted.comments.push(b),
    };
    const client = { analyze: async () => ({ findings, blocking: false, summary: { blocking: 0, audit: findings.length }, environment: "ci", mode: "local" }) };
    await runCheck(provider, client);
    return posted;
  };
  const beyond = await run([file("src/invoice/vat.ts", "export function vatFor() {}"), file("src/web/settings-page.ts", "export function renderSettingsPage() {}")]);
  assert.equal(beyond.status, "success");
  assert.equal(beyond.comments.length, 1);
  assert.match(beyond.comments[0], /Not in the brief: src\/web\/settings-page\.ts — keep it\?/);
  const vatOnly = await run([file("src/invoice/vat.ts", "export function vatFor() {}")]);
  assert.deepEqual(vatOnly.comments, []);
  const withFinding = await run([file("src/web/settings-page.ts", "export function renderSettingsPage() {}")], [{ ruleId: "x", file: "src/web/settings-page.ts", line: 1 }]);
  assert.match(withFinding.review!, /Not in the brief/);
});

test("PR check adds a tests-first audit question when code was committed before its test", async () => {
  const { runCheck } = require("../src/handler");
  const policyText = 'version: 4\nrules:\n  - id: invoice-contract-test\n    category: testing\n    mode: enforce\n    paths: ["src/invoice/*.ts"]\n    requireTest:\n      test: "src/invoice/{name}.test.ts"\n';
  const run = async (commits: { sha: string; files: string[] }[]) => {
    let findings: { ruleId: string; blocking: boolean; message: string }[] = [];
    let status = "";
    const provider = {
      name: "github",
      label: "acme/billing-api#10",
      load: async () => ({ files: [], headSha: "abc", title: "VAT", author: "ana", policyText, ref: "acme/billing-api#10" }),
      commits: async () => commits,
      setStatus: async (_s: string, state: string) => void (status = state),
      postReview: async (_s: string, r: { findings: typeof findings }) => void (findings = r.findings),
      comment: async () => undefined,
    };
    const client = { analyze: async () => ({ findings: [], blocking: false, summary: { total: 0, blocking: 0, audit: 0, byCategory: {} }, environment: "ci", mode: "local" }) };
    await runCheck(provider, client);
    return { findings, status };
  };
  const clean = await run([{ sha: "t1", files: ["src/invoice/vat.test.ts"] }, { sha: "c1", files: ["src/invoice/vat.ts"] }]);
  assert.deepEqual(clean.findings, []);
  const late = await run([{ sha: "c1aaaaa", files: ["src/invoice/vat.ts"] }, { sha: "t1bbbbb", files: ["src/invoice/vat.test.ts"] }]);
  assert.equal(late.findings.length, 1);
  assert.equal(late.findings[0].blocking, false);
  assert.match(late.findings[0].message, /written after the code\?/);
  assert.equal(late.status, "success", "audit only");
});

test("PR findings count as 'shown' hints for the PR author (growth), best effort", async () => {
  const { runCheck } = require("../src/handler");
  const sent: { developer?: string; source: string; action: string; ruleId: string; project?: string }[] = [];
  const provider = {
    name: "github",
    label: "acme/billing-api#11",
    load: async () => ({ files: [], headSha: "abc", title: "x", author: "ana", policyText: "version: 4\nproject: billing-api\nrules: []\n", ref: "acme/billing-api#11" }),
    setStatus: async () => undefined,
    postReview: async () => undefined,
    comment: async () => undefined,
  };
  const finding = { ruleId: "ledger-rounding", category: "architecture", file: "a.ts", line: 1, blocking: false, coach: { question: "Who owns rounding?" } };
  const client = {
    analyze: async () => ({ findings: [finding], blocking: false, summary: { total: 1, blocking: 0, audit: 1, byCategory: {} }, environment: "ci", mode: "local" }),
    coachEvents: async (e: typeof sent) => (sent.push(...e), true),
  };
  await runCheck(provider, client);
  assert.deepEqual(sent.map((e) => [e.developer, e.source, e.action, e.ruleId, e.project]), [["ana", "pr", "shown", "ledger-rounding", "billing-api"]]);
});
