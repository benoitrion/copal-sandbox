#!/usr/bin/env node
/**
 * Copal MCP server — gives coding agents the project's applicable rules before they write code,
 * lets them self-check a draft, and redacts restricted context.
 *
 * Config (env): COPAL_PROJECT_DIR (default cwd), COPAL_ENV (default local), COPAL_SERVER, COPAL_API_KEY.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { applicableRules, briefToText, evaluate, fileAsChange, formatReport, hintCard, parseUnifiedDiff, redact, rulesToGuidance, toYaml, effectiveRules, NavigatorQuestion } from "@copal/core";
import { CopalClient, loadConfig, loadRepoPolicy } from "@copal/client";
import { McpServer, text } from "./protocol";

const projectDir = path.resolve(process.env.COPAL_PROJECT_DIR ?? process.cwd());
const defaultEnv = process.env.COPAL_ENV ?? "local";
const client = new CopalClient(loadConfig());
const log = (...a: unknown[]) => process.stderr.write(`[copal-mcp] ${a.join(" ")}\n`);
const stats = { checks: 0, findings: 0, startedAt: Date.now() };

/** Re-read the policy on every call so edits to .copalrules apply immediately. */
const repo = () => loadRepoPolicy(projectDir);

/** Paths from agents may be absolute or relative to the project. */
const rel = (p: string) => {
  const abs = path.resolve(projectDir, p);
  return path.relative(repo().root, abs).split(path.sep).join("/");
};

const server = new McpServer(
  { name: "copal", version: "0.2.0" },
  `Copal is the team's technical coach. You are the driver; the developer is the navigator. ` +
    `For any feature-sized task, call copal_reflect FIRST and ask the developer its questions (verbatim, numbered, in one message), wait for their answers, then call copal_brief and follow the brief: first failing test, small steps, code where the developer said. ` +
    `Before creating or editing a file, call copal_get_rules with its path and follow the ENFORCED rules. After drafting, call copal_check_code (or copal_check_staged before committing). ` +
    `When a finding carries a question, relay the question to the developer instead of silently fixing it — unless they asked you to just fix it. Never paste secrets into prompts; use copal_redact.`,
);
const sessions = new Map<string, { task: string; questions: NavigatorQuestion[] }>();

server.tool({
  name: "copal_get_rules",
  title: "Get applicable Copal rules",
  description: "Return the engineering rules (architecture boundaries, approved dependencies, security, quality) that apply to a file path. Call before writing code.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path (relative to the repo or absolute). Omit for all rules." },
      environment: { type: "string", description: "Policy environment, e.g. local or ci" },
    },
  },
  annotations: { readOnlyHint: true },
  handler: ({ path: p, environment }) => {
    const r = repo();
    const file = p ? rel(p) : undefined;
    const rules = applicableRules(r.policy, file, environment ?? defaultEnv);
    return text(rulesToGuidance(rules, file), { project: r.project, path: file, rules });
  },
});

server.tool({
  name: "copal_check_code",
  title: "Check a draft against Copal policy",
  description: "Validate proposed file content against the project policy. Returns findings with concrete corrections. Use on drafts before writing them to disk.",
  inputSchema: {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: { type: "string", description: "Target file path" },
      content: { type: "string", description: "Full proposed file content" },
      environment: { type: "string" },
    },
  },
  annotations: { readOnlyHint: true },
  handler: ({ path: p, content, environment }) => {
    const r = repo();
    const report = evaluate([fileAsChange(rel(p), content)], r.policy, { environment: environment ?? defaultEnv });
    stats.checks++;
    stats.findings += report.findings.length;
    return text(stripAnsi(formatReport(report, { showMe: true })) + coachNote(report.findings), { ...report, hints: report.findings.map(hintCard) });
  },
});

server.tool({
  name: "copal_reflect",
  title: "Navigator: questions before building",
  description:
    "Call before implementing a feature-sized task. Returns up to 3 questions (first example → failing test, placement, risk) to ask the developer before writing code. If `engage` is false, proceed directly.",
  inputSchema: {
    type: "object",
    required: ["task"],
    properties: {
      task: { type: "string", description: "The developer's request, verbatim" },
      files: { type: "array", items: { type: "string" }, description: "Files the task is expected to touch, if known" },
    },
  },
  annotations: { readOnlyHint: true },
  handler: async ({ task, files }) => {
    let policy;
    let project: string | undefined;
    try {
      const r = repo();
      policy = r.policy;
      project = r.project;
    } catch {
      /* generic questions */
    }
    const s = await client.reflect({ project, task: redact(task, policy).text, files }, policy);
    sessions.set(s.sessionId, { task, questions: s.questions });
    if (!s.engage) return text(`No navigator needed (${s.reason ?? "small task"}). Proceed, test first.`, s);
    return text(
      [
        `Ask the developer these questions before writing code (sessionId ${s.sessionId}). Do not answer them yourself:`,
        ...s.questions.map((q, i) => `${i + 1}. ${q.text}`),
        "",
        "Then call copal_brief with the sessionId and their answers (or skipped: true if they decline).",
      ].join("\n"),
      s,
    );
  },
});

server.tool({
  name: "copal_brief",
  title: "Navigator: turn answers into the agent brief",
  description: "Send the developer's answers to the copal_reflect questions. Returns the brief to follow: first failing test, location, edge cases, team rules, small steps.",
  inputSchema: {
    type: "object",
    required: ["sessionId"],
    properties: {
      sessionId: { type: "string" },
      answers: { type: "array", items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"] } },
      skipped: { type: "boolean" },
    },
  },
  handler: async ({ sessionId, answers, skipped }) => {
    let policy;
    try {
      policy = repo().policy;
    } catch {
      /* none */
    }
    const brief = await client.answer(sessionId, answers ?? [], !!skipped, policy, sessions.get(sessionId));
    return text(briefToText(brief), brief);
  },
});

server.tool({
  name: "copal_check_staged",
  title: "Run the pre-commit validation",
  description: "Run the same validation as the pre-commit hook on the git staged changes (or a unified diff). Records evidence in the Copal console when a server is configured.",
  inputSchema: {
    type: "object",
    properties: {
      diff: { type: "string", description: "Optional unified diff to check instead of the staged changes" },
      environment: { type: "string" },
    },
  },
  handler: async ({ diff, environment }) => {
    const r = repo();
    const d = diff ?? execFileSync("git", ["diff", "--cached", "--no-color", "-U0", "--diff-filter=ACMR"], { cwd: r.root, encoding: "utf8" });
    const files = parseUnifiedDiff(d).map((f) => {
      try {
        return { ...f, content: diff ? undefined : execFileSync("git", ["show", `:${f.path}`], { cwd: r.root, encoding: "utf8" }) };
      } catch {
        return f;
      }
    });
    if (!files.length) return text("No staged changes.");
    const result = await client.analyze(
      { project: r.project, environment: environment ?? defaultEnv, source: "mcp", ref: "staged", title: "agent self-check", agent: server.clientInfo?.name, files, policyText: r.text },
      r.policy,
    );
    stats.checks++;
    stats.findings += result.findings.length;
    return text(stripAnsi(formatReport(result, { showMe: true })) + coachNote(result.findings) + (result.analysisId ? `\n(analysis ${result.analysisId})` : ""), result);
  },
});

server.tool({
  name: "copal_redact",
  title: "Redact restricted context",
  description: "Remove secrets and policy-restricted data (keys, tokens, customer identifiers) from text before sending it to any model or external tool.",
  inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
  annotations: { readOnlyHint: true },
  handler: ({ text: t }) => {
    let policy;
    try {
      policy = repo().policy;
    } catch {
      /* built-ins only */
    }
    const out = redact(t, policy);
    return text(out.text, out);
  },
});

server.tool({
  name: "copal_plan",
  title: "Turn a story into a policy-aware plan",
  description: "Ask Copal for a technical plan for a user story, including the enforced constraints of this project.",
  inputSchema: { type: "object", required: ["story"], properties: { story: { type: "string" } } },
  handler: async ({ story }) => {
    const r = repo();
    try {
      const plan = await client.request<{ steps: string[]; constraints: string[] }>("POST", "/v1/plan", { story: redact(story, r.policy).text, project: r.project });
      return text(["Plan:", ...plan.steps.map((s, i) => `${i + 1}. ${s}`), "", "Enforced constraints:", ...plan.constraints.map((c) => `- ${c}`)].join("\n"), plan);
    } catch {
      const enforced = effectiveRules(r.policy, defaultEnv).filter((x) => x.mode === "enforce");
      return text(`(offline) Respect these enforced rules while implementing:\n${enforced.map((x) => `- ${x.id}: ${x.why ?? ""}`).join("\n")}`);
    }
  },
});

server.tool({
  name: "copal_report_session",
  title: "Record the agent session",
  description:
    "Record a completed agent session for the Copal AI-usage view (tokens and cost per merged change, retries, whether the navigator was used). Call once at the end of a task.",
  inputSchema: {
    type: "object",
    properties: {
      agent: { type: "string" },
      tokens: { type: "number" },
      inputTokens: { type: "number" },
      outputTokens: { type: "number" },
      costUsd: { type: "number" },
      model: { type: "string" },
      retries: { type: "number", description: "How many times the work had to be redone after test failures or review" },
      summary: { type: "string" },
    },
  },
  handler: async ({ agent, tokens, inputTokens, outputTokens, costUsd, model, retries }) => {
    const body = {
      agent: agent ?? server.clientInfo?.name ?? "agent",
      project: repo().project,
      durationMs: Date.now() - stats.startedAt,
      tokens: tokens ?? (inputTokens ?? 0) + (outputTokens ?? 0),
      inputTokens,
      outputTokens,
      costUsd,
      model,
      retries,
      navigatorUsed: sessions.size > 0,
      findings: stats.findings,
    };
    try {
      await client.recordSession(body);
      return text("Session recorded.", body);
    } catch (e) {
      return text(`Session not recorded (${(e as Error).message}).`, body);
    }
  },
});

server.resource({
  uri: "copal://policy",
  name: ".copalrules",
  description: "Project-owned Copal policy as committed in the repository",
  mimeType: "application/yaml",
  read: () => fs.readFileSync(repo().file, "utf8"),
});
server.resource({
  uri: "copal://policy/resolved",
  name: "Resolved policy",
  description: "Policy after inheritance (built-in packs) — every rule in effect",
  mimeType: "application/yaml",
  read: () => toYaml(repo().policy),
});

server.prompt({
  name: "copal-review",
  description: "Review the staged change against this project's Copal policy and fix every enforced finding",
  get: () => [
    {
      role: "user",
      content: {
        type: "text",
        text: "Call copal_check_staged. For each finding with a question, ask me the question first and let me decide. Fix ENFORCE findings (or explain why it is a false positive and add `// copal-ignore <rule-id>`), then call copal_check_staged again until nothing blocks.",
      },
    },
  ],
});

server.prompt({
  name: "copal-pair",
  description: "Pair on a feature: Copal navigator questions first, then test-first in small steps",
  get: () => [
    {
      role: "user",
      content: {
        type: "text",
        text: "Let's pair on my next task. Call copal_reflect with it, ask me the questions, wait for my answers, call copal_brief, then work test-first in small steps and show me each step.",
      },
    },
  ],
});

/** Agents get the questions to relay, so the developer stays the one who decides. */
function coachNote(findings: { coach?: { question?: string }; ruleId: string }[]): string {
  const qs = findings.filter((f) => f.coach?.question);
  if (!qs.length) return "";
  return "\n\nCoaching: before fixing, relay these questions to the developer (unless they asked you to just fix it):\n" + qs.map((f) => `- [${f.ruleId}] ${f.coach!.question}`).join("\n");
}

function stripAnsi(s: string) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

try {
  log(`project ${repo().project} (${projectDir}), env ${defaultEnv}, server ${client.cfg.serverUrl || "none (local engine)"}`);
} catch (e) {
  log(`warning: ${(e as Error).message}`);
}
server.listen();
