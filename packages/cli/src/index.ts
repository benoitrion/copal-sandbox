#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { agentContextBlock, AGENT_CONTEXT_TARGETS, applicableRules, bold, mergeManagedBlock, briefToText, briefToMarkdown, AgentBrief, cyan, dim, evaluate, fileAsChange, FileChange, Finding, formatReport, green, requestCheckContext, requestCheckEvent, scopeCheck, testOrderFindings, reviewChange, red, redact, rulesToGuidance, yellow, weeklyReport, weeklyReportToMarkdown, changedLineSet, onChangedLines, practice, PullRecord, DeploymentRecord, IncidentRecord, BASELINE_FILE, createBaseline, evaluateGate, lineTextFrom, parseBaseline, withoutBaseline } from "@copal/core";
import { CoachEvent, CopalClient, loadConfig, loadRepoPolicy, saveConfig, CONFIG_FILE } from "@copal/client";
import { allTrackedFiles, author, branchChanges, git, repoRoot, stagedChanges, currentRef, defaultBase, worktreeChanges, branchCommits } from "./git";

const HELP = `copal — Copal pre-commit & policy CLI (sandbox)

Usage:
  copal login [--server URL] [--key KEY] [--create-key]   Save server URL + device key (~/.copal/config.json)
  copal status                                            Workspace state from the Copal server
  copal check [--staged|--base REF|--all|--diff FILE]     Validate changes against .copalrules
  copal check --stdin-file PATH --json [--all-lines]      Check unsaved editor content (stdin) as PATH; changed lines only unless --all-lines
  copal check --base REF --gate                           Fail when the change does not pass the .copalrules gate
  copal baseline                                           Record current findings in .copal/baseline.json: only new ones show from now on
             [--env ENV] [--json] [--show-me] [--fix] [--audit] [--local]
             Hints lead with a question; --show-me reveals fixes, --fix applies pattern fixes (both recorded)
  copal reflect "TASK" [--json] [--skip]                  Navigator: answer up to 3 questions before an AI builds TASK
  copal reflect "TASK" --answers FILE|- [--json]          Non-interactive: answers JSON → agent brief (IDE plugins)
  copal review [--base REF] [--json]                      Review my change: engine + scope check on the working tree vs base, local only
  copal scope-check [--base REF] [--json]                 Compare the change with .copal/brief.md; ask about anything beyond it (never blocks)
  copal weekly --repo OWNER/NAME [--track new-products|legacy|agents] [--out DIR] [--json]  Weekly team report: disciplines, delivery (DORA where data allows), next practice
  copal heartbeat FILE [--editor NAME]                    Record IDE activity (adoption)
  copal kata done URL|ID [--rule RULE_ID]                 Record a finished kata (adds it to the library if new)
  copal event RULE_ID LEVEL ACTION [--source ide]         Record a hint-ladder step (0-4; shown|ask|explain|show_me|skipped|answered)
  copal hook install [--env ENV] | hook uninstall         Manage the git pre-commit hook
  copal hook install --claude                             Add the navigator to Claude Code (UserPromptSubmit hook)
  copal claude-hook                                       (called by Claude Code) prompt JSON on stdin → navigator context
  copal sync-context [--check] [--targets claude,agents,cursor,copilot]
                                                          Write the team's rules into CLAUDE.md, AGENTS.md, Cursor and Copilot
                                                          instruction files (managed block); --check exits 1 when out of date
  copal rules [PATH] [--env ENV]                          Rules that apply to PATH (agent guidance)
  copal redact [FILE]                                     Print FILE/stdin with secrets removed
  copal feedback ANALYSIS_ID RULE_ID [--note TEXT]        Mark a finding as false positive

Environment: COPAL_SERVER, COPAL_API_KEY, COPAL_ENV, COPAL_SKIP=1 (bypass hook), NO_COLOR
Exit codes: 0 ok · 1 blocking findings · 2 usage/config error`;

type Flags = Record<string, string | boolean>;
function parseArgs(argv: string[]): { cmd: string[]; flags: Flags } {
  const cmd: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") && !["staged", "all", "json", "fix", "show-me", "audit", "local", "create-key", "help", "claude", "skip", "check"].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else cmd.push(a);
  }
  return { cmd, flags };
}

function detectAgent(): string | undefined {
  const e = process.env;
  if (e.COPAL_AGENT) return e.COPAL_AGENT;
  if (e.CLAUDECODE) return "claude-code";
  if (e.CURSOR_TRACE_ID) return "cursor";
  if (e.CODEX_SANDBOX || e.CODEX_HOME) return "codex";
  if (e.TERM_PROGRAM === "vscode") return "vscode";
  return undefined;
}

async function check(flags: Flags): Promise<number> {
  if (process.env.COPAL_SKIP === "1") {
    console.error(yellow("copal: COPAL_SKIP=1 — pre-commit validation skipped (the PR check will still run)."));
    return 0;
  }
  const cwd = process.cwd();
  if (typeof flags["stdin-file"] === "string") return checkStdinFile(String(flags["stdin-file"]), flags);
  let root = cwd;
  try {
    root = repoRoot(cwd);
  } catch {
    if (!flags.diff) throw new Error("not a git repository (use --diff FILE outside git)");
  }
  const repo = loadRepoPolicy(root);
  const environment = String(flags.env ?? process.env.COPAL_ENV ?? "local");

  let files: FileChange[];
  let ref: string;
  if (flags.diff) {
    const { parseUnifiedDiff } = await import("@copal/core");
    const text = flags.diff === "-" || flags.diff === true ? fs.readFileSync(0, "utf8") : fs.readFileSync(String(flags.diff), "utf8");
    files = parseUnifiedDiff(text);
    ref = "diff";
  } else if (flags.all) {
    files = allTrackedFiles(root);
    ref = currentRef(root);
  } else if (flags.base) {
    files = branchChanges(root, String(flags.base));
    ref = `${currentRef(root)}...${flags.base}`;
  } else {
    files = stagedChanges(root);
    ref = "staged";
  }
  if (!files.length) {
    if (!flags.json) console.log(dim("copal: nothing to check."));
    else console.log(JSON.stringify({ findings: [], blocking: false }));
    return 0;
  }

  const client = new CopalClient(loadConfig(flags.local ? { serverUrl: "" } : {}));
  const result = await client.analyze(
    {
      project: repo.project,
      environment,
      source: flags.all || flags.base ? "branch" : "precommit",
      ref,
      title: flags.all ? `branch scan ${ref}` : `pre-commit (${files.length} file${files.length > 1 ? "s" : ""})`,
      author: author(root),
      agent: detectAgent(),
      files,
      policyText: repo.text,
    },
    repo.policy,
  );
  if (flags.base) {
    // Tests first: implementation committed before its test on this branch → audit question (never blocks).
    const order = testOrderFindings(repo.policy, branchCommits(root, String(flags.base)), environment);
    if (order.length) {
      result.findings.push(...order);
      result.summary.total += order.length;
      result.summary.audit += order.length;
      result.summary.byCategory.testing = (result.summary.byCategory.testing ?? 0) + order.length;
    }
  }

  // Baseline: findings already in the code when the team adopted Copal stay quiet.
  quietBaseline(result, files, root);
  const gate = evaluateGate(result.findings, repo.policy.gate);

  const showMe = !!flags["show-me"] || !!flags.fix;
  if (flags.json) console.log(JSON.stringify(gate ? { ...result, gate } : result, null, 2));
  else {
    console.log(formatReport(result, { showMe: showMe || undefined }));
    console.log(dim(`\n(${result.mode === "remote" ? `server analysis ${result.analysisId}` : "local engine"})`));
    if (gate) console.log(gate.passed ? green("Gate passed") : red(bold(`Gate failed: ${gate.reasons.join(" · ")}`)));
  }

  // Growth metric: which ladder level each finding reached (best effort, never blocks).
  const developer = author(root);
  const events: CoachEvent[] = result.findings.map((f) => ({
    project: repo.project,
    developer,
    ruleId: f.ruleId,
    category: f.category,
    levelReached: showMe ? 4 : f.coach?.example ? 3 : f.coach?.reference || f.why ? 2 : f.coach?.question ? 1 : 0,
    action: showMe ? "show_me" : "shown",
    source: "cli",
  }));
  await client.coachEvents(events);

  if (flags.fix) {
    const fixed = applyFixes(root, result.findings, !flags.base && !flags.all && !flags.diff);
    if (fixed.length) console.log(green(`\n✔ applied ${fixed.length} suggested correction(s): ${fixed.join(", ")} — re-run copal check / commit again.`));
  } else if (!flags.json && !showMe && result.findings.some((f) => f.suggestion || f.fixText)) {
    console.log(dim("\nThink it through first. Stuck? `copal check --show-me` reveals the fixes."));
  }

  if (result.blocking && !flags.audit) {
    if (!flags.json) console.log(red(bold("\nCommit blocked by Copal enforce rules.")) + dim(" Fix the findings, add `// copal-ignore <rule>` for a false positive, or COPAL_SKIP=1 to bypass locally."));
    return 1;
  }
  return gate && !gate.passed && flags.gate ? 1 : 0;
}

/** Drops findings recorded in `.copal/baseline.json` and recomputes the summary. */
function quietBaseline(result: { findings: Finding[]; blocking: boolean; summary: { total: number; blocking: number; audit: number } }, files: FileChange[], root: string) {
  let text: string | undefined;
  try { text = fs.readFileSync(path.join(root, BASELINE_FILE), "utf8"); } catch { return; }
  const kept = withoutBaseline(result.findings, parseBaseline(text), lineTextFrom(files));
  result.findings = kept;
  result.blocking = kept.some((f) => f.blocking);
  result.summary.total = kept.length;
  result.summary.blocking = kept.filter((f) => f.blocking).length;
  result.summary.audit = kept.length - result.summary.blocking;
}

/** `copal baseline`: record every current finding so only new ones speak from now on. */
async function baseline(flags: Flags): Promise<number> {
  const root = repoRoot(process.cwd());
  const repo = loadRepoPolicy(root);
  const files = allTrackedFiles(root);
  const report = evaluate(files, repo.policy, { environment: String(flags.env ?? "ci") });
  const b = createBaseline(report.findings, lineTextFrom(files));
  fs.mkdirSync(path.join(root, ".copal"), { recursive: true });
  fs.writeFileSync(path.join(root, BASELINE_FILE), JSON.stringify(b, null, 2) + "\n");
  console.log(green(`✔ baseline: ${b.entries.length} existing finding(s) recorded in ${BASELINE_FILE}.`) + dim(" Commit it: only new findings will show from now on."));
  return 0;
}

/**
 * Editor integration (JetBrains, other IDEs): evaluate unsaved content read from stdin as FILE.
 * Local engine only — keystroke checks are not recorded as governed evidence.
 */
async function checkStdinFile(file: string, flags: Flags): Promise<number> {
  const abs = path.resolve(process.cwd(), file);
  const repo = loadRepoPolicy(path.dirname(abs));
  const rel = path.relative(repo.root, abs).split(path.sep).join("/");
  const content = fs.readFileSync(0, "utf8");
  const environment = String(flags.env ?? process.env.COPAL_ENV ?? "local");
  // Other files changed in the working tree count (a test next to the code), without their contents.
  const changedPaths = (args: string[]) => { try { return git(args, repo.root).split("\n").map((x) => x.trim()).filter(Boolean); } catch { return []; } };
  const others = [...changedPaths(["diff", "--name-only", "HEAD"]), ...changedPaths(["ls-files", "--others", "--exclude-standard"])]
    .filter((p) => p !== rel).map((p) => ({ path: p, status: "modified" as const, addedLines: [] }));
  const full = evaluate([fileAsChange(rel, content), ...others], repo.policy, { environment });
  // IDE default: hints only on lines changed since the last commit (--all-lines for the whole file).
  let head: string | undefined;
  try { head = flags["all-lines"] ? undefined : git(["show", `HEAD:${rel}`], repo.root); } catch { head = undefined; }
  let findings = flags["all-lines"] ? full.findings.filter((f) => f.file === rel) : onChangedLines(full.findings, repo.policy, rel, changedLineSet(head, content));
  try { findings = withoutBaseline(findings, parseBaseline(fs.readFileSync(path.join(repo.root, BASELINE_FILE), "utf8")), lineTextFrom([fileAsChange(rel, content)])); } catch { /* no baseline */ }
  const report = { ...full, findings, blocking: findings.some((f) => f.blocking), summary: { ...full.summary, total: findings.length, blocking: findings.filter((f) => f.blocking).length, audit: findings.filter((f) => !f.blocking).length } };
  if (flags.json) console.log(JSON.stringify({ ...report, project: repo.project, file: rel, mode: "local" }));
  else console.log(formatReport(report));
  return report.blocking && !flags.audit ? 1 : 0;
}

function applyFixes(root: string, findings: Finding[], restage: boolean): string[] {
  const touched = new Set<string>();
  for (const f of findings.filter((x) => x.suggestion)) {
    const p = path.join(root, f.file);
    const lines = fs.readFileSync(p, "utf8").split("\n");
    if (lines[f.line - 1] === f.suggestion!.original) {
      lines[f.line - 1] = f.suggestion!.replacement;
      fs.writeFileSync(p, lines.join("\n"));
      touched.add(f.file);
    }
  }
  if (restage && touched.size) git(["add", "--", ...touched], root);
  return [...touched];
}

/** Navigator in the terminal: ask the questions, print the brief to hand to the agent. */
async function reflect(task: string, flags: Flags): Promise<number> {
  let policy;
  let project: string | undefined;
  try {
    const repo = loadRepoPolicy(process.cwd());
    policy = repo.policy;
    project = repo.project;
  } catch {
    /* no .copalrules — generic questions */
  }
  const client = new CopalClient(loadConfig(flags.local ? { serverUrl: "" } : {}));
  if (flags.answers) {
    // Non-interactive second step (IDE plugins): JSON {sessionId, questions, answers, skipped} on stdin or in a file.
    const raw = flags.answers === "-" || flags.answers === true ? fs.readFileSync(0, "utf8") : fs.readFileSync(String(flags.answers), "utf8");
    const inp = JSON.parse(raw) as { outOfScope?: string; sessionId?: string; questions?: { id: string; kind: "first-example" | "placement" | "risk"; text: string }[]; answers?: { id: string; text: string }[]; skipped?: boolean };
    const answers = (inp.answers ?? []).filter((a) => a.text?.trim());
    const brief = await client.answer(inp.sessionId ?? "local_cli", answers, !!inp.skipped || answers.length === 0, policy, { task, questions: inp.questions ?? [] });
    writeBriefFile(brief, inp.outOfScope);
    console.log(flags.json ? JSON.stringify({ brief, text: briefToText(brief) }) : briefToText(brief));
    return 0;
  }
  const s = await client.reflect({ project, task }, policy);
  if (flags.json) {
    console.log(JSON.stringify(s, null, 2));
    return 0;
  }
  if (!s.engage) {
    console.log(dim(`copal: no navigator needed (${s.reason ?? "small task"}).`));
    return 0;
  }
  const answers: { id: string; text: string }[] = [];
  let skipped = !!flags.skip;
  let outOfScope = "";
  if (!skipped) {
    const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
    console.log(cyan(bold("Copal navigator")) + dim(" — explain it before the AI types it. Empty answer = skip."));
    for (const q of s.questions) {
      const a = (await rl.question(`\n${cyan("?")} ${q.text}\n> `)).trim();
      if (a) answers.push({ id: q.id, text: a });
    }
    outOfScope = (await rl.question(`\n${cyan("?")} What should this change not touch?\n> `)).trim();
    rl.close();
    skipped = answers.length === 0;
  }
  const brief = await client.answer(s.sessionId, answers, skipped, policy, { task, questions: s.questions });
  const file = writeBriefFile(brief, outOfScope);
  console.log("\n" + briefToText(brief) + (file ? dim(`\n\nSaved to ${file}`) : ""));
  return 0;
}

/** Save the agreed brief as .copal/brief.md (examples, scope, done-when) so any AI assistant and the IDE can read it. */
function writeBriefFile(brief: AgentBrief, outOfScope?: string): string | undefined {
  if (brief.skipped) return undefined;
  if (outOfScope?.trim()) brief.scope = { ...(brief.scope ?? {}), out: outOfScope.trim() };
  let root = process.cwd();
  try {
    root = repoRoot(root);
  } catch {
    /* not a git repo: current folder */
  }
  const dir = path.join(root, ".copal");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "brief.md");
  fs.writeFileSync(file, briefToMarkdown({ ...brief, examples: brief.examples ?? [], scope: brief.scope ?? {} }));
  return path.relative(process.cwd(), file);
}

/** Record a finished kata for the current developer; a kata URL not yet in the team library is added first. */
async function kataDone(ref: string, flags: Flags): Promise<number> {
  const client = new CopalClient();
  let developer: string | undefined;
  try {
    developer = author(repoRoot(process.cwd()));
  } catch {
    /* outside a repo */
  }
  try {
    const list = await client.request<{ katas: { id: string; url: string }[] }>("GET", "/v1/katas");
    let kata = list.katas.find((k) => k.id === ref || k.url === ref);
    if (!kata && /^https?:\/\//.test(ref)) {
      const title = decodeURIComponent(ref.split("/").pop() ?? ref).replace(/\.html?$/, "").replace(/[_-]+/g, " ");
      kata = await client.request<{ id: string; url: string }>("POST", "/v1/katas", { title, url: ref, ruleId: typeof flags.rule === "string" ? flags.rule : undefined });
    }
    if (!kata) return console.error(`copal: unknown kata ${ref}`), 1;
    await client.request("POST", `/v1/katas/${kata.id}/complete`, { developer });
    if (!flags.json) console.log(green(`✔ kata done: ${kata.url}`));
    return 0;
  } catch (e) {
    if (!flags.json) console.log(dim(`not recorded (${(e as Error).message})`));
    return 0;
  }
}

/** Claude Code SessionEnd: tokens from the transcript → one AI session for the usage page (best effort). */
async function claudeSessionEnd(input: { transcript_path?: string; cwd?: string }): Promise<number> {
  if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | undefined;
  let requestCheck = false;
  for (const line of fs.readFileSync(input.transcript_path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    if (line.includes("Copal request check")) requestCheck = true;
    try {
      const m = JSON.parse(line)?.message;
      if (m?.usage) {
        inputTokens += (m.usage.input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0);
        outputTokens += m.usage.output_tokens ?? 0;
        model ??= m.model;
      }
    } catch {
      /* not JSON */
    }
  }
  if (!inputTokens && !outputTokens) return 0;
  const cwd = input.cwd ?? process.cwd();
  let project: string | undefined;
  try {
    project = loadRepoPolicy(cwd).project;
  } catch {
    /* no .copalrules */
  }
  const navigatorUsed = requestCheck || fs.existsSync(path.join(cwd, ".copal", "brief.md"));
  const send = new CopalClient()
    .recordSession({ agent: "claude-code", project, inputTokens, outputTokens, tokens: inputTokens + outputTokens, model, navigatorUsed })
    .catch(() => undefined);
  await Promise.race([send, new Promise((r) => setTimeout(r, 2000).unref())]);
  return 0;
}

/** "Review my change": the same hint cards as the PR bot, on the working tree vs base, without a server. */
function reviewCmd(flags: Flags): number {
  const root = repoRoot(process.cwd());
  const repo = loadRepoPolicy(root);
  const base = defaultBase(root, typeof flags.base === "string" ? flags.base : undefined);
  const briefPath = path.join(root, ".copal", "brief.md");
  const brief = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, "utf8") : undefined;
  const environment = String(flags.env ?? process.env.COPAL_ENV ?? "local");
  const r = reviewChange(worktreeChanges(root, base), repo.policy, { brief, environment });
  if (flags.json) {
    // `findings` keeps the report shape the IDE plugins already parse.
    console.log(JSON.stringify({ base, blocking: r.blocking, findings: r.cards.map((c) => c.finding), cards: r.cards.map(({ finding, ...c }) => c), scope: r.scope }, null, 2));
    return 0;
  }
  if (!r.cards.length && !r.scope.length) {
    console.log(green(`✔ Nothing to discuss in this change (vs ${base}).`));
    return 0;
  }
  console.log(bold(`Review my change (vs ${base}) — ${r.cards.length} hint(s)`));
  for (const c of r.cards) {
    console.log(`\n${c.blocking ? red("●") : yellow("●")} ${bold(c.title)} ${dim(c.location)}\n  ${c.signal}`);
    if (c.question) console.log(`  ${cyan("?")} ${c.question}`);
    console.log(dim(`  ${c.actions.join(" · ")}`));
  }
  if (r.scope.length) {
    console.log(bold("\nBeyond the brief:"));
    for (const i of r.scope) console.log(`${yellow("?")} ${i.question}`);
  }
  return 0;
}

/** `copal scope-check`: what the change adds beyond the agreed brief, as questions. Always exits 0. */
function scopeCheckCmd(flags: Flags): number {
  const root = repoRoot(process.cwd());
  const briefPath = path.join(root, ".copal", "brief.md");
  if (!fs.existsSync(briefPath)) {
    console.log(flags.json ? JSON.stringify({ brief: false, items: [] }) : dim('copal: no .copal/brief.md — run copal reflect "TASK" first.'));
    return 0;
  }
  const base = defaultBase(root, typeof flags.base === "string" ? flags.base : undefined);
  const items = scopeCheck(fs.readFileSync(briefPath, "utf8"), worktreeChanges(root, base));
  if (flags.json) console.log(JSON.stringify({ brief: true, base, items }, null, 2));
  else if (!items.length) console.log(green("✔ Everything in this change is covered by the brief."));
  else {
    console.log(bold(`Beyond the brief (vs ${base}):`));
    for (const i of items) console.log(`${yellow("?")} ${i.question}${i.details.length ? dim(`\n    ${i.details.join(" · ")}`) : ""}`);
  }
  return 0;
}

/** Growth event with the repo's project and git author; best effort, never fails the caller. */
async function recordEvent(e: Omit<CoachEvent, "project" | "developer" | "category"> & { category?: string }, cwd = process.cwd(), timeoutMs?: number): Promise<boolean> {
  let project: string | undefined;
  let developer: string | undefined;
  try {
    developer = author(repoRoot(cwd));
    project = loadRepoPolicy(cwd).project;
  } catch {
    /* outside a repo or no .copalrules */
  }
  const send = new CopalClient().coachEvents([{ project, developer, ...e } as CoachEvent]);
  if (!timeoutMs) return send;
  return Promise.race([send, new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs).unref())]);
}

/**
 * Claude Code UserPromptSubmit hook. Reads {"prompt": "..."} on stdin. For feature-sized prompts, adds context that
 * makes Claude act as navigator first: ask the developer Copal's questions, then build test-first in small steps.
 */
async function claudeHook(): Promise<number> {
  let input: { prompt?: string; cwd?: string; hook_event_name?: string; transcript_path?: string } = {};
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return 0;
  }
  if (input.hook_event_name === "SessionEnd") return claudeSessionEnd(input);
  const prompt = input.prompt ?? "";
  if (/^\s*\//.test(prompt)) return 0; // slash commands
  const briefPath = path.join(input.cwd ?? process.cwd(), ".copal", "brief.md");
  const brief = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, "utf8") : undefined;
  const context = requestCheckContext(prompt, brief);
  if (!context) return 0;
  const ev = requestCheckEvent(prompt);
  if (ev) await recordEvent({ ...ev, source: "agent" }, input.cwd ?? process.cwd(), 1500);
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }));
  return 0;
}

function syncContext(flags: Flags): number {
  const repo = loadRepoPolicy(process.cwd());
  const block = agentContextBlock(repo.policy, repo.project);
  const targets = String(flags.targets ?? "claude,agents,cursor,copilot").split(",").map((t) => t.trim()).filter(Boolean);
  let stale = 0;
  for (const t of targets) {
    const target = AGENT_CONTEXT_TARGETS[t];
    if (!target) return console.error(`unknown target "${t}" (claude, agents, cursor, copilot)`), 2;
    const file = path.join(repo.root, target.file);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const next = mergeManagedBlock(current, block, target.header);
    if (next === current) {
      console.log(dim(`= ${target.file} up to date`));
      continue;
    }
    stale++;
    if (flags.check) {
      console.log(yellow(`✗ ${target.file} is out of date with .copalrules`));
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next);
    console.log(green(`✔ ${target.file} ${current ? "updated" : "created"}`));
  }
  if (flags.check && stale) {
    console.log(dim("Run `copal sync-context` and commit the result."));
    return 1;
  }
  return 0;
}

function installClaudeHook(): number {
  let root = process.cwd();
  try {
    root = repoRoot(root);
  } catch {
    /* not a git repo: use cwd */
  }
  const file = path.join(root, ".claude", "settings.json");
  let settings: { hooks?: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]> } = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* new file */
  }
  const command = "npx --no-install copal claude-hook 2>/dev/null || copal claude-hook";
  settings.hooks ??= {};
  for (const event of ["UserPromptSubmit", "SessionEnd"]) {
    const list = (settings.hooks[event] ??= []);
    if (!list.some((e) => e.hooks?.some((h) => h.command.includes("copal claude-hook")))) list.push({ hooks: [{ type: "command", command }] });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  console.log(green(`✔ Claude Code navigator hook added to ${path.relative(process.cwd(), file) || file}`) + dim(" (feature-sized prompts get Copal's questions first)"));
  return 0;
}

function hook(sub: string | undefined, flags: Flags): number {
  if (sub === "install" && flags.claude) return installClaudeHook();
  const root = repoRoot(process.cwd());
  const file = path.resolve(root, git(["rev-parse", "--git-path", "hooks"], root).trim(), "pre-commit");
  const marker = "# copal-managed-hook";
  if (sub === "install") {
    if (fs.existsSync(file) && !fs.readFileSync(file, "utf8").includes(marker)) {
      fs.renameSync(file, file + ".pre-copal");
      console.log(yellow(`existing hook moved to ${file}.pre-copal (it will still run first)`));
    }
    const env = flags.env ? ` --env ${flags.env}` : "";
    const script = `#!/bin/sh
${marker}
[ -x "$0.pre-copal" ] && { "$0.pre-copal" "$@" || exit $?; }
if command -v copal >/dev/null 2>&1; then exec copal check --staged${env}; fi
exec "${process.execPath}" "${path.resolve(__filename)}" check --staged${env}
`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, script, { mode: 0o755 });
    console.log(green(`✔ pre-commit hook installed at ${path.relative(process.cwd(), file) || file}`));
    return 0;
  }
  if (sub === "uninstall") {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(marker)) fs.rmSync(file);
    if (fs.existsSync(file + ".pre-copal")) fs.renameSync(file + ".pre-copal", file);
    console.log(green("✔ hook removed"));
    return 0;
  }
  console.error("usage: copal hook install|uninstall");
  return 2;
}

// ---------------------------------------------------------------- weekly report
async function weeklyCmd(flags: Record<string, string | boolean>): Promise<number> {
  const repo = (typeof flags.repo === "string" && flags.repo) || process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return console.error("usage: copal weekly --repo OWNER/NAME [--out reports/] [--json]  (GITHUB_TOKEN for private repositories)"), 2;
  const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const get = async (p: string) => {
    const r = await fetch(api + p, { headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!r.ok) throw new Error(`GitHub ${r.status} on ${p}`);
    return r.json() as Promise<any>;
  };
  const now = Date.now();
  // --days N: one window of N days with no comparison (readiness run); default: this week vs last week.
  const days = Math.max(1, Math.min(365, Number(flags.days) || 7));
  const single = flags.days !== undefined;
  const since = now - (single ? days : 14) * 864e5;
  const list: any[] = [];
  for (let page = 1; page <= (single ? 5 : 1); page++) {
    const batch: any[] = await get(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
    list.push(...batch);
    if (batch.length < 100 || Date.parse(batch[batch.length - 1].updated_at) < since) break;
  }
  const merged = list.filter((p) => p.merged_at && Date.parse(p.merged_at) >= since);
  const pulls: PullRecord[] = [];
  for (const p of merged) {
    const base = `/repos/${repo}/pulls/${p.number}`;
    const [files, reviews, commits] = await Promise.all([get(`${base}/files?per_page=100`), get(`${base}/reviews?per_page=100`), get(`${base}/commits?per_page=100`)]);
    pulls.push({
      number: p.number, author: p.user?.login, createdAt: p.created_at, mergedAt: p.merged_at,
      firstCommitAt: commits[0]?.commit?.author?.date,
      files: files.map((f: any) => ({ filename: f.filename, additions: f.additions, deletions: f.deletions })),
      reviews: reviews.map((r: any) => ({ author: r.user?.login, submittedAt: r.submitted_at })),
      revert: /^revert\b/i.test(p.title ?? ""),
    });
  }
  // Dismissed hints (`/copal false-positive RULE` replies on the change) → rules to tune.
  const dismissals: { ruleId: string; at: string }[] = [];
  for (const p of merged) {
    try {
      const cs: any[] = await get(`/repos/${repo}/issues/${p.number}/comments?per_page=100`);
      for (const c of cs) for (const m of String(c.body ?? "").matchAll(/^\/copal\s+(?:false-positive|fp)\s+([\w-]+)/gm)) dismissals.push({ ruleId: m[1], at: c.created_at });
    } catch { /* comments unavailable */ }
  }
  const weekAgo = single ? since : now - 7 * 864e5;
  let deployments: DeploymentRecord[] | undefined;
  try {
    const ds: any[] = await get(`/repos/${repo}/deployments?environment=${encodeURIComponent(String(flags.environment || "production"))}&per_page=100`);
    deployments = [];
    for (const d of ds.filter((x) => Date.parse(x.created_at) >= since)) {
      const st: any[] = await get(`/repos/${repo}/deployments/${d.id}/statuses?per_page=1`);
      deployments.push({ at: d.created_at, failed: ["failure", "error"].includes(st[0]?.state) });
    }
    if (!deployments.length) deployments = undefined;
  } catch { deployments = undefined; }
  let incidents: IncidentRecord[] | undefined;
  try {
    const is: any[] = await get(`/repos/${repo}/issues?labels=${encodeURIComponent(String(flags.incidentLabel || "incident"))}&state=all&since=${new Date(since).toISOString()}&per_page=100`);
    incidents = is.length ? is.map((i) => ({ openedAt: i.created_at, resolvedAt: i.closed_at ?? undefined })) : undefined;
  } catch { incidents = undefined; }
  const report = weeklyReport({ pulls: pulls.filter((p) => Date.parse(p.mergedAt) >= weekAgo), previous: single ? undefined : pulls.filter((p) => Date.parse(p.mergedAt) < weekAgo), days: single ? days : 7, deployments, incidents, dismissals, track: (["new-products", "legacy", "agents"] as const).find((t) => t === flags.track), now });
  if (flags.json) return console.log(JSON.stringify(report, null, 2)), 0;
  const md = weeklyReportToMarkdown(report, (id) => { const p = practice(id); return p && `${p.title} (${p.where}, ${p.minutes} min) — ${p.goal}`; });
  if (typeof flags.out === "string") {
    const file = path.join(flags.out, `${single ? "readiness" : "weekly"}-${report.to.slice(0, 10)}.md`);
    fs.mkdirSync(flags.out, { recursive: true });
    fs.writeFileSync(file, md + "\n");
    console.log(green(`✔ wrote ${file}`));
  } else console.log(md);
  return 0;
}

async function main(): Promise<number> {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || !cmd.length) {
    console.log(HELP);
    return cmd.length ? 0 : 2;
  }
  switch (cmd[0]) {
    case "check":
      return check(flags);
    case "hook":
      return hook(cmd[1], flags);
    case "reflect":
      if (!cmd[1]) return console.error('usage: copal reflect "TASK"'), 2;
      return reflect(cmd.slice(1).join(" "), flags);
    case "claude-hook":
      return claudeHook();
    case "sync-context":
      return syncContext(flags);
    case "heartbeat": {
      if (!cmd[1]) return console.error("usage: copal heartbeat FILE [--editor NAME]"), 2;
      const ok = await new CopalClient()
        .heartbeats([{ file: cmd[1], ts: Date.now(), editor: typeof flags.editor === "string" ? flags.editor : "ide" }])
        .then(() => true, () => false);
      if (!flags.json) console.log(dim(ok ? "recorded" : "not recorded (no server)"));
      return 0;
    }
    case "baseline":
      return baseline(flags);
    case "kata":
      if (cmd[1] !== "done" || !cmd[2]) return console.error("usage: copal kata done URL|ID [--rule RULE_ID]"), 2;
      return kataDone(cmd[2], flags);
    case "scope-check":
      return scopeCheckCmd(flags);
    case "weekly":
      return weeklyCmd(flags);
    case "review":
      return reviewCmd(flags);
    case "event": {
      const [, ruleId, level, action] = cmd;
      if (!ruleId || !level || !action) return console.error("usage: copal event RULE_ID LEVEL ACTION"), 2;
      const ok = await recordEvent({
        ruleId,
        category: typeof flags.category === "string" ? flags.category : undefined,
        levelReached: Math.max(0, Math.min(4, Number(level))) as CoachEvent["levelReached"],
        action: action as CoachEvent["action"],
        source: (flags.source as CoachEvent["source"]) ?? "ide",
      });
      if (!flags.json) console.log(dim(ok ? "recorded" : "not recorded (no server)"));
      return 0;
    }
    case "login": {
      const cfg = loadConfig();
      if (typeof flags.server === "string") cfg.serverUrl = flags.server;
      if (typeof flags.key === "string") cfg.apiKey = flags.key;
      if (flags["create-key"]) cfg.apiKey = (await new CopalClient(cfg).createKey(`cli@${require("node:os").hostname()}`)).key;
      saveConfig(cfg);
      const st = await new CopalClient(cfg).status().catch((e) => ({ error: e.message }));
      console.log(green(`✔ saved ${CONFIG_FILE}`), dim(JSON.stringify(st)));
      return 0;
    }
    case "status":
      console.log(JSON.stringify(await new CopalClient().status(), null, 2));
      return 0;
    case "rules": {
      const repo = loadRepoPolicy(process.cwd());
      const env = String(flags.env ?? process.env.COPAL_ENV ?? "local");
      console.log(rulesToGuidance(applicableRules(repo.policy, cmd[1], env), cmd[1]));
      return 0;
    }
    case "redact": {
      let policy;
      try {
        policy = loadRepoPolicy(process.cwd()).policy;
      } catch {
        /* built-in patterns only */
      }
      const text = fs.readFileSync(cmd[1] ?? 0, "utf8");
      const out = redact(text, policy);
      process.stdout.write(out.text);
      if (out.redactions.length) console.error(dim(`\nredacted: ${out.redactions.map((r) => `${r.name}×${r.count}`).join(", ")}`));
      return 0;
    }
    case "feedback":
      if (!cmd[1] || !cmd[2]) return console.error("usage: copal feedback ANALYSIS_ID RULE_ID [--note TEXT]"), 2;
      await new CopalClient().feedback(cmd[1], cmd[2], "false-positive", typeof flags.note === "string" ? flags.note : undefined);
      console.log(green("✔ recorded as false positive"));
      return 0;
    default:
      console.error(`unknown command "${cmd[0]}"\n\n${HELP}`);
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(red(`copal: ${(e as Error).message}`));
    process.exit(2);
  },
);
