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
