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
async function check(group, name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ group, name, ok: true, ms: Date.now() - t0, detail: detail ?? "" });
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    results.push({ group, name, ok: false, ms: Date.now() - t0, detail: e.message });
    console.log(`  ✖ ${name} — ${e.message}`);
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
  assert(s.projects.includes("billing-api"), "billing-api not loaded");
  return `workspace ${s.workspace}, ${s.controls} controls`;
});
await check("contract", "billing-api policy on the server = repo .copalrules", async () => {
  const p = await api("GET", "/v1/projects/billing-api/policy?file=src/web/invoice-controller.ts");
  const server = p.policy.rules.map((r) => `${r.id}:${r.mode}`).sort();
  const local = policy.rules.map((r) => `${r.id}:${r.mode}`).sort();
  assert(JSON.stringify(server) === JSON.stringify(local), `rules differ: server [${server}] vs repo [${local}]`);
  assert(p.applicable.some((r) => r.id === "ui-no-persistence"), "applicable rules for src/web must include ui-no-persistence");
  return `v${p.version}, ${server.length} rules`;
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
const summary = `${results.length - failed.length}/${results.length} passed`;
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
    ...results.map((r) => `| ${r.ok ? "✅" : "❌"} | ${r.name} | ${(r.detail || "").replace(/\n/g, "<br>").replace(/\|/g, "\\|")} |`),
  ];
  fs.writeFileSync(mdOut, lines.join("\n") + "\n");
}
process.exit(failed.length ? 1 : 0);
