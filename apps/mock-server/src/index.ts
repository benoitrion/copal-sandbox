#!/usr/bin/env node
/**
 * Copal mock backend.
 *  - Copal public API  (/v1/*)        — what the CLI, MCP server, IDE extension and git app talk to
 *  - Fake GitHub API   (/github/*)    — enough REST for the PR check to post reviews & statuses
 *  - Fake GitLab API   (/gitlab/api/v4/*)
 *  - Console           (/)            — analyses, findings, drift, PR timeline
 *
 * Usage: node dist/src/index.js [--port 4010] [--project ../../examples/billing-api] [--persist data/state.json]
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import {
  applicableRules,
  evaluate,
  FileChange,
  parsePolicy,
  redact,
  resolvePolicy,
  rulesToGuidance,
  toYaml,
  validatePolicy,
  fileAsChange,
} from "@copal/core";
import { Ctx, HttpError, Router } from "./http";
import { DEV_KEY, Store } from "./store";
import { registerFakeGit } from "./fake-git";
import { consoleHtml } from "./console";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : process.env[`COPAL_MOCK_${name.toUpperCase()}`] ?? def;
}

const port = Number(arg("port", "4010"));
const store = new Store(arg("persist"));
const router = new Router();

function upsertProject(name: string, yaml: string, baseDir = process.cwd()) {
  const parsed = parsePolicy(yaml);
  const policy = resolvePolicy(parsed, baseDir);
  const issues = validatePolicy(policy);
  if (issues.length) throw new HttpError(422, "invalid policy: " + issues.map((i) => `${i.ruleId ?? ""} ${i.message}`).join("; "));
  const prev = store.state.projects[name];
  store.state.projects[name] = { name, yaml, policy, updatedAt: new Date().toISOString(), version: (prev?.version ?? 0) + 1 };
  store.save();
  return store.state.projects[name];
}

// Seed projects from --project dirs (comma separated)
for (const dir of (arg("project", path.resolve(__dirname, "../../../../examples/billing-api")) ?? "").split(",").filter(Boolean)) {
  const f = path.join(path.resolve(dir), ".copalrules");
  if (fs.existsSync(f)) {
    const yaml = fs.readFileSync(f, "utf8");
    const name = parsePolicy(yaml).project ?? path.basename(path.resolve(dir));
    upsertProject(name, yaml, path.dirname(f));
    console.log(`seeded project "${name}" from ${f}`);
  }
}

const auth = (ctx: Ctx) => {
  const p = new URL(ctx.req.url ?? "/", "http://x").pathname;
  if (!p.startsWith("/v1/") || p === "/v1/keys") return;
  const key = (ctx.req.headers["x-api-key"] as string) ?? ctx.query.get("key") ?? undefined;
  if (!store.validKey(key)) throw new HttpError(401, "missing or invalid x-api-key (dev key: copal_dev_local)");
};

function projectOr404(name: string) {
  const p = store.state.projects[name];
  if (!p) throw new HttpError(404, `unknown project "${name}"`);
  return p;
}

// ------------------------------------------------------------------ documented endpoints
router.get("/v1/status", () => ({
  workspace: store.state.workspace,
  plan: "team (mock)",
  projects: Object.keys(store.state.projects),
  controls: Object.values(store.state.projects).reduce((n, p) => n + p.policy.rules.length, 0),
  serverTime: new Date().toISOString(),
}));

router.post("/v1/keys", ({ body }) => ({ key: store.newKey(body?.name ?? "device") }));

router.post("/v1/plan", ({ body }) => {
  const story: string = body?.story ?? "";
  const project = body?.project ? projectOr404(body.project) : undefined;
  const rules = project ? applicableRules(project.policy, undefined) : [];
  return {
    story,
    steps: [
      "Locate the module that owns this behaviour (respect layering: web → service → port).",
      "Write or update the contract test first.",
      "Implement behind the existing port; do not add dependencies outside the approved list.",
      "Run `copal check --staged` before committing.",
    ],
    constraints: rules.filter((r) => r.mode === "enforce").map((r) => `${r.id}: ${r.why ?? r.message ?? ""}`),
  };
});

router.get("/v1/suggestions", ({ query }) => {
  const project = query.get("project") ?? Object.keys(store.state.projects)[0];
  const m = store.metrics(project);
  return {
    project,
    suggestions: m.drift.slice(0, 3).map((d) => ({
      ruleId: d.ruleId,
      text: `"${d.ruleId}" triggered ${d.count}× recently${d.falsePositives ? ` (${d.falsePositives} marked false positive — consider refining it)` : ""}.`,
    })),
  };
});

router.post("/v1/mentor", ({ body }) => {
  const project = body?.project ? store.state.projects[body.project] : Object.values(store.state.projects)[0];
  const snippet: string = body?.snippet ?? "";
  const file: string = body?.file ?? "snippet.ts";
  const red = redact(snippet, project?.policy);
  const report = project ? evaluate([fileAsChange(file, snippet)], project.policy) : undefined;
  return {
    guidance: project ? rulesToGuidance(applicableRules(project.policy, file), file) : "No project policy.",
    findings: report?.findings ?? [],
    redactedSnippet: red.text,
    redactions: red.redactions,
  };
});

router.post("/v1/sessions", ({ body }) => {
  store.state.sessions.push({ at: new Date().toISOString(), agent: body?.agent ?? "unknown", ...body });
  store.save();
  return { ok: true };
});

router.post("/v1/heartbeats", ({ body }) => {
  store.state.heartbeats += Array.isArray(body?.heartbeats) ? body.heartbeats.length : 0;
  return { ok: true, total: store.state.heartbeats };
});

// ------------------------------------------------------------------ policy & analysis (mock extensions)
router.get("/v1/projects", () => Object.values(store.state.projects).map(({ name, version, updatedAt, policy }) => ({ name, version, updatedAt, rules: policy.rules.length })));

router.get("/v1/projects/:name/policy", ({ params, query }) => {
  const p = projectOr404(params.name);
  const file = query.get("file") ?? undefined;
  const env = query.get("environment") ?? "local";
  return { project: p.name, version: p.version, yaml: p.yaml, policy: p.policy, applicable: file ? applicableRules(p.policy, file, env) : undefined, resolvedYaml: toYaml(p.policy) };
});

router.put("/v1/projects/:name/policy", ({ params, body, rawBody }) => {
  const yaml = typeof body?.yaml === "string" ? body.yaml : rawBody;
  const p = upsertProject(params.name, yaml);
  return { project: p.name, version: p.version, rules: p.policy.rules.length };
});

router.post("/v1/analyze", ({ body }) => {
  if (!Array.isArray(body?.files)) throw new HttpError(400, "files[] required");
  const name: string = body.project ?? (body.policyText ? parsePolicy(body.policyText).project : undefined) ?? "default";
  // The repository's own .copalrules wins (project-owned policy); otherwise the console copy.
  const project = body.policyText ? upsertProject(name, body.policyText) : projectOr404(name);
  const report = evaluate(body.files as FileChange[], project.policy, { environment: body.environment });
  const a = store.addAnalysis({ ...report, project: name, source: body.source ?? "branch", ref: body.ref, title: body.title, author: body.author, agent: body.agent });
  return { ...report, analysisId: a.id, project: name };
});

router.get("/v1/analyses", ({ query }) => {
  const project = query.get("project");
  const limit = Number(query.get("limit") ?? 50);
  return store.state.analyses.filter((a) => !project || a.project === project).slice(0, limit);
});

router.get("/v1/analyses/:id", ({ params }) => {
  const a = store.state.analyses.find((x) => x.id === params.id);
  if (!a) throw new HttpError(404, "unknown analysis");
  return a;
});

router.post("/v1/analyses/:id/feedback", ({ params, body }) => {
  const a = store.state.analyses.find((x) => x.id === params.id);
  if (!a) throw new HttpError(404, "unknown analysis");
  a.feedback.push({ ruleId: body?.ruleId, verdict: body?.verdict ?? "false-positive", note: body?.note, at: new Date().toISOString() });
  store.save();
  return { ok: true };
});

router.get("/v1/metrics", ({ query }) => store.metrics(query.get("project") ?? undefined));

// ------------------------------------------------------------------ console
router.get("/console/api/state", () => ({
  status: { workspace: store.state.workspace, projects: Object.keys(store.state.projects) },
  metrics: store.metrics(),
  analyses: store.state.analyses.slice(0, 100),
  projects: Object.values(store.state.projects).map((p) => ({ name: p.name, version: p.version, yaml: p.yaml, rules: p.policy.rules })),
  pulls: store.state.pulls,
  sessions: store.state.sessions.slice(-50),
}));
router.post("/console/api/reset", () => {
  store.state.analyses = [];
  store.state.pulls = [];
  store.state.sessions = [];
  store.save();
  return { ok: true };
});
router.get("/", () => consoleHtml());

registerFakeGit(router, store);

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
    return res.end();
  }
  router.handle(req, res, auth);
});
server.listen(port, () => {
  console.log(`Copal mock server on http://localhost:${port}`);
  console.log(`  console      http://localhost:${port}/`);
  console.log(`  api key      ${DEV_KEY}`);
  console.log(`  fake GitHub  http://localhost:${port}/github`);
  console.log(`  fake GitLab  http://localhost:${port}/gitlab/api/v4`);
});
