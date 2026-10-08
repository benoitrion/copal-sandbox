import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Finding, Policy, Report } from "@copal/core";

export interface Project {
  name: string;
  yaml: string;
  policy: Policy;
  updatedAt: string;
  version: number;
}

export interface Analysis extends Report {
  id: string;
  project: string;
  source: "precommit" | "pr" | "mcp" | "ide" | "branch" | "agent" | "ci";
  ref?: string;
  title?: string;
  author?: string;
  agent?: string;
  createdAt: string;
  feedback: { ruleId: string; verdict: string; note?: string; at: string }[];
}

export interface FakePull {
  provider: "github" | "gitlab";
  repo: string; // "owner/repo" or GitLab project id
  number: number;
  title: string;
  author: string;
  headSha: string;
  baseSha: string;
  diff: string;
  files: Record<string, string>; // path -> new content
  reviews: { at: string; event?: string; body: string; comments: { path: string; line: number; body: string }[] }[];
  comments: { at: string; body: string }[];
  statuses: { at: string; sha: string; state: string; context: string; description?: string }[];
}

export interface CoachEventRec {
  project?: string;
  developer?: string;
  ruleId: string;
  category?: string;
  levelReached: number;
  action: string;
  source: string;
  at: string;
}

export interface Kata {
  id: string;
  kind: "canonical" | "micro";
  title: string;
  url?: string;
  source?: string;
  license?: string;
  rules: string[];
  minutes?: number;
  level?: string;
  learningHour?: string;
  /** micro-katas */
  project?: string;
  snippet?: string;
  failingTest?: string;
  instructions?: string;
  completions: { at: string; developer?: string }[];
}

export interface NavSession {
  id: string;
  project?: string;
  developer?: string;
  task: string;
  questions: { id: string; kind: "first-example" | "placement" | "risk"; text: string }[];
  createdAt: string;
  answeredAt?: string;
  skipped?: boolean;
}

const SAMMAN = "https://sammancoaching.org/kata_descriptions";
const credit = { source: "sammancoaching.org (Emily Bache et al.)", license: "CC-BY-SA-4.0" };
export const SEED_KATAS: Kata[] = [
  { id: "k_birthday", kind: "canonical", title: "Birthday Greetings", url: `${SAMMAN}/birthday_greetings.html`, ...credit, rules: ["domain-no-infra"], minutes: 60, level: "intermediate", learningHour: "ports-and-adapters", completions: [] },
  { id: "k_tire", kind: "canonical", title: "Tire Pressure", url: `${SAMMAN}/tire_pressure.html`, ...credit, rules: ["domain-no-framework"], minutes: 45, level: "intermediate", learningHour: "ports-and-adapters", completions: [] },
  { id: "k_receipt", kind: "canonical", title: "Supermarket Receipt", url: `${SAMMAN}/supermarket_receipt.html`, ...credit, rules: ["magic-number-money", "ledger-rounding"], minutes: 90, level: "intermediate", learningHour: "naming-domain-concepts", completions: [] },
  { id: "k_strcalc", kind: "canonical", title: "String Calculator", url: `${SAMMAN}/string_calculator.html`, ...credit, rules: ["skipped-test", "invoice-contract-test"], minutes: 30, level: "beginner", learningHour: "test-first-small-steps", completions: [] },
  { id: "k_fizzbuzz", kind: "canonical", title: "FizzBuzz", url: `${SAMMAN}/fizzbuzz.html`, ...credit, rules: [], minutes: 30, level: "beginner", learningHour: "test-first-small-steps", completions: [] },
  { id: "k_gilded", kind: "canonical", title: "Gilded Rose Refactoring Kata", url: `${SAMMAN}/gilded_rose.html`, ...credit, rules: [], minutes: 90, level: "intermediate", learningHour: "refactoring-legacy-code", completions: [] },
];

export interface State {
  workspace: string;
  keys: { key: string; name: string; createdAt: string }[];
  projects: Record<string, Project>;
  analyses: Analysis[];
  sessions: {
    at: string;
    agent: string;
    project?: string;
    durationMs?: number;
    tokens?: number;
    findings?: number;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    model?: string;
    retries?: number;
    navigatorUsed?: boolean;
  }[];
  heartbeats: number;
  pulls: FakePull[];
  coachEvents: CoachEventRec[];
  navSessions: Record<string, NavSession>;
  katas: Kata[];
}

export const DEFAULT_DEV_KEY = "copal_dev_local";
/** Seed key. Override with COPAL_MOCK_DEV_KEY when the mock is reachable from the internet. */
export const DEV_KEY = process.env.COPAL_MOCK_DEV_KEY || DEFAULT_DEV_KEY;
export const HARDENED = DEV_KEY !== DEFAULT_DEV_KEY || process.env.COPAL_MOCK_PROTECT === "1";

export class Store {
  state: State = {
    workspace: "copal-sandbox",
    keys: [{ key: DEV_KEY, name: "seed dev key", createdAt: new Date().toISOString() }],
    projects: {},
    analyses: [],
    sessions: [],
    heartbeats: 0,
    pulls: [],
    coachEvents: [],
    navSessions: {},
    katas: SEED_KATAS.map((k) => ({ ...k, completions: [] })),
  };

  constructor(private file?: string) {
    if (file && fs.existsSync(file)) {
      this.state = { ...this.state, ...JSON.parse(fs.readFileSync(file, "utf8")) };
    }
    this.state.coachEvents ??= [];
    this.state.navSessions ??= {};
    if (!this.state.katas?.length) this.state.katas = SEED_KATAS.map((k) => ({ ...k, completions: [] }));
    if (!this.state.keys.some((k) => k.key === DEV_KEY)) this.state.keys.push({ key: DEV_KEY, name: "seed dev key", createdAt: new Date().toISOString() });
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  newKey(name: string) {
    const key = "copal_" + crypto.randomBytes(18).toString("base64url");
    this.state.keys.push({ key, name, createdAt: new Date().toISOString() });
    this.save();
    return key;
  }

  validKey(key: string | undefined) {
    return !!key && this.state.keys.some((k) => k.key === key);
  }

  addAnalysis(a: Omit<Analysis, "id" | "createdAt" | "feedback">): Analysis {
    const full: Analysis = { ...a, id: "an_" + crypto.randomBytes(5).toString("hex"), createdAt: new Date().toISOString(), feedback: [] };
    this.state.analyses.unshift(full);
    this.state.analyses = this.state.analyses.slice(0, 500);
    this.save();
    return full;
  }

  /**
   * Growth (the hint ladder as a metric): per rule category, the weekly median level a developer needed
   * (0–4, lower is better), recurrences, and the share of questions answered voluntarily.
   */
  growth(project?: string, developer?: string, since?: string) {
    const from = since ? Date.parse(since) : 0;
    const ev = this.state.coachEvents.filter((e) => (!project || e.project === project) && (!developer || e.developer === developer) && Date.parse(e.at) >= from);
    const week = (iso: string) => {
      const d = new Date(iso);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    };
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
    };
    const cats = new Map<string, typeof ev>();
    for (const e of ev) {
      const c = e.category ?? "other";
      if (!cats.has(c)) cats.set(c, []);
      cats.get(c)!.push(e);
    }
    const categories = [...cats].map(([category, list]) => {
      const weeks = new Map<string, number[]>();
      // Per finding, the highest level reached counts (shown → explain → show_me on the same rule/week).
      for (const e of list) {
        const w = week(e.at);
        if (!weeks.has(w)) weeks.set(w, []);
        weeks.get(w)!.push(e.levelReached);
      }
      const questions = list.filter((e) => e.action === "answered" || e.action === "skipped");
      const recurrence: Record<string, number> = {};
      list.filter((e) => e.action === "shown").forEach((e) => (recurrence[e.ruleId] = (recurrence[e.ruleId] ?? 0) + 1));
      return {
        category,
        weekly: [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, levels]) => ({ weekStart, medianLevel: median(levels), events: levels.length })),
        recurrence,
        answerRate: questions.length ? questions.filter((e) => e.action === "answered").length / questions.length : null,
        showMeShare: list.length ? list.filter((e) => e.action === "show_me").length / list.length : 0,
      };
    });
    return { project: project ?? null, developer: developer ?? null, categories, events: ev.length };
  }

  /** AI usage tied to outcomes: tokens and spend per merged change, retries, navigator vs not. */
  usage(project?: string, since?: string) {
    const from = since ? Date.parse(since) : 0;
    const ss = this.state.sessions.filter((s) => (!project || s.project === project) && Date.parse(s.at) >= from);
    const merged = this.state.analyses.filter((a) => (!project || a.project === project) && a.source === "pr" && !a.blocking && Date.parse(a.createdAt) >= from).length;
    const sum = (xs: typeof ss, f: (s: (typeof ss)[number]) => number | undefined) => xs.reduce((n, s) => n + (f(s) ?? 0), 0);
    const tokens = (s: (typeof ss)[number]) => s.tokens ?? (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
    const group = (xs: typeof ss) => ({
      sessions: xs.length,
      tokensPerSession: xs.length ? Math.round(sum(xs, tokens) / xs.length) : null,
      retriesPerSession: xs.length ? +(sum(xs, (s) => s.retries) / xs.length).toFixed(2) : null,
    });
    return {
      project: project ?? null,
      sessions: ss.length,
      mergedChanges: merged,
      tokensPerMergedChange: merged ? Math.round(sum(ss, tokens) / merged) : null,
      costPerMergedChangeUsd: merged ? +(sum(ss, (s) => s.costUsd) / merged).toFixed(4) : null,
      withNavigator: group(ss.filter((s) => s.navigatorUsed)),
      withoutNavigator: group(ss.filter((s) => !s.navigatorUsed)),
    };
  }

  /** Aggregates for the console "engineering evidence" panel. */
  metrics(project?: string) {
    const list = this.state.analyses.filter((a) => !project || a.project === project);
    const byRule: Record<string, number> = {};
    const fp: Record<string, number> = {};
    let gatesPassed = 0;
    let gatesFailed = 0;
    for (const a of list) {
      a.findings.forEach((f: Finding) => (byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1));
      a.feedback.filter((x) => x.verdict === "false-positive").forEach((x) => (fp[x.ruleId] = (fp[x.ruleId] ?? 0) + 1));
      if (a.source === "pr") a.blocking ? gatesFailed++ : gatesPassed++;
    }
    const bySource: Record<string, number> = {};
    list.forEach((a) => (bySource[a.source] = (bySource[a.source] ?? 0) + 1));
    return {
      analyses: list.length,
      bySource,
      drift: Object.entries(byRule)
        .sort((a, b) => b[1] - a[1])
        .map(([ruleId, count]) => ({ ruleId, count, falsePositives: fp[ruleId] ?? 0 })),
      gates: { passed: gatesPassed, failed: gatesFailed },
      governedChanges: new Set(list.filter((a) => a.source === "pr").map((a) => a.ref)).size,
      sessions: this.state.sessions.length,
      tokens: this.state.sessions.reduce((s, x) => s + (x.tokens ?? 0), 0),
    };
  }
}
