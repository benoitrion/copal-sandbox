/**
 * Dashboard analytics as pure functions over plain records. Every backend (the reference server, the Lovable /
 * Supabase backend, a self-hosted one) stores data its own way and calls these — the definitions live in one place.
 */
import type { Finding, Policy } from "./types";

export interface AnalysisRecord {
  project?: string;
  source: string; // precommit | pr | ci | mcp | ide | branch | agent
  createdAt: string;
  findings: Pick<Finding, "ruleId">[];
  feedback?: { ruleId: string; verdict: string }[];
}
export interface FeedbackEventRecord {
  project?: string;
  ruleId: string;
  action: string; // "false_positive" counts
  at: string;
}
export interface SessionRecord {
  project?: string;
  agent: string;
  at: string;
}
export interface NavigatorRecord {
  project?: string;
  answeredAt?: string;
  skipped?: boolean;
}

/** Stages where a finding counts as "caught late": the knowledge didn't reach the developer or the AI earlier. */
export const LATE_SOURCES = ["pr", "ci"];

export type RuleStatus = "recurring" | "noisy" | "caught-late" | "silent" | "uncoached";
export interface RuleHealthRow {
  ruleId: string;
  mode: string;
  hits: number;
  trend: "up" | "down" | "flat";
  caughtLate: number | null;
  falsePositiveRate: number | null;
  lastSeen: string | null;
  status: RuleStatus[];
  kata: string | null;
}

/** Rule health (GET /v1/rules/health): one row per policy rule, rules needing attention first. */
export function ruleHealth(input: {
  policy: Policy | undefined;
  analyses: AnalysisRecord[];
  events?: FeedbackEventRecord[];
  project?: string;
  days?: number;
  now?: number;
}): { project: string | null; days: number; rules: RuleHealthRow[] } {
  const { policy, project } = input;
  const days = input.days ?? 30;
  const now = input.now ?? Date.now();
  const from = now - days * 864e5;
  const mid = now - (days / 2) * 864e5;
  const mine = input.analyses.filter((a) => !project || a.project === project);
  const rows = new Map<string, { hits: number; recent: number; earlier: number; late: number; fp: number; lastSeen?: string }>();
  const row = (id: string) => rows.get(id) ?? rows.set(id, { hits: 0, recent: 0, earlier: 0, late: 0, fp: 0 }).get(id)!;
  for (const a of mine) {
    const t = Date.parse(a.createdAt);
    if (t < from) continue;
    for (const f of a.findings) {
      const r = row(f.ruleId);
      r.hits++;
      t >= mid ? r.recent++ : r.earlier++;
      if (LATE_SOURCES.includes(a.source)) r.late++;
      if (!r.lastSeen || a.createdAt > r.lastSeen) r.lastSeen = a.createdAt;
    }
    for (const fb of a.feedback ?? []) if (fb.verdict === "false-positive") row(fb.ruleId).fp++;
  }
  for (const e of input.events ?? []) if (e.action === "false_positive" && (!project || e.project === project) && Date.parse(e.at) >= from) row(e.ruleId).fp++;
  const since90 = now - 90 * 864e5;
  const seen90 = new Set(mine.filter((a) => Date.parse(a.createdAt) >= since90).flatMap((a) => a.findings.map((f) => f.ruleId)));
  const out = (policy?.rules ?? []).map((rule): RuleHealthRow => {
    const r = rows.get(rule.id) ?? { hits: 0, recent: 0, earlier: 0, late: 0, fp: 0 };
    const caughtLate = r.hits ? r.late / r.hits : null;
    const falsePositiveRate = r.hits ? Math.min(1, r.fp / r.hits) : null;
    const trend = r.recent > r.earlier ? "up" : r.recent < r.earlier ? "down" : "flat";
    const status: RuleStatus[] = [];
    if ((falsePositiveRate ?? 0) >= 0.2 && r.hits >= 3) status.push("noisy");
    if (r.hits >= 3 && trend !== "down") status.push("recurring");
    if ((caughtLate ?? 0) >= 0.5 && r.hits >= 2) status.push("caught-late");
    if (!seen90.has(rule.id)) status.push("silent");
    if (!rule.coach?.question) status.push("uncoached");
    return { ruleId: rule.id, mode: rule.mode ?? "audit", hits: r.hits, trend, caughtLate, falsePositiveRate, lastSeen: r.lastSeen ?? null, status, kata: rule.coach?.kata ?? null };
  });
  return { project: project ?? null, days, rules: out.sort((a, b) => b.status.length - a.status.length || b.hits - a.hits) };
}

/** Reach (GET /v1/reach): is each surface delivering the team's knowledge? */
export function reach(input: { analyses: AnalysisRecord[]; sessions?: SessionRecord[]; navigator?: NavigatorRecord[]; heartbeats?: number; project?: string }) {
  const { project } = input;
  const last = (src: string[]) => input.analyses.filter((a) => (!project || a.project === project) && src.includes(a.source)).map((a) => a.createdAt).sort().pop() ?? null;
  const agents: Record<string, { sessions: number; lastSeen: string }> = {};
  for (const s of (input.sessions ?? []).filter((x) => !project || x.project === project)) {
    const a = (agents[s.agent] ??= { sessions: 0, lastSeen: s.at });
    a.sessions++;
    if (s.at > a.lastSeen) a.lastSeen = s.at;
  }
  const nav = (input.navigator ?? []).filter((n) => !project || n.project === project);
  return {
    project: project ?? null,
    precommit: { lastSeen: last(["precommit"]) },
    prCheck: { lastSeen: last(LATE_SOURCES) },
    agentSelfCheck: { lastSeen: last(["mcp"]) },
    ide: { heartbeats: input.heartbeats ?? 0 },
    agents,
    navigator: { sessions: nav.length, answered: nav.filter((n) => n.answeredAt && !n.skipped).length, skipped: nav.filter((n) => n.skipped).length },
  };
}
