#!/usr/bin/env node
/**
 * Copal Git provider app — receives GitHub / GitLab webhooks, analyzes every PR/MR diff and
 * publishes native inline findings, a summary and a required status check.
 *
 *   copal-git-app serve      (default)  webhook server on $PORT (4020)
 *   copal-git-app simulate   ...        register a PR in the mock backend from a local git repo and fire the webhook
 */
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as http from "node:http";
import { handleWebhook, verifyGitHubSignature, verifyGitLabToken } from "./handler";

function serve() {
  const port = Number(process.env.PORT ?? 4020);
  const server = http.createServer(async (req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/healthz") return reply(200, { ok: true });
    if (req.method !== "POST") return reply(404, { error: "not found" });
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");

    let provider: "github" | "gitlab";
    let event: string;
    if (req.url?.startsWith("/webhooks/github")) {
      provider = "github";
      event = String(req.headers["x-github-event"] ?? "");
      if (!verifyGitHubSignature(process.env.GITHUB_WEBHOOK_SECRET, raw, req.headers["x-hub-signature-256"] as string)) return reply(401, { error: "bad signature" });
    } else if (req.url?.startsWith("/webhooks/gitlab")) {
      provider = "gitlab";
      event = String(req.headers["x-gitlab-event"] ?? "");
      if (!verifyGitLabToken(process.env.GITLAB_WEBHOOK_SECRET, req.headers["x-gitlab-token"] as string)) return reply(401, { error: "bad token" });
    } else return reply(404, { error: "unknown webhook path" });

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return reply(400, { error: "invalid JSON" });
    }
    const job = handleWebhook({ provider, event, payload });
    // Providers expect a fast answer: reply 202 and work in the background, unless the caller asks to wait.
    if (req.headers["x-copal-wait"]) {
      try {
        reply(200, { result: await job });
      } catch (e) {
        reply(500, { error: (e as Error).message });
      }
    } else {
      reply(202, { accepted: true });
      job.then((r) => console.log(`[copal-git-app] ${provider} ${event}: ${r}`)).catch((e) => console.error(`[copal-git-app] ${provider} ${event} failed:`, e.message));
    }
  });
  server.listen(port, () => {
    console.log(`Copal git app listening on http://localhost:${port}`);
    console.log(`  GitHub webhook: POST /webhooks/github   (api ${process.env.GITHUB_API_URL ?? "https://api.github.com"})`);
    console.log(`  GitLab webhook: POST /webhooks/gitlab   (api ${process.env.GITLAB_API_URL ?? "https://gitlab.com/api/v4"})`);
  });
}

function flag(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function simulate() {
  const provider = (flag("provider", "github") as "github" | "gitlab")!;
  const dir = flag("dir", process.cwd())!;
  const repo = flag("repo", "acme/billing-api")!;
  const number = Number(flag("number", "1"));
  const base = flag("base", "main")!;
  const head = flag("head", "HEAD")!;
  const mock = flag("mock", process.env.COPAL_MOCK_URL ?? "http://localhost:4010")!.replace(/\/$/, "");
  const app = flag("app", "http://localhost:4020")!.replace(/\/$/, "");
  const comment = flag("comment");
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", maxBuffer: 64 << 20 });

  const headSha = g("rev-parse", head).trim();
  const baseSha = g("merge-base", base, head).trim();
  const title = flag("title") ?? g("log", "-1", "--format=%s", headSha).trim();
  const author = flag("author") ?? g("log", "-1", "--format=%an", headSha).trim();
  const diff = g("diff", "--no-color", `${baseSha}...${headSha}`);
  const files: Record<string, string> = {};
  for (const p of [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]).concat(".copalrules")) {
    try {
      files[p] = g("show", `${headSha}:${p}`);
    } catch {
      /* deleted or absent */
    }
  }
  const sim = await fetch(`${mock}/${provider}/_sim/pulls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo, number, title, author, headSha, baseSha, diff, files }),
  });
  if (!sim.ok) throw new Error(`mock backend: ${sim.status} ${await sim.text()}`);

  const action = flag("action", "opened")!;
  let event: string;
  let payload: unknown;
  if (provider === "github") {
    event = comment ? "issue_comment" : "pull_request";
    payload = comment
      ? { action: "created", issue: { number, pull_request: {} }, comment: { body: comment }, repository: { full_name: repo } }
      : { action, number, pull_request: { number, title, head: { sha: headSha }, base: { sha: baseSha }, draft: false }, repository: { full_name: repo } };
  } else {
    event = comment ? "Note Hook" : "Merge Request Hook";
    payload = comment
      ? { object_kind: "note", object_attributes: { note: comment }, merge_request: { iid: number }, project: { path_with_namespace: repo } }
      : { object_kind: "merge_request", object_attributes: { iid: number, action: action === "synchronize" ? "update" : "open", oldrev: action === "synchronize" ? baseSha : undefined, title }, project: { path_with_namespace: repo } };
  }
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json", "x-copal-wait": "1" };
  if (provider === "github") {
    headers["x-github-event"] = event;
    if (process.env.GITHUB_WEBHOOK_SECRET) headers["x-hub-signature-256"] = "sha256=" + crypto.createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET).update(body).digest("hex");
  } else {
    headers["x-gitlab-event"] = event;
    if (process.env.GITLAB_WEBHOOK_SECRET) headers["x-gitlab-token"] = process.env.GITLAB_WEBHOOK_SECRET;
  }
  const res = await fetch(`${app}/webhooks/${provider}`, { method: "POST", headers, body });
  console.log(`${provider} ${event} ${repo}${provider === "github" ? "#" : "!"}${number} @ ${headSha.slice(0, 7)} → ${res.status} ${await res.text()}`);
  if (!res.ok) process.exitCode = 1;
}

const cmd = process.argv[2];
if (cmd === "simulate") simulate().catch((e) => (console.error(e.message), process.exit(1)));
else if (!cmd || cmd === "serve") serve();
else {
  console.error("usage: copal-git-app [serve] | simulate --provider github|gitlab --dir REPO --base main --head BRANCH [--repo o/r] [--number N] [--action opened|synchronize] [--comment '/copal fp rule']");
  process.exit(2);
}
