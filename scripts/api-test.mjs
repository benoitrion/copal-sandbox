#!/usr/bin/env node
/**
 * Tests billing-api against a running Copal API (reference server, or any implementation of the /v1 contract).
 *
 *   COPAL_SERVER=https://… COPAL_API_KEY=… node scripts/api-test.mjs [--md report.md] [--no-writes]
 *
 * Every analysis the server returns is compared with the local engine (packages/core) on the same input,
 * so a server that drifts from the reference engine fails. Writes (analyses, feedback, a fake PR) are
 * recorded on the server and show up in its console. Requires `npm run build` first.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const core = require(path.join(ROOT, "packages/core/dist/src/index.js"));
const APP = path.join(ROOT, "examples/billing-api");
const SERVER = (process.env.COPAL_SERVER ?? "").replace(/\/$/, "");
const KEY = process.env.COPAL_API_KEY ?? "";
const mdOut = process.argv.includes("--md") ? process.argv[process.argv.indexOf("--md") + 1] : null;
const WRITES = !process.argv.includes("--no-writes");
const RUN = `api-test ${new Date().toISOString().slice(11, 19)}Z`;
if (!SERVER) {
  console.error("Set COPAL_SERVER (and COPAL_API_KEY).");
  process.exit(2);
}

// ------------------------------------------------------------------ tiny test harness
const results = [];
/** Thrown by a check that does not apply to this server (e.g. no fake GitHub outside the reference mock). */
class Skip extends Error {}
async function check(group, name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ group, name, ok: true, ms: Date.now() - t0, detail: detail ?? "" });
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    if (e instanceof Skip) {
      results.push({ group, name, ok: true, skipped: true, ms: Date.now() - t0, detail: `skipped: ${e.message}` });
      console.log(`  – ${name} — skipped: ${e.message}`);
    } else {
      results.push({ group, name, ok: false, ms: Date.now() - t0, detail: e.message });
      console.log(`  ✖ ${name} — ${e.message}`);
    }
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const group = (g) => console.log(`\n${g}`);

async function api(method, route, body, { key = KEY, raw = false } = {}) {
  const res = await fetch(SERVER + route, {
    method,
    headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return raw ? { status: res.status, json, text } : (() => {
    if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${text.slice(0, 160)}`);
    return json;
  })();
}

// ------------------------------------------------------------------ inputs
const policyText = fs.readFileSync(path.join(APP, ".copalrules"), "utf8");
const policy = core.resolvePolicy(core.parsePolicy(policyText));
function filesOf(dir, skip = () => false) {
  const out = [];
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p).split(path.sep).join("/");
      if (skip(rel)) return;
      if (e.isDirectory()) walk(p);
      else if (e.name !== "DESCRIPTION.md") out.push(core.fileAsChange(rel, fs.readFileSync(p, "utf8")));
    });
  walk(dir);
  return out;
}
const baseline = filesOf(APP, (rel) => rel === "scenarios" || rel === "node_modules" || rel.startsWith(".") || rel.endsWith(".md"));
const scenarios = fs.readdirSync(path.join(APP, "scenarios")).sort();
const norm = (findings) =>
  findings
    .map((f) => [f.ruleId, f.file, f.line, f.column ?? null, f.blocking, f.mode, f.message, f.suggestion?.replacement ?? null].join("|"))
    .sort();

// ------------------------------------------------------------------ tests
console.log(`Copal API test — ${SERVER} — ${RUN}`);
let analysisWithFinding;

group("Contract & auth");
await check("contract", "GET /healthz", async () => {
  const r = await api("GET", "/healthz", undefined, { key: "" });
  assert(r?.ok === true, "expected { ok: true }");
});
await check("contract", "GET /v1/status without key → 401 { error }", async () => {
  const r = await api("GET", "/v1/status", undefined, { key: "", raw: true });
  assert(r.status === 401, `got ${r.status}`);
  assert(typeof r.json?.error === "string", "error body must be { error: string }");
});
await check("contract", "GET /v1/status with a wrong key → 401", async () => {
  const r = await api("GET", "/v1/status", undefined, { key: "copal_wrong", raw: true });
  assert(r.status === 401, `got ${r.status}`);
});
await check("contract", "GET /v1/status", async () => {
  const s = await api("GET", "/v1/status");
  for (const k of ["workspace", "plan", "projects", "controls", "serverTime"]) assert(k in s, `missing ${k}`);
  assert(Array.isArray(s.projects), "projects must be an array");
  return `workspace ${s.workspace}, projects [${s.projects.join(", ")}], ${s.controls} controls`;
});
await check("contract", "billing-api policy on the server = repo .copalrules", async () => {
  const route = "/v1/projects/billing-api/policy?file=src/web/invoice-controller.ts";
  let uploaded = "";
  const first = await api("GET", route, undefined, { raw: true });
  if (first.status === 404 && WRITES) {
    // fresh workspace: upload the project-owned policy, as a client would on first use
    await api("PUT", "/v1/projects/billing-api/policy", { yaml: policyText });
    uploaded = " (was missing: uploaded from the repo)";
  } else if (first.status !== 200) throw new Error(`GET ${route} → ${first.status} ${first.text.slice(0, 160)}`);
  const p = uploaded ? await api("GET", route) : first.json;
  const server = p.policy.rules.map((r) => `${r.id}:${r.mode}`).sort();
  const local = policy.rules.map((r) => `${r.id}:${r.mode}`).sort();
  assert(JSON.stringify(server) === JSON.stringify(local), `rules differ: server [${server}] vs repo [${local}]`);
  assert(p.applicable.some((r) => r.id === "ui-no-persistence"), "applicable rules for src/web must include ui-no-persistence");
  return `v${p.version}, ${server.length} rules${uploaded}`;
});

group("billing-api source through POST /v1/analyze (compared with the local engine)");
await check("analyze", "current billing-api source is clean (env ci)", async () => {
  const r = await api("POST", "/v1/analyze", { project: "billing-api", environment: "ci", source: "branch", ref: "main", title: `${RUN} · billing-api main`, files: baseline, policyText });
  const local = core.evaluate(baseline, policy, { environment: "ci" });
  assert(JSON.stringify(norm(r.findings)) === JSON.stringify(norm(local.findings)), "server findings differ from the local engine");
  assert(r.findings.length === 0, `expected no findings, got ${r.findings.map((f) => f.ruleId)}`);
  assert(/^an_/.test(r.analysisId ?? ""), "missing analysisId");
  return `${baseline.length} files, 0 findings, ${r.analysisId}`;
});
for (const s of scenarios) {
  for (const environment of ["local", "ci"]) {
    await check("analyze", `scenario ${s} (${environment})`, async () => {
      const files = filesOf(path.join(APP, "scenarios", s));
      const r = await api("POST", "/v1/analyze", {
        project: "billing-api", environment, source: environment === "ci" ? "pr" : "precommit",
        ref: environment === "ci" ? `acme/billing-api#${900 + scenarios.indexOf(s)}` : "staged",
        title: `${RUN} · ${s}`, agent: "api-test", files, policyText,
      });
      const local = core.evaluate(files, policy, { environment });
      const a = norm(r.findings), b = norm(local.findings);
      assert(JSON.stringify(a) === JSON.stringify(b), `server ≠ engine\n      server: ${a.join("; ")}\n      engine: ${b.join("; ")}`);
      assert(r.blocking === local.blocking && r.summary.blocking === local.summary.blocking, "blocking summary differs");
      assert(!JSON.stringify(r).includes("AKIA4XQZ3P7Q2LM57Z2M"), "secret leaked in the response");
      if (!analysisWithFinding && r.findings.length) analysisWithFinding = { id: r.analysisId, ruleId: r.findings[0].ruleId };
      return `${r.summary.blocking} blocking, ${r.summary.audit} audit — ${[...new Set(r.findings.map((f) => f.ruleId))].join(", ") || "clean"}`;
    });
  }
}

group("Policy validation");
await check("policy", "PUT a rule with no check kind → 422", async () => {
  const r = await api("PUT", "/v1/projects/api-test-scratch/policy", { yaml: "version: 3\nrules:\n  - id: broken\n    mode: enforce\n" }, { raw: true });
  assert(r.status === 422 && /exactly one of/.test(r.json?.error ?? ""), `got ${r.status} ${r.text.slice(0, 120)}`);
});
await check("policy", "PUT a policy extending a server file → 422 (no file access)", async () => {
  const r = await api("PUT", "/v1/projects/api-test-scratch/policy", { yaml: "version: 3\nextends: [/etc/passwd]\nrules: []\n" }, { raw: true });
  assert(r.status === 422, `got ${r.status} ${r.text.slice(0, 120)}`);
});

group("Agent endpoints");
const total01 = fs.readFileSync(path.join(APP, "scenarios/01-invoice-rounding/src/invoice/total.ts"), "utf8");
await check("agent", "POST /v1/mentor redacts and returns findings", async () => {
  const m = await api("POST", "/v1/mentor", { project: "billing-api", file: "src/invoice/total.ts", snippet: total01 });
  assert(!m.redactedSnippet.includes("AKIA4XQZ3P7Q2LM57Z2M") && m.redactedSnippet.includes("[REDACTED:aws-access-key]"), "snippet not redacted");
  assert(m.findings.some((f) => f.ruleId === "ledger-rounding" && f.suggestion), "ledger-rounding with suggestion expected");
  return `${m.findings.length} findings, guidance ${m.guidance.split("\n").length} lines`;
});
await check("agent", "POST /v1/plan lists enforced constraints", async () => {
  const p = await api("POST", "/v1/plan", { project: "billing-api", story: "Preview an invoice total in USD" });
  assert(p.steps.length > 0 && p.constraints.some((c) => c.startsWith("ledger-rounding")), "plan missing ledger-rounding constraint");
  return `${p.steps.length} steps, ${p.constraints.length} constraints`;
});

group("Coaching (v4: navigator, hint ladder, katas, AI usage) — skipped on servers that predate it");
/** Calls a v4 endpoint; a 404 means the server hasn't implemented coaching yet → Skip, not failure. */
async function coachApi(method, route, body) {
  const r = await api(method, route, body, { raw: true });
  if (r.status === 404 && !/unknown (navigator session|kata|finding)/.test(r.text)) throw new Skip(`${method} ${route.split("?")[0]} not implemented yet`);
  if (r.status >= 400) throw new Error(`${method} ${route} → ${r.status} ${r.text.slice(0, 160)}`);
  return r;
}
let navSession;
await check("coach", "POST /v1/coach/reflect asks ≤ 3 code-free questions for a feature", async () => {
  const { json } = await coachApi("POST", "/v1/coach/reflect", { project: "billing-api", task: "Add VAT calculation to invoice totals for EU customers" });
  assert(typeof json.sessionId === "string" && json.sessionId, "sessionId missing");
  assert(Array.isArray(json.questions) && json.questions.length >= 1 && json.questions.length <= 3, `expected 1–3 questions, got ${json.questions?.length}`);
  for (const q of json.questions) {
    assert(["first-example", "placement", "risk"].includes(q.kind), `unknown question kind ${q.kind}`);
    assert(!core.containsCode(q.text), `question contains code: ${q.text}`);
  }
  navSession = json;
  return `${json.questions.length} questions (${json.questions.map((q) => q.kind).join(", ")})`;
});
await check("coach", "POST /v1/coach/reflect stays quiet for a small task", async () => {
  const { json } = await coachApi("POST", "/v1/coach/reflect", { project: "billing-api", task: "fix typo in README" });
  assert((json.questions ?? []).length === 0, "small tasks must not trigger the navigator");
  return "no questions";
});
await check("coach", "POST /v1/coach/reflect/:id/answers returns a test-first brief", async () => {
  if (!navSession) throw new Skip("no navigator session");
  const first = navSession.questions.find((q) => q.kind === "first-example") ?? navSession.questions[0];
  const { json } = await coachApi("POST", `/v1/coach/reflect/${navSession.sessionId}/answers`, { answers: [{ id: first.id, text: "100 EUR net in BE gives 121 EUR gross" }] });
  assert(json.brief && json.brief.firstTest === "100 EUR net in BE gives 121 EUR gross", "brief.firstTest must echo the developer's example");
  assert(Array.isArray(json.brief.edgeCases) && Array.isArray(json.brief.rules), "brief.edgeCases[] and brief.rules[] required");
  return `brief with ${json.brief.rules.length} rules`;
});
if (WRITES) {
  await check("coach", "POST /v1/coach/events records ladder steps; GET /v1/growth aggregates them", async () => {
    const ev = { project: "billing-api", developer: "api-test", ruleId: "ledger-rounding", category: "architecture", levelReached: 2, action: "explain", source: "cli" };
    const r = await coachApi("POST", "/v1/coach/events", ev);
    assert(r.status === 204 || r.status === 200, `expected 204, got ${r.status}`);
    const bad = await api("POST", "/v1/coach/events", { ...ev, levelReached: 9 }, { raw: true });
    assert(bad.status === 400 || bad.status === 422, `levelReached 9 must be rejected (got ${bad.status})`);
    const g = (await coachApi("GET", "/v1/growth?project=billing-api&developer=api-test")).json;
    const cat = (g.categories ?? []).find((c) => c.category === "architecture");
    assert(cat && Array.isArray(cat.weekly) && cat.weekly.length, "growth.categories[architecture].weekly expected");
    return `weekly median ${cat.weekly.at(-1).medianLevel}`;
  });
  await check("coach", "POST /v1/sessions accepts token fields; GET /v1/usage reports per merged change", async () => {
    await api("POST", "/v1/sessions", { agent: "api-test", project: "billing-api", inputTokens: 1200, outputTokens: 300, costUsd: 0.01, retries: 0, navigatorUsed: true });
    const u = (await coachApi("GET", "/v1/usage?project=billing-api")).json;
    for (const k of ["sessions", "mergedChanges", "tokensPerMergedChange", "withNavigator", "withoutNavigator"]) assert(k in u, `usage.${k} missing`);
    return `${u.sessions} sessions, ${u.tokensPerMergedChange ?? "–"} tokens/merged change`;
  });
}
await check("coach", "GET /v1/rules/health: hits, caught late, false positives and status per rule", async () => {
  const { json } = await coachApi("GET", "/v1/rules/health?project=billing-api&days=30");
  assert(Array.isArray(json.rules) && json.rules.length === policy.rules.length, `expected one row per rule (${policy.rules.length}), got ${json.rules?.length}`);
  for (const r of json.rules) {
    for (const k of ["ruleId", "hits", "trend", "caughtLate", "falsePositiveRate", "status"]) assert(k in r, `rule row missing ${k}`);
    assert(r.caughtLate === null || (r.caughtLate >= 0 && r.caughtLate <= 1), "caughtLate must be a share 0–1 or null");
  }
  const flagged = json.rules.filter((r) => r.status.length).map((r) => `${r.ruleId}:${r.status.join("+")}`);
  return flagged.slice(0, 3).join(", ") || "no rule needs attention";
});
if (WRITES) {
  await check("coach", "POST/GET /v1/rules/drafts: a review comment becomes a rule draft", async () => {
    const d = core.draftRuleFromReview({ text: "Don't call the payment provider from controllers, go through PaymentPort.", path: "src/web/checkout.ts", source: "https://github.com/o/r/pull/7#discussion_r1", author: "api-test" });
    const { json } = await coachApi("POST", "/v1/rules/drafts", { project: "billing-api", ...d.rule, text: "Don't call the payment provider from controllers, go through PaymentPort.", source: "https://github.com/o/r/pull/7#discussion_r1", author: "api-test" });
    assert(typeof json.id === "string", "draft id expected");
    const list = (await coachApi("GET", "/v1/rules/drafts?project=billing-api")).json;
    assert(Array.isArray(list) && list.some((x) => x.id === json.id), "draft not listed");
    return `draft ${json.id}`;
  });
}
await check("coach", "GET /v1/reach: last seen per surface", async () => {
  const { json } = await coachApi("GET", "/v1/reach?project=billing-api");
  for (const k of ["precommit", "prCheck", "agentSelfCheck", "agents", "navigator"]) assert(k in json, `reach.${k} missing`);
  return `pre-commit ${json.precommit.lastSeen ? "seen" : "not seen"}, PR check ${json.prCheck.lastSeen ? "seen" : "not seen"}`;
});
await check("coach", "GET /v1/katas lists credited canonical katas", async () => {
  const { json } = await coachApi("GET", "/v1/katas?project=billing-api");
  const list = Array.isArray(json) ? json : json.katas;
  assert(Array.isArray(list) && list.length, "katas expected");
  const canonical = list.filter((k) => k.url?.includes("sammancoaching.org"));
  assert(canonical.every((k) => k.license && k.source), "sammancoaching.org katas must carry source and licence (CC-BY-SA)");
  return `${list.length} katas, ${canonical.length} from sammancoaching.org`;
});

if (WRITES) {
  group("Feedback & evidence");
  await check("evidence", "false-positive feedback is counted in /v1/metrics", async () => {
    assert(analysisWithFinding, "no analysis with findings to give feedback on");
    const before = (await api("GET", "/v1/metrics?project=billing-api")).drift.find((d) => d.ruleId === analysisWithFinding.ruleId)?.falsePositives ?? 0;
    await api("POST", `/v1/analyses/${analysisWithFinding.id}/feedback`, { ruleId: analysisWithFinding.ruleId, verdict: "false-positive", note: RUN });
    const after = (await api("GET", "/v1/metrics?project=billing-api")).drift.find((d) => d.ruleId === analysisWithFinding.ruleId)?.falsePositives ?? 0;
    assert(after === before + 1, `falsePositives ${before} → ${after}`);
    return `${analysisWithFinding.ruleId}: ${before} → ${after}`;
  });
  await check("evidence", "analyses are listed newest first", async () => {
    const list = await api("GET", "/v1/analyses?project=billing-api&limit=5");
    assert(list.length > 0 && list[0].title?.startsWith("api-test"), "latest analysis is not from this run");
    assert(list.every((a, i) => i === 0 || a.createdAt <= list[i - 1].createdAt), "not sorted newest first");
  });

  group("Real clients: CLI pre-commit hook and PR check");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "copal-api-test-"));
  const g = (...a) => execFileSync("git", a, { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const cli = (args, env = {}) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [path.join(ROOT, "packages/cli/dist/src/index.js"), ...args], { cwd: work, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", HOME: work, ...env }, stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) {
      return { code: e.status, out: (e.stdout ?? "") + (e.stderr ?? "") };
    }
  };
  fs.cpSync(APP, work, { recursive: true, filter: (s) => !/[\\/](scenarios|node_modules|\.data)([\\/]|$)/.test(s) });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "api-test");
  g("config", "user.email", "api-test@example.com");
  g("add", "-A");
  g("commit", "-qm", "baseline");
  await check("clients", "copal check --all --env ci → clean, recorded on the server", async () => {
    const r = cli(["check", "--all", "--env", "ci"]);
    assert(r.code === 0, `exit ${r.code}: ${r.out.slice(0, 200)}`);
    const id = /server analysis (an_\w+)/.exec(r.out)?.[1];
    assert(id, `not recorded on the server (fell back to local?): ${r.out.slice(-160)}`);
    return id;
  });
  await check("clients", "pre-commit blocks scenario 02 (UI → persistence)", async () => {
    g("checkout", "-qb", "feat/api-test-ui-to-db");
    fs.cpSync(path.join(APP, "scenarios/02-ui-to-db/src"), path.join(work, "src"), { recursive: true });
    g("add", "-A");
    const r = cli(["check", "--staged"], { COPAL_AGENT: "api-test" });
    assert(r.code === 1 && r.out.includes("[ui-no-persistence]"), `exit ${r.code}: ${r.out.slice(0, 200)}`);
    g("commit", "-qm", "feat: faster invoice listing (api-test)");
    return /server analysis (an_\w+)/.exec(r.out)?.[1] ?? "";
  });
  await check("clients", "PR webhook: GitHub PR gets failure status + inline review", async () => {
    // Only the reference server embeds a fake GitHub to simulate PRs against; real PR checks run in GitHub
    // (see benoitrion/billing-api). Probe with a ping before simulating.
    const ping = await fetch(SERVER + "/webhooks/github", { method: "POST", headers: { "content-type": "application/json", "x-github-event": "ping", "x-copal-wait": "1" }, body: "{}" }).catch(() => null);
    const pong = ping && ping.ok ? await ping.text() : "";
    if (!pong.includes("pong")) throw new Skip("this server has no /webhooks/github endpoint (PR checks can run in GitHub Actions instead)");
    const number = 7000 + Math.floor(Math.random() * 999);
    const out = execFileSync(process.execPath, [path.join(ROOT, "packages/git-app/dist/src/server.js"), "simulate", "--provider", "github", "--dir", work,
      "--base", "main", "--head", "HEAD", "--repo", "acme/billing-api", "--number", String(number), "--app", SERVER, "--mock", SERVER, "--title", `${RUN} · UI→DB PR`],
      { encoding: "utf8", env: { ...process.env } });
    assert(/→ 200/.test(out), out.trim());
    return `acme/billing-api#${number}: ${out.trim().split("→ ")[1]?.slice(0, 60)}`;
  });
  fs.rmSync(work, { recursive: true, force: true });
}

// ------------------------------------------------------------------ report
const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped);
const summary = `${results.length - failed.length - skipped.length}/${results.length - skipped.length} passed${skipped.length ? `, ${skipped.length} skipped` : ""}`;
console.log(`\n${failed.length ? "✖" : "✔"} ${summary}`);
if (mdOut) {
  const host = new URL(SERVER).host;
  const lines = [
    `## ${failed.length ? "❌" : "✅"} billing-api × Copal API — ${summary}`,
    "",
    `Server \`${host}\` · run ${RUN} · writes ${WRITES ? "on" : "off"}`,
    "",
    "| | Check | Result |",
    "|---|---|---|",
    ...results.map((r) => `| ${r.skipped ? "➖" : r.ok ? "✅" : "❌"} | ${r.name} | ${(r.detail || "").replace(/\n/g, "<br>").replace(/\|/g, "\\|")} |`),
  ];
  fs.writeFileSync(mdOut, lines.join("\n") + "\n");
}
process.exit(failed.length ? 1 : 0);
