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
  rules: { id: string; what: string }[];
  /** Instructions handed to the agent. */
  instructions: string[];
}

/** Turn the developer's answers into the brief the agent works from (test first, small steps). */
export function buildBrief(policy: Policy | undefined, task: string, questions: NavigatorQuestion[], answers: NavigatorAnswer[], skipped = false): AgentBrief {
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
    rules: (policy?.rules ?? []).filter((r) => r.mode !== "off").slice(0, 12).map((r) => ({ id: r.id, what: ruleSummary(r) })),
    instructions: [],
  };
  brief.instructions = [
    brief.firstTest ? `Start with one failing test for: ${brief.firstTest}. Make it pass with the simplest code, then refactor.` : "Start with one failing test for the simplest case, make it pass, then refactor.",
    brief.location ? `Put the logic where the developer said: ${brief.location}.` : "Ask the developer where the logic belongs before creating new modules.",
    ...brief.edgeCases.map((e) => `Add a test for: ${e}.`),
    "Work in small steps: one test at a time, run the tests after each step, stop and ask when a design choice is not covered.",
    "Respect the Copal rules listed in the brief; explain any rule you think should not apply instead of working around it.",
  ];
  return brief;
}

/** Brief rendered as text for an agent's context. */
export function briefToText(b: AgentBrief): string {
  const out = [`Copal navigator brief — ${b.skipped ? "developer skipped the questions" : "agreed with the developer"}`, `Task: ${b.task}`];
  if (b.firstTest) out.push(`First failing test: ${b.firstTest}`);
  if (b.location) out.push(`Location: ${b.location}`);
  if (b.edgeCases.length) out.push(`Edge cases: ${b.edgeCases.join("; ")}`);
  out.push("", "How to work:", ...b.instructions.map((i) => `- ${i}`));
  if (b.rules.length) out.push("", "Team rules:", ...b.rules.map((r) => `- ${r.id}: ${r.what}`));
  return out.join("\n");
}

export function ruleSummary(r: Rule): string {
  if (r.deny) return `no imports across ${r.deny}`;
  if (r.secrets) return "no hard-coded credentials";
  if (r.dependencies) return `dependencies allowed: ${r.dependencies.allow?.join(", ") || "any"}`;
  if (r.requireTest) return `changes need a test matching ${r.requireTest.test}`;
  return r.message ?? r.why ?? `avoid /${r.pattern}/`;
}
