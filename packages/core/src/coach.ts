/**
 * Coaching layer (v4): the hint ladder, navigator mode and kata escalation.
 * Pure functions — no I/O — so they run in the CLI, the MCP server, IDE plugins and edge backends alike.
 */
import type { Coach, Finding, HintLevel, NavigatorQuestionKind, Policy, Rule } from "./types";

// ---------------------------------------------------------------- guards
/** True when text looks like it contains code — questions must ask, never answer. */
export function containsCode(text: string): boolean {
  return (
    /```|`[^`]*[(){};=<>][^`]*`/.test(text) ||
    /\b(import|export|const|let|var|function|class|return|def|public|private)\s+[\w{]/.test(text) ||
    /[;{}]\s*$/m.test(text) ||
    /\w+\([^)]*\)\s*(=>|\{)/.test(text) ||
    /=>/.test(text)
  );
}

// ---------------------------------------------------------------- hint ladder
export const HINT_LEVELS: Record<HintLevel, string> = {
  0: "signal",
  1: "question",
  2: "reference",
  3: "worked-example",
  4: "fix",
};

export interface HintCard {
  ruleId: string;
  title: string;
  location: string;
  /** Level 0 — what was noticed. */
  signal: string;
  /** Level 1. */
  question?: string;
  /** Level 2. */
  why?: string;
  reference?: string;
  example?: Coach["example"];
  /** Level 4 — only revealed on "Show me". */
  fix?: string;
  /** Present when the rule has a kata (shown as "Practice" once it recurs). */
  kata?: string;
  learningHour?: string;
  blocking: boolean;
  /** Highest level this card can offer without "Show me". */
  maxLevel: HintLevel;
}

/** Build the hint card every surface renders (IDE hover, CLI, PR comment, agent reply). */
export function hintCard(f: Finding): HintCard {
  const c = f.coach ?? {};
  const fix = f.suggestion ? f.suggestion.replacement.trim() : f.fixText;
  const card: HintCard = {
    ruleId: f.ruleId,
    title: `${f.ruleId} · ${f.category}`,
    location: `${f.file}:${f.line}`,
    signal: f.message,
    question: c.question,
    why: f.why,
    reference: c.reference,
    example: c.example,
    fix,
    kata: c.kata,
    learningHour: c.learningHour,
    blocking: f.blocking,
    maxLevel: c.example ? 3 : c.reference || f.why ? 2 : c.question ? 1 : 0,
  };
  return card;
}

/** Rule ids whose coach content is missing — shown to leads as "Add coaching". */
export function rulesWithoutCoaching(p: Policy): string[] {
  return p.rules.filter((r) => !r.coach?.question).map((r) => r.id);
}

// ---------------------------------------------------------------- escalation (katas)
export interface Occurrence {
  ruleId: string;
  developer?: string;
  at: string | number | Date;
}

export interface KataSuggestion {
  ruleId: string;
  developer?: string;
  count: number;
  kata?: string;
  learningHour?: string;
  reason: string;
}

/**
 * Rules that recurred at least `coach.escalateAfter` (default 3) times for one developer within `windowDays`
 * (default 14, a sprint) → suggest the rule's kata. Recurrence across ≥ 2 developers → learning-hour topic.
 */
export function kataSuggestions(policy: Policy, occurrences: Occurrence[], now = Date.now(), windowDays = 14): KataSuggestion[] {
  const since = now - windowDays * 864e5;
  const rules = new Map(policy.rules.map((r) => [r.id, r]));
  const recent = occurrences.filter((o) => new Date(o.at).getTime() >= since);
  const out: KataSuggestion[] = [];
  const byRuleDev = new Map<string, number>();
  for (const o of recent) {
    const k = `${o.ruleId}\u0000${o.developer ?? ""}`;
    byRuleDev.set(k, (byRuleDev.get(k) ?? 0) + 1);
  }
  const devsByRule = new Map<string, Set<string>>();
  for (const [k, count] of byRuleDev) {
    const [ruleId, developer] = k.split("\u0000");
    const rule = rules.get(ruleId);
    if (!rule?.coach) continue;
    const threshold = rule.coach.escalateAfter ?? 3;
    if (count >= threshold) {
      if (!devsByRule.has(ruleId)) devsByRule.set(ruleId, new Set());
      devsByRule.get(ruleId)!.add(developer);
      out.push({
        ruleId,
        developer: developer || undefined,
        count,
        kata: rule.coach.kata,
        learningHour: rule.coach.learningHour,
        reason: `${ordinal(count)} ${ruleId} in ${windowDays} days`,
      });
    }
  }
  for (const [ruleId, devs] of devsByRule) {
    const rule = rules.get(ruleId)!;
    if (devs.size >= 2 && rule.coach?.learningHour)
      out.push({ ruleId, count: devs.size, learningHour: rule.coach.learningHour, reason: `${devs.size} developers hit ${ruleId} this sprint — learning-hour topic` });
  }
  return out.sort((a, b) => b.count - a.count);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------------------------------------------------------------- navigator mode
export interface NavigatorQuestion {
  id: string;
  kind: NavigatorQuestionKind;
  text: string;
}

export interface NavigatorSession {
  /** False when the task is too small or the navigator is disabled — the agent proceeds directly. */
  engage: boolean;
  reason: string;
  questions: NavigatorQuestion[];
}

const SMALL_TASK = /^\s*(fix (a |the )?typo|rename|format|reformat|bump|update (the )?(readme|docs?|changelog)|lint|add (a )?comment|remove unused|sort imports)\b/i;
const FEATURE_HINT = /\b(add|build|create|implement|introduce|support|feature|endpoint|service|refactor|redesign|migrate|integrate|new)\b/i;
const OPT_OUT = /\b(just do it|no questions|skip (the )?(navigator|questions)|copal:\s*skip)\b/i;

/** Is this agent task big enough to warrant a navigator session? */
export function taskScope(task: string): "small" | "feature" {
  const t = task.trim();
  if (!t || SMALL_TASK.test(t)) return "small";
  if (FEATURE_HINT.test(t) || t.split(/\s+/).length >= 12) return "feature";
  return "small";
}

/**
 * Navigator questions for a task (strong-style pairing: the idea is explained before the AI types it).
 * Deterministic templates enriched with the policy's boundaries; at most 3, never containing code.
 */
export function navigatorQuestions(policy: Policy | undefined, task: string, opts: { files?: string[]; force?: boolean } = {}): NavigatorSession {
  const nav = policy?.navigator ?? {};
  if (nav.enabled === false) return { engage: false, reason: "navigator disabled in .copalrules", questions: [] };
  if (OPT_OUT.test(task)) return { engage: false, reason: "developer opted out for this task", questions: [] };
  if (!opts.force && (nav.minScope ?? "feature") === "feature" && taskScope(task) === "small")
    return { engage: false, reason: "small task — no navigator needed", questions: [] };
  const kinds = (nav.questions?.length ? nav.questions : (["first-example", "placement", "risk"] as NavigatorQuestionKind[])).slice(0, Math.min(nav.maxQuestions ?? 3, 3));
  const subject = summarize(task);
  const boundaries = (policy?.rules ?? []).filter((r) => r.deny).map((r) => r.deny!.split(/\s+->\s+/)[0]);
  const where = opts.files?.length ? ` You mentioned ${opts.files.slice(0, 2).join(", ")}.` : "";
  const text: Record<NavigatorQuestionKind, string> = {
    "first-example": `What is the first concrete example ${subject} must handle — input and expected result? That becomes the first failing test.`,
    placement: boundaries.length
      ? `Where does this belong, given the team's boundaries (${boundaries.slice(0, 3).join(", ")})? Which module owns the rule, and what stays outside it?${where}`
      : `Where does this belong — which module owns the rule, and what stays outside it?${where}`,
    risk: "What could go wrong — which edge case, invalid input or failure must it handle?",
  };
  const questions = kinds.map((kind, i) => ({ id: `q${i + 1}`, kind, text: text[kind] }));
  return { engage: questions.length > 0, reason: questions.length ? "feature-sized task" : "no questions configured", questions: questions.filter((q) => !containsCode(q.text)) };
}

function summarize(task: string): string {
  const t = task.replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "");
  const short = t.length > 60 ? t.slice(0, 57).replace(/\s+\S*$/, "") + "…" : t;
  return short ? `"${short}"` : "this change";
}

export interface NavigatorAnswer {
  id: string;
  text: string;
}

export interface AgentBrief {
  task: string;
  skipped: boolean;
  firstTest?: string;
  location?: string;
  edgeCases: string[];
  /** 2–4 agreed examples (input → expected): the first answer plus the edge cases. They become the failing tests. */
  examples: string[];
  scope: { in?: string; out?: string };
  rules: { id: string; what: string }[];
  /** Instructions handed to the agent. */
  instructions: string[];
}

/** Turn the developer's answers into the brief the agent works from (test first, small steps). */
export function buildBrief(policy: Policy | undefined, task: string, questions: NavigatorQuestion[], answers: NavigatorAnswer[], skipped = false, opts: { outOfScope?: string } = {}): AgentBrief {
  const byKind = (k: NavigatorQuestionKind) => {
    const q = questions.find((x) => x.kind === k);
    const a = q && answers.find((x) => x.id === q.id)?.text?.trim();
    return a || undefined;
  };
  const risk = byKind("risk");
  const brief: AgentBrief = {
    task,
    skipped,
    firstTest: byKind("first-example"),
    location: byKind("placement"),
    edgeCases: risk ? risk.split(/\s*(?:;|\n|,\s*(?=and\b)|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean) : [],
    examples: [],
    scope: {},
    rules: (policy?.rules ?? []).filter((r) => r.mode !== "off").slice(0, 12).map((r) => ({ id: r.id, what: ruleSummary(r) })),
    instructions: [],
  };
  brief.examples = [brief.firstTest, ...brief.edgeCases].filter((x): x is string => !!x).slice(0, 4);
  if (brief.location) brief.scope.in = brief.location;
  if (opts.outOfScope?.trim()) brief.scope.out = opts.outOfScope.trim();
  brief.instructions = [
    ...(brief.examples.length ? [EXAMPLES_FIRST] : []),
    brief.firstTest ? `Start with one failing test for: ${brief.firstTest}. Make it pass with the simplest code, then refactor.` : "Start with one failing test for the simplest case, make it pass, then refactor.",
    brief.location ? `Put the logic where the developer said: ${brief.location}.` : "Ask the developer where the logic belongs before creating new modules.",
    ...brief.edgeCases.map((e) => `Add a test for: ${e}.`),
    "Work in small steps: one test at a time, run the tests after each step, stop and ask when a design choice is not covered.",
    "Respect the Copal rules listed in the brief; explain any rule you think should not apply instead of working around it.",
    REPORT_RULE,
  ];
  return brief;
}

/** The examples-first rule, shared by the brief, the Claude Code hook and the sync-context block. */
export const EXAMPLES_FIRST =
  "Write the agreed examples as failing tests first, show them, and wait for the developer's OK before implementing. Then implement in small steps until they pass — nothing beyond the examples.";

/** The end-of-task report, shared by the brief, the Claude Code hook and the sync-context block. */
export const REPORT_RULE =
  "End every task with two lists: Assumptions I made that you didn't state, and Things I added beyond the agreed examples.";

/** The brief as `.copal/brief.md` — read by any AI assistant, the hook (`Next:`) and the IDE task panel. */
export function briefToMarkdown(b: AgentBrief): string {
  const out = [`# Task: ${b.task}`, ""];
  out.push(`Scope in: ${b.scope.in ?? "(not stated — ask)"}`, `Scope out: ${b.scope.out ?? "(not stated — ask)"}`, "", "## Examples");
  out.push(...(b.examples.length ? b.examples.map((e) => `- [ ] ${e}`) : ["- (none agreed yet — ask for the first example)"]));
  out.push("", "Done when: every example above passes as a test, existing tests stay green, nothing beyond the examples.");
  if (b.examples.length) out.push(`Next: make "${b.examples[0]}" pass`);
  out.push("", "## How to work", ...b.instructions.map((i) => `- ${i}`));
  if (b.rules.length) out.push("", "## Team rules", ...b.rules.map((r) => `- ${r.id}: ${r.what}`));
  return out.join("\n") + "\n";
}

/** Brief rendered as text for an agent's context. */
export function briefToText(b: AgentBrief): string {
  const out = [`Copal navigator brief — ${b.skipped ? "developer skipped the questions" : "agreed with the developer"}`, `Task: ${b.task}`];
  if (b.firstTest) out.push(`First failing test: ${b.firstTest}`);
  if (b.location) out.push(`Location: ${b.location}`);
  if (b.edgeCases.length) out.push(`Edge cases: ${b.edgeCases.join("; ")}`);
  if (b.scope.out) out.push(`Do not touch: ${b.scope.out}`);
  out.push("", "How to work:", ...b.instructions.map((i) => `- ${i}`));
  if (b.rules.length) out.push("", "Team rules:", ...b.rules.map((r) => `- ${r.id}: ${r.what}`));
  return out.join("\n");
}

export function ruleSummary(r: Rule): string {
  if (r.deny) return `no imports across ${r.deny}`;
  if (r.secrets) return "no hard-coded credentials";
  if (r.dependencies) return `dependencies allowed: ${r.dependencies.allow?.join(", ") || "any"}`;
  if (r.requireTest) return `changes need a test matching ${r.requireTest.test}`;
  if (r.smell) return `avoid ${r.smell.kind.replace(/-/g, " ")}${r.smell.max ? ` (max ${r.smell.max})` : ""}`;
  return r.message ?? r.why ?? `avoid /${r.pattern}/`;
}

// ---------------------------------------------------------------- rules from reviews
export interface RuleDraftInput {
  /** The review comment (or `/copal rule …` text) the rule comes from. */
  text: string;
  /** File the comment was made on — scopes the draft to its folder. */
  path?: string;
  /** Link to the discussion — becomes the rule's first source and its reference until a doc exists. */
  source?: string;
  author?: string;
}

export interface RuleDraft {
  rule: Rule;
  yaml: string;
}

/**
 * Turn a recurring review comment into a rule draft a lead finishes and approves. Copal never guesses the
 * detector: it proposes the scope, the why, a question and the reference; the lead adds the check (pattern,
 * deny, smell…) or keeps it as a coaching-only rule that agents receive through `copal sync-context`.
 */
export function draftRuleFromReview(input: RuleDraftInput): RuleDraft {
  const text = input.text.replace(/^\s*\/copal\s+rule\b[:\s]*/i, "").replace(/\s+/g, " ").trim();
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const id = (words.slice(0, 4).join("-") || "review-rule").slice(0, 48);
  const dir = input.path && input.path.includes("/") ? input.path.slice(0, input.path.lastIndexOf("/")) : undefined;
  const sentence = text.replace(/[.!]+$/, "");
  const question = /\?\s*$/.test(text) ? text : `Before you write this: ${sentence.charAt(0).toLowerCase() + sentence.slice(1)} — how does your change handle that?`;
  const rule: Rule = {
    id,
    category: "quality",
    mode: "audit",
    ...(dir ? { paths: [`${dir}/**`] } : {}),
    why: text,
    sources: [input.source ?? "review comment", ...(input.author ? [`@${input.author}`] : [])],
    coach: { question: containsCode(question) ? "What should the author check here before asking for review?" : question, ...(input.source ? { reference: input.source } : {}) },
  };
  const yaml = [
    "# Draft from a review comment — finish and add under `rules:` in .copalrules",
    "# Add ONE check if it can be detected (pattern / deny / smell / requireTest),",
    "# or keep it coaching-only: agents still receive it through `copal sync-context`.",
    `- id: ${rule.id}`,
    `  category: quality`,
    `  mode: audit`,
    ...(dir ? [`  paths: ["${dir}/**"]`] : []),
    `  # pattern: "…"            # e.g. a regex on added lines`,
    `  why: ${JSON.stringify(text)}`,
    `  sources: [${rule.sources!.map((s) => JSON.stringify(s)).join(", ")}]`,
    `  coach:`,
    `    question: ${JSON.stringify(rule.coach!.question)}`,
    ...(input.source ? [`    reference: ${input.source}`] : [`    # reference: docs/rules/${rule.id}.md`]),
    `    # kata: https://sammancoaching.org/kata_descriptions/…`,
  ].join("\n");
  return { rule, yaml };
}

const STOP = new Set(["the", "and", "for", "you", "this", "that", "with", "should", "please", "don", "dont", "not", "are", "use", "here", "have", "from", "into", "our", "we", "always", "never", "must", "avoid", "instead", "copal", "rule"]);

// ---------------------------------------------------------------- agent instruction files
/** Instruction files each AI assistant reads natively. */
export const AGENT_CONTEXT_TARGETS: Record<string, { file: string; header?: string }> = {
  claude: { file: "CLAUDE.md" },
  agents: { file: "AGENTS.md" },
  cursor: { file: ".cursor/rules/copal.mdc", header: "---\ndescription: Team engineering rules from .copalrules (managed by Copal)\nalwaysApply: true\n---\n" },
  copilot: { file: ".github/copilot-instructions.md" },
};
export const CONTEXT_BEGIN = "<!-- copal:begin (generated from .copalrules — edit the rules, not this block) -->";
export const CONTEXT_END = "<!-- copal:end -->";

/** The block every agent reads: rules, questions to ask the developer first, and how to work. */
export function agentContextBlock(policy: Policy, project?: string): string {
  const rules = policy.rules.filter((r) => r.mode !== "off");
  const lines = [CONTEXT_BEGIN, `## Team engineering rules${project ? ` (${project})` : ""}`, ""];
  lines.push("Follow these rules when writing code in this repository. ENFORCED rules block the commit and the PR check.", "");
  for (const r of rules) {
    lines.push(`- **${r.id}**${r.mode === "enforce" ? " (ENFORCED)" : ""}: ${ruleSummary(r)}.${r.why && r.why !== ruleSummary(r) ? ` ${r.why}` : ""}${r.coach?.reference ? ` See ${r.coach.reference}.` : ""}`);
  }
  const qs = rules.filter((r) => r.coach?.question);
  if (qs.length) {
    lines.push("", "### Ask the developer first", "When your change touches one of these rules, ask the question instead of silently deciding:");
    for (const r of qs) lines.push(`- ${r.id}: ${r.coach!.question}`);
  }
  lines.push(
    "",
    "### How to work",
    "- For a feature-sized task, first ask: the first concrete example (it becomes the first failing test), where the code belongs, and what could go wrong.",
    `- ${EXAMPLES_FIRST}`,
    `- ${REPORT_RULE}`,
    "- If `.copal/brief.md` exists, it holds the agreed task, scope and examples.",
    "- Run `copal check --staged` (or the copal_check_staged MCP tool) before committing.",
    CONTEXT_END,
  );
  return lines.join("\n");
}

/** Insert or replace the managed block, leaving everything else in the file untouched. */
export function mergeManagedBlock(current: string, block: string, header?: string): string {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`${esc(CONTEXT_BEGIN)}[\\s\\S]*?${esc(CONTEXT_END)}`);
  if (rx.test(current)) return current.replace(rx, block);
  if (!current) return `${header ?? ""}${block}\n`;
  return `${current}${current.endsWith("\n") ? "" : "\n"}\n${block}\n`;
}
