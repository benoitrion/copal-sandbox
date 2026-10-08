#!/usr/bin/env node
/**
 * Copal PR check as a GitHub Actions step — no GitHub App, no webhook, no hosted server required.
 * Uses the job's GITHUB_TOKEN to set the `copal/check` commit status and post a review with inline findings.
 *
 * Env (provided by Actions): GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_TOKEN.
 * Optional: COPAL_SERVER + COPAL_API_KEY (record the analysis in a Copal console; otherwise the local engine runs),
 *           COPAL_ENV (default ci), COPAL_FAIL_ON_BLOCKING (default 1: the step fails when a finding blocks).
 * Workflow permissions needed: contents: read, pull-requests: write, statuses: write.
 */
import * as fs from "node:fs";
import { CopalClient, loadConfig } from "@copal/client";
import { runCheck } from "./handler";
import { GitHubProvider } from "./providers";

async function main(): Promise<number> {
  const event = process.env.GITHUB_EVENT_NAME;
  const payload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
  const pr = payload.pull_request;
  if (!pr || !["pull_request", "pull_request_target"].includes(event ?? "")) {
    console.log(`copal: event "${event}" is not a pull request, nothing to do`);
    return 0;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set (add `env: GITHUB_TOKEN: ${{ github.token }}`)");
  const repo = process.env.GITHUB_REPOSITORY ?? payload.repository.full_name;
  const provider = new GitHubProvider({ apiUrl: (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, ""), token }, repo, pr.number);
  const client = new CopalClient(loadConfig());
  console.log(`copal: checking ${repo}#${pr.number} (${client.remote ? `server ${client.cfg.serverUrl}` : "local engine"})`);

  const result = await runCheck(provider, client);
  if (!result) return 0;

  const lines = [
    `### Copal — ${result.blocking ? "❌ changes requested" : result.findings.length ? "⚠️ passed with audit findings" : "✅ passed"}`,
    "",
    `${result.summary.blocking} blocking · ${result.summary.audit} audit · env \`${result.environment}\` · ${result.mode === "remote" ? `recorded as \`${result.analysisId}\`` : "local engine (not recorded)"}`,
    "",
    ...result.findings.map((f) => `- ${f.blocking ? "⛔" : "⚠️"} \`${f.ruleId}\` ${f.file}:${f.line} — ${f.message}`),
  ];
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  return result.blocking && process.env.COPAL_FAIL_ON_BLOCKING !== "0" ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`copal: ${(e as Error).message}`);
    process.exit(2);
  },
);
