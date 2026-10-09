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
