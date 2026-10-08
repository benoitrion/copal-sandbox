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
import { applicableRules, evaluate, fileAsChange, formatReport, parseUnifiedDiff, redact, rulesToGuidance, toYaml, effectiveRules } from "@copal/core";
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
  { name: "copal", version: "0.1.0" },
  `Copal enforces this repository's engineering policy (.copalrules). Before creating or editing a file, call copal_get_rules with its path and follow the ENFORCED rules. ` +
    `After drafting, call copal_check_code (or copal_check_staged before committing) and apply the suggested corrections. Never paste secrets into prompts; use copal_redact.`,
);

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
    return text(stripAnsi(formatReport(report)), report);
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
    return text(stripAnsi(formatReport(result)) + (result.analysisId ? `\n(analysis ${result.analysisId})` : ""), result);
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
  description: "Record a completed agent session (agent name, approximate tokens) for the Copal console cost view. Call once at the end of a task.",
  inputSchema: { type: "object", properties: { agent: { type: "string" }, tokens: { type: "number" }, summary: { type: "string" } } },
  handler: async ({ agent, tokens }) => {
    const body = { agent: agent ?? server.clientInfo?.name ?? "agent", project: repo().project, durationMs: Date.now() - stats.startedAt, tokens, findings: stats.findings };
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
        text: "Call copal_check_staged. For each ENFORCE finding apply the suggested correction (or explain why it is a false positive and add `// copal-ignore <rule-id>`), then call copal_check_staged again until nothing blocks.",
      },
    },
  ],
});

function stripAnsi(s: string) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

try {
  log(`project ${repo().project} (${projectDir}), env ${defaultEnv}, server ${client.cfg.serverUrl || "none (local engine)"}`);
} catch (e) {
  log(`warning: ${(e as Error).message}`);
}
server.listen();
