#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { applicableRules, bold, briefToText, cyan, dim, evaluate, fileAsChange, FileChange, Finding, formatReport, green, navigatorQuestions, red, redact, rulesToGuidance, yellow } from "@copal/core";
import { CoachEvent, CopalClient, loadConfig, loadRepoPolicy, saveConfig, CONFIG_FILE } from "@copal/client";
import { allTrackedFiles, author, branchChanges, git, repoRoot, stagedChanges, currentRef } from "./git";

const HELP = `copal — Copal pre-commit & policy CLI (sandbox)

Usage:
  copal login [--server URL] [--key KEY] [--create-key]   Save server URL + device key (~/.copal/config.json)
  copal status                                            Workspace state from the Copal server
  copal check [--staged|--base REF|--all|--diff FILE]     Validate changes against .copalrules
  copal check --stdin-file PATH --json                    Check unsaved editor content (stdin) as PATH
             [--env ENV] [--json] [--show-me] [--fix] [--audit] [--local]
             Hints lead with a question; --show-me reveals fixes, --fix applies pattern fixes (both recorded)
  copal reflect "TASK" [--json] [--skip]                  Navigator: answer up to 3 questions before an AI builds TASK
  copal reflect "TASK" --answers FILE|- [--json]          Non-interactive: answers JSON → agent brief (IDE plugins)
  copal event RULE_ID LEVEL ACTION [--source ide]         Record a hint-ladder step (0-4; shown|ask|explain|show_me|skipped|answered)
  copal hook install [--env ENV] | hook uninstall         Manage the git pre-commit hook
  copal hook install --claude                             Add the navigator to Claude Code (UserPromptSubmit hook)
  copal claude-hook                                       (called by Claude Code) prompt JSON on stdin → navigator context
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
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") && !["staged", "all", "json", "fix", "show-me", "audit", "local", "create-key", "help", "claude", "skip"].includes(k)) flags[k] = argv[++i];
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

  const showMe = !!flags["show-me"] || !!flags.fix;
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(formatReport(result, { showMe: showMe || undefined }));
    console.log(dim(`\n(${result.mode === "remote" ? `server analysis ${result.analysisId}` : "local engine"})`));
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
  const report = evaluate([fileAsChange(rel, content)], repo.policy, { environment });
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
    const inp = JSON.parse(raw) as { sessionId?: string; questions?: { id: string; kind: "first-example" | "placement" | "risk"; text: string }[]; answers?: { id: string; text: string }[]; skipped?: boolean };
    const answers = (inp.answers ?? []).filter((a) => a.text?.trim());
    const brief = await client.answer(inp.sessionId ?? "local_cli", answers, !!inp.skipped || answers.length === 0, policy, { task, questions: inp.questions ?? [] });
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
  if (!skipped) {
    const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
    console.log(cyan(bold("Copal navigator")) + dim(" — explain it before the AI types it. Empty answer = skip."));
    for (const q of s.questions) {
      const a = (await rl.question(`\n${cyan("?")} ${q.text}\n> `)).trim();
      if (a) answers.push({ id: q.id, text: a });
    }
    rl.close();
    skipped = answers.length === 0;
  }
  const brief = await client.answer(s.sessionId, answers, skipped, policy, { task, questions: s.questions });
  console.log("\n" + briefToText(brief));
  return 0;
}

/**
 * Claude Code UserPromptSubmit hook. Reads {"prompt": "..."} on stdin. For feature-sized prompts, adds context that
 * makes Claude act as navigator first: ask the developer Copal's questions, then build test-first in small steps.
 */
async function claudeHook(): Promise<number> {
  let input: { prompt?: string; cwd?: string } = {};
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return 0;
  }
  const prompt = input.prompt ?? "";
  if (/^\s*\//.test(prompt)) return 0; // slash commands
  let policy;
  try {
    policy = loadRepoPolicy(input.cwd ?? process.cwd()).policy;
  } catch {
    return 0; // no .copalrules — stay silent
  }
  const s = navigatorQuestions(policy, prompt);
  if (!s.engage) return 0;
  const context = [
    "Copal navigator (strong-style pairing): this is a feature-sized task. Before writing any code, ask the developer these questions, one message, numbered, and wait for their answers. Do not answer them yourself and do not include code in the questions.",
    ...s.questions.map((q, i) => `${i + 1}. ${q.text}`),
    "",
    "Then: write the first failing test from their first answer, make it pass with the simplest code, refactor, and continue in small steps. Put the code where they said. Respect the repository's .copalrules (call the copal_get_rules MCP tool if available).",
    'If the developer says "just do it" or "skip", proceed without the questions.',
  ].join("\n");
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }));
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
  const list = (settings.hooks.UserPromptSubmit ??= []);
  if (!list.some((e) => e.hooks?.some((h) => h.command.includes("copal claude-hook")))) list.push({ hooks: [{ type: "command", command }] });
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
    case "event": {
      const [, ruleId, level, action] = cmd;
      if (!ruleId || !level || !action) return console.error("usage: copal event RULE_ID LEVEL ACTION"), 2;
      let project: string | undefined;
      let developer: string | undefined;
      try {
        project = loadRepoPolicy(process.cwd()).project;
        developer = author(repoRoot(process.cwd()));
      } catch {
        /* outside a repo */
      }
      const ok = await new CopalClient().coachEvents([
        { project, developer, ruleId, levelReached: Math.max(0, Math.min(4, Number(level))) as CoachEvent["levelReached"], action: action as CoachEvent["action"], source: (flags.source as CoachEvent["source"]) ?? "ide" },
      ]);
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
