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
import * as crypto from "node:crypto";
import {
  applicableRules,
  buildBrief,
  containsCode,
  evaluate,
  kataSuggestions,
  navigatorQuestions,
  FileChange,
  parsePolicy,
  redact,
  resolvePolicy,
  rulesToGuidance,
  toYaml,
  validatePolicy,
  fileAsChange,
  nodePolicyLoader,
} from "@copal/core";
import { Ctx, HttpError, Router } from "./http";
import { DEV_KEY, HARDENED, Store } from "./store";
import { mountWebhooks } from "./webhooks";
import { registerFakeGit } from "./fake-git";
import { consoleHtml } from "./console";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : process.env[`COPAL_MOCK_${name.toUpperCase()}`] ?? def;
}

const port = Number(arg("port", process.env.PORT ?? "4010"));
const store = new Store(arg("persist"));
const router = new Router();

/**
 * `baseDir` is only passed for policies seeded from local disk. Policies received over HTTP get no file loader,
 * so `extends:` can only name builtin packs and a client can never make the server read local files.
 */
function upsertProject(name: string, yaml: string, baseDir?: string) {
  const parsed = parsePolicy(yaml);
  let policy;
  try {
    policy = baseDir ? resolvePolicy(parsed, baseDir, nodePolicyLoader) : resolvePolicy(parsed);
  } catch (e) {
    throw new HttpError(422, `invalid policy: ${(e as Error).message}`);
  }
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

/**
 * /v1/* needs a device key. When hardened (custom COPAL_MOCK_DEV_KEY or COPAL_MOCK_PROTECT=1, i.e. the mock is
 * reachable from the internet), minting keys and the console data API need a key too.
 */
const auth = (ctx: Ctx) => {
  const p = new URL(ctx.req.url ?? "/", "http://x").pathname;
  const needsKey = (p.startsWith("/v1/") && (p !== "/v1/keys" || HARDENED)) || (HARDENED && p.startsWith("/console/api/"));
  if (!needsKey) return;
  const key = (ctx.req.headers["x-api-key"] as string) ?? ctx.query.get("key") ?? undefined;
  if (!store.validKey(key)) throw new HttpError(401, HARDENED ? "missing or invalid x-api-key" : "missing or invalid x-api-key (dev key: copal_dev_local)");
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
  for (const k of ["tokens", "inputTokens", "outputTokens", "costUsd", "retries"])
    if (body?.[k] !== undefined && (typeof body[k] !== "number" || body[k] < 0)) throw new HttpError(400, `${k} must be a non-negative number`);
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

// ------------------------------------------------------------------ coaching (v4)
const projectPolicy = (name?: string) => (name ? store.state.projects[name]?.policy : Object.values(store.state.projects)[0]?.policy);

router.post("/v1/coach/reflect", ({ body }) => {
  if (typeof body?.task !== "string" || !body.task.trim()) throw new HttpError(400, "task required");
  const policy = projectPolicy(body.project);
  const s = navigatorQuestions(policy, redact(body.task, policy).text, { files: Array.isArray(body.files) ? body.files : undefined, force: !!body.force });
  // Questions must never carry the answer.
  const questions = s.questions.filter((q) => !containsCode(q.text));
  const id = "nav_" + crypto.randomBytes(5).toString("hex");
  store.state.navSessions[id] = { id, project: body.project, developer: body.developer, task: body.task, questions, createdAt: new Date().toISOString() };
  store.save();
  return { sessionId: id, engage: s.engage && questions.length > 0, reason: s.reason, questions };
});

router.post("/v1/coach/reflect/:id/answers", ({ params, body }) => {
  const s = store.state.navSessions[params.id];
  if (!s) throw new HttpError(404, "unknown navigator session");
  if (body?.answers !== undefined && !Array.isArray(body.answers)) throw new HttpError(400, "answers[] must be an array");
  const answers = (body?.answers ?? []).filter((a: { id?: string; text?: string }) => typeof a?.id === "string" && typeof a?.text === "string");
  const brief = buildBrief(projectPolicy(s.project), s.task, s.questions, answers, !!body?.skipped || answers.length === 0);
  s.answeredAt = new Date().toISOString();
  s.skipped = brief.skipped;
  store.save();
  return { brief };
});

const ACTIONS = ["shown", "ask", "explain", "show_me", "skipped", "answered"];
router.post("/v1/coach/events", ({ body, res }) => {
  const list = Array.isArray(body?.events) ? body.events : [body];
  for (const e of list) {
    if (!e?.ruleId || typeof e.levelReached !== "number" || e.levelReached < 0 || e.levelReached > 4 || !ACTIONS.includes(e.action))
      throw new HttpError(422, `invalid event: need ruleId, levelReached 0-4 and action in ${ACTIONS.join("|")}`);
    store.state.coachEvents.push({ ...e, source: e.source ?? "ide", at: e.at ?? new Date().toISOString() });
  }
  store.state.coachEvents = store.state.coachEvents.slice(-20000);
  store.save();
  res.writeHead(204, { "access-control-allow-origin": "*" }).end();
  return undefined;
});

router.get("/v1/growth", ({ query }) => store.growth(query.get("project") ?? undefined, query.get("developer") ?? undefined, query.get("since") ?? undefined));

router.get("/v1/katas", ({ query }) => {
  const project = query.get("project") ?? undefined;
  const policy = projectPolicy(project);
  const occ = store.state.coachEvents
    .filter((e) => e.action === "shown" && (!project || e.project === project))
    .map((e) => ({ ruleId: e.ruleId, developer: e.developer, at: e.at }));
  return { katas: store.state.katas, suggestions: policy ? kataSuggestions(policy, occ) : [] };
});

router.post("/v1/katas", ({ body }) => {
  if (!body?.title || !body?.url) throw new HttpError(400, "title and url required");
  const k = {
    id: "k_" + crypto.randomBytes(4).toString("hex"),
    kind: "canonical" as const,
    title: String(body.title),
    url: String(body.url),
    source: body.source,
    license: body.license,
    rules: Array.isArray(body.rules) ? body.rules : [],
    minutes: body.minutes,
    level: body.level,
    learningHour: body.learningHour,
    completions: [],
  };
  store.state.katas.push(k);
  store.save();
  return k;
});

/** Micro-kata from a finding: the snippet that broke the rule, one failing test, ten minutes. Never merged. */
router.post("/v1/katas/generate", ({ body }) => {
  const a = store.state.analyses.find((x) => x.findings.some((f, i) => `${x.id}:${i}` === body?.findingId || (x.id === body?.analysisId && f.ruleId === body?.ruleId)));
  const idx = a ? a.findings.findIndex((f, i) => `${a.id}:${i}` === body?.findingId || f.ruleId === body?.ruleId) : -1;
  const f = a && idx >= 0 ? a.findings[idx] : undefined;
  if (!f) throw new HttpError(404, "unknown finding (use findingId '<analysisId>:<index>' or analysisId + ruleId)");
  const q = f.coach?.question ?? `How would you remove the ${f.ruleId} finding while keeping the behaviour?`;
  const k = {
    id: "mk_" + crypto.randomBytes(4).toString("hex"),
    kind: "micro" as const,
    title: `Micro-kata: ${f.ruleId} in ${f.file}`,
    project: a!.project,
    rules: [f.ruleId],
    minutes: 10,
    level: "practice",
    learningHour: f.coach?.learningHour,
    snippet: `// ${f.file}:${f.line}\n// ${f.message}`,
    failingTest: `test("${f.ruleId}: the behaviour stays the same and the rule no longer fires", () => {\n  // 1. pin the current behaviour (approval / characterisation test)\n  // 2. refactor until \`copal check\` is clean\n  throw new Error("write me first");\n});`,
    instructions: `${q}\n\nWork in a scratch branch. First pin the behaviour with a test, then change the design in small steps, running the test after each. Compare with the team reference when done. This is practice — it is not merged.`,
    url: f.coach?.kata,
    completions: [],
  };
  store.state.katas.push(k);
  store.save();
  return k;
});

router.post("/v1/katas/:id/complete", ({ params, body, res }) => {
  const k = store.state.katas.find((x) => x.id === params.id);
  if (!k) throw new HttpError(404, "unknown kata");
  k.completions.push({ at: new Date().toISOString(), developer: body?.developer });
  store.save();
  res.writeHead(204, { "access-control-allow-origin": "*" }).end();
  return undefined;
});

router.get("/v1/rules/health", ({ query }) => {
  const project = query.get("project") ?? Object.keys(store.state.projects)[0];
  return store.ruleHealth(project, store.state.projects[project]?.policy, Number(query.get("days") ?? 30));
});
router.get("/v1/reach", ({ query }) => store.reach(query.get("project") ?? undefined));

router.get("/v1/usage", ({ query }) => store.usage(query.get("project") ?? undefined, query.get("since") ?? undefined));

// ------------------------------------------------------------------ console
router.get("/console/api/state", () => ({
  status: { workspace: store.state.workspace, projects: Object.keys(store.state.projects) },
  metrics: store.metrics(),
  analyses: store.state.analyses.slice(0, 100),
  projects: Object.values(store.state.projects).map((p) => ({ name: p.name, version: p.version, yaml: p.yaml, rules: p.policy.rules })),
  pulls: store.state.pulls,
  sessions: store.state.sessions.slice(-50),
  growth: store.growth(),
  usage: store.usage(),
  katas: store.state.katas,
}));
router.post("/console/api/reset", () => {
  store.state.analyses = [];
  store.state.pulls = [];
  store.state.sessions = [];
  store.state.coachEvents = [];
  store.state.navSessions = {};
  store.save();
  return { ok: true };
});
router.get("/", () => consoleHtml());
router.get("/healthz", () => ({ ok: true, projects: Object.keys(store.state.projects).length }));

registerFakeGit(router, store);
const webhooks = mountWebhooks(router, port, DEV_KEY);

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
  console.log(`  api key      ${HARDENED ? "(COPAL_MOCK_DEV_KEY)" : DEV_KEY}`);
  console.log(`  fake GitHub  http://localhost:${port}/github`);
  console.log(`  fake GitLab  http://localhost:${port}/gitlab/api/v4`);
  console.log(`  webhooks     ${webhooks}`);
});
