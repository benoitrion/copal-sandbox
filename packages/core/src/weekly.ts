/**
 * Weekly team report: the three disciplines + review flow from merged changes, delivery metrics (DORA definitions)
 * where the data allows, and one next action per slipping discipline. Pure — the caller fetches the data.
 * Team level only: no author appears in the output.
 */
import { startingPractice, trackRank, type Track } from "./ladder";

export interface PullRecord {
  number: number;
  author?: string;
  createdAt: string;
  mergedAt: string;
  /** Oldest commit on the change; falls back to createdAt. */
  firstCommitAt?: string;
  files: { filename: string; additions: number; deletions: number }[];
  reviews?: { author?: string; submittedAt?: string }[];
  /** Items raised by scope-check against the task brief, when the team uses briefs. */
  outOfScope?: number;
  /** The change reverts an earlier one. */
  revert?: boolean;
}

export interface DeploymentRecord {
  at: string;
  /** Deployment failed or needed immediate intervention (rollback, hotfix). */
  failed?: boolean;
  /** Unplanned deployment made because of a production incident. */
  unplanned?: boolean;
}

export interface IncidentRecord {
  openedAt: string;
  resolvedAt?: string;
}

export type DisciplineId = "examples" | "scope" | "steps" | "review";
export type Level = "strong" | "fair" | "needs practice" | "unknown";

export interface DisciplineRow {
  id: DisciplineId;
  name: string;
  metric: string;
  value: number | null;
  previous: number | null;
  /** "better" | "worse" | "stable" | null (no previous week). */
  trend: "better" | "worse" | "stable" | null;
  status: Level;
}

export interface DeliveryMetric {
  name: string;
  value: number | null;
  unit: string;
  /** Why the value is missing, or how it was approximated. */
  note?: string;
}

export interface WeeklyReport {
  from: string;
  to: string;
  changes: number;
  disciplines: DisciplineRow[];
  delivery: DeliveryMetric[];
  /** The discipline to work on next, with what to do this week. */
  focus: { discipline: DisciplineId; name: string; action: string; practice: string } | null;
  /** Team rules dismissed as false positives this week: tune or remove them, or developers stop reading hints. */
  rulesToTune: { ruleId: string; dismissed: number }[];
}

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|testing)\/|[._-](test|spec)s?\.[a-z0-9]+$|Tests?\.(java|kt|cs|scala|swift)$|_test\.(go|py|rb|exs?)$|(^|\/)test_[^/]+\.py$/i;
const IGNORED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock|Gemfile\.lock)$|\.(min\.js|map|snap|svg|png|jpe?g|gif|ico|pdf)$|(^|\/)(dist|build|vendor|node_modules|generated)\//i;
const DOC = /\.(md|mdx|rst|txt|adoc)$/i;
const H = 36e5;

export const isTestPath = (p: string) => TEST_PATH.test(p);

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Discipline metrics for a set of merged changes (also used by the diagnostic). */
export function disciplineMetrics(pulls: PullRecord[]) {
  let code = 0, withTests = 0, unreviewed = 0, big = 0, scoped = 0, outOfScope = 0;
  const sizes: number[] = [], files: number[] = [], firstReview: number[] = [];
  for (const p of pulls) {
    const fs = p.files.filter((f) => !IGNORED.test(f.filename));
    const size = fs.reduce((n, f) => n + f.additions + f.deletions, 0);
    sizes.push(size);
    files.push(fs.length);
    if (size > 400) big++;
    if (fs.some((f) => !isTestPath(f.filename) && !DOC.test(f.filename))) {
      code++;
      if (fs.some((f) => isTestPath(f.filename))) withTests++;
    }
    const others = (p.reviews ?? []).filter((r) => r.author && r.author !== p.author && r.submittedAt).map((r) => Date.parse(r.submittedAt!)).sort((a, b) => a - b);
    if (others.length) firstReview.push(Math.max(0, (others[0] - Date.parse(p.createdAt)) / H));
    else unreviewed++;
    if (p.outOfScope !== undefined) { scoped++; if (p.outOfScope > 0) outOfScope++; }
  }
  const n = pulls.length;
  return {
    changes: n,
    testsWithCode: code ? withTests / code : null,
    medianFiles: median(files),
    outOfScopeShare: scoped ? outOfScope / scoped : null,
    medianSize: median(sizes),
    bigShare: n ? big / n : null,
    medianFirstReviewH: median(firstReview),
    unreviewedShare: n ? unreviewed / n : null,
  };
}

function level(v: number | null, good: number, bad: number, higherIsBetter: boolean): Level {
  if (v == null) return "unknown";
  if (higherIsBetter) return v >= good ? "strong" : v < bad ? "needs practice" : "fair";
  return v <= good ? "strong" : v > bad ? "needs practice" : "fair";
}

function trend(v: number | null, prev: number | null, higherIsBetter: boolean, tolerance: number): DisciplineRow["trend"] {
  if (v == null || prev == null) return null;
  const d = v - prev;
  if (Math.abs(d) <= tolerance) return "stable";
  return (d > 0) === higherIsBetter ? "better" : "worse";
}

/** What to do this week for each discipline (first rung of its practice ladder). */
export const NEXT_ACTIONS: Record<DisciplineId, { action: string; practice: string }> = {
  examples: { action: "Before asking the AI for code, write the examples as tests. Reviewers ask \"which test shows this?\" on changes without one.", practice: "examples-1" },
  scope: { action: "Write a one-line task brief (in scope / out of scope) before each change, and split out anything outside it.", practice: "scope-1" },
  steps: { action: "Keep each change to one behaviour and its test. Split anything over 400 lines before review.", practice: "steps-1" },
  review: { action: "Agree a review slot twice a day, and no merge without a second pair of eyes.", practice: "steps-1" },
};

export function weeklyReport(input: {
  pulls: PullRecord[];
  previous?: PullRecord[];
  deployments?: DeploymentRecord[];
  incidents?: IncidentRecord[];
  /** Hints dismissed as false positives (`/copal false-positive RULE`, `copal-ignore`). */
  dismissals?: { ruleId: string; at: string }[];
  /** The team's track: breaks ties between equally weak disciplines and picks track-specific exercises. */
  track?: Track;
  now?: number;
  days?: number;
}): WeeklyReport {
  const now = input.now ?? Date.now();
  const days = input.days ?? 7;
  const from = now - days * 864e5;
  const inWindow = (t: string) => { const x = Date.parse(t); return x >= from && x <= now; };
  const pulls = input.pulls.filter((p) => inWindow(p.mergedAt));
  const m = disciplineMetrics(pulls);
  const p = input.previous ? disciplineMetrics(input.previous) : null;

  const steps = level(m.medianSize, 200, 400, false);
  const review = (m.unreviewedShare ?? 0) > 0.3 ? "needs practice" : level(m.medianFirstReviewH, 8, 48, false);
  const scopeValue = m.outOfScopeShare ?? m.medianFiles;
  const disciplines: DisciplineRow[] = [
    { id: "examples", name: "Examples first", metric: "Code changes with tests", value: m.testsWithCode, previous: p?.testsWithCode ?? null, trend: trend(m.testsWithCode, p?.testsWithCode ?? null, true, 0.05), status: level(m.testsWithCode, 0.75, 0.5, true) },
    m.outOfScopeShare != null
      ? { id: "scope", name: "Controlled scope", metric: "Changes going beyond their brief", value: scopeValue, previous: p?.outOfScopeShare ?? null, trend: trend(scopeValue, p?.outOfScopeShare ?? null, false, 0.05), status: level(scopeValue, 0.1, 0.3, false) }
      : { id: "scope", name: "Controlled scope", metric: "Files per change (median)", value: scopeValue, previous: p?.medianFiles ?? null, trend: trend(scopeValue, p?.medianFiles ?? null, false, 1), status: level(scopeValue, 5, 12, false) },
    { id: "steps", name: "Small, verified steps", metric: "Lines per change (median)", value: m.medianSize, previous: p?.medianSize ?? null, trend: trend(m.medianSize, p?.medianSize ?? null, false, 25), status: (steps !== "needs practice" && (m.bigShare ?? 0) > 0.3 ? "fair" : steps) as Level },
    { id: "review", name: "Review flow", metric: "Hours to first review (median)", value: m.medianFirstReviewH, previous: p?.medianFirstReviewH ?? null, trend: trend(m.medianFirstReviewH, p?.medianFirstReviewH ?? null, false, 2), status: review as Level },
  ];

  // Delivery (DORA's five software delivery metrics, https://dora.dev/guides/dora-metrics/)
  const deploys = (input.deployments ?? []).filter((d) => inWindow(d.at)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const lead = pulls.map((pr) => {
    const start = Date.parse(pr.firstCommitAt ?? pr.createdAt);
    const merged = Date.parse(pr.mergedAt);
    const next = deploys.find((d) => Date.parse(d.at) >= merged);
    return ((next ? Date.parse(next.at) : merged) - start) / H;
  });
  const delivery: DeliveryMetric[] = [
    { name: "Change lead time", value: median(lead), unit: "hours (median)", note: deploys.length ? "First commit to deployment" : "First commit to merge: no deployment data, so time to production is not included" },
  ];
  if (deploys.length) {
    delivery.push({ name: "Deployment frequency", value: deploys.length / days, unit: "per day" });
    delivery.push({ name: "Change fail rate", value: deploys.filter((d) => d.failed).length / deploys.length, unit: "share of deployments" });
  } else {
    delivery.push({ name: "Deployment frequency", value: null, unit: "per day", note: "Not measured: publish deployments or releases to include it" });
    delivery.push({ name: "Change fail rate", value: null, unit: "share of deployments", note: "Not measured: needs deployment data" });
  }
  // Failed deployment recovery time: a failed deployment to the next successful one.
  const recovery: number[] = [];
  deploys.forEach((d, k) => {
    if (!d.failed || (k > 0 && deploys[k - 1].failed)) return;
    const ok = deploys.slice(k + 1).find((x) => !x.failed);
    if (ok) recovery.push((Date.parse(ok.at) - Date.parse(d.at)) / H);
  });
  delivery.splice(2, 0, deploys.length
    ? { name: "Failed deployment recovery time", value: median(recovery), unit: "hours (median)", note: recovery.length ? undefined : "No failed deployment this week" }
    : { name: "Failed deployment recovery time", value: null, unit: "hours (median)", note: "Not measured: needs deployment data" });
  // Deployment rework rate: unplanned deployments caused by a production incident.
  const incidents = input.incidents ?? [];
  const unplanned = (d: DeploymentRecord) => d.unplanned ?? incidents.some((i) => Date.parse(d.at) >= Date.parse(i.openedAt) && (!i.resolvedAt || Date.parse(d.at) <= Date.parse(i.resolvedAt)));
  delivery.push(deploys.length && (input.incidents || deploys.some((d) => d.unplanned !== undefined))
    ? { name: "Deployment rework rate", value: deploys.filter(unplanned).length / deploys.length, unit: "share of deployments" }
    : { name: "Deployment rework rate", value: null, unit: "share of deployments", note: "Not measured: needs deployments and labelled incidents" });

  // Focus: the weakest discipline, a worsening one first among equals
  const rank: Record<Level, number> = { "needs practice": 0, fair: 1, strong: 2, unknown: 3 };
  const pick = [...disciplines].sort((a, b) => rank[a.status] - rank[b.status] || Number(b.trend === "worse") - Number(a.trend === "worse") || (a.id === "review" || b.id === "review" ? 0 : trackRank(input.track, a.id) - trackRank(input.track, b.id)))[0];
  const focus = pick && pick.status !== "strong" && pick.status !== "unknown"
    ? { discipline: pick.id, name: pick.name, action: NEXT_ACTIONS[pick.id].action, practice: pick.id === "review" ? NEXT_ACTIONS.review.practice : startingPractice(pick.id, pick.status, input.track).id }
    : null;

  const counts = new Map<string, number>();
  for (const d of input.dismissals ?? []) if (inWindow(d.at)) counts.set(d.ruleId, (counts.get(d.ruleId) ?? 0) + 1);
  const rulesToTune = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([ruleId, dismissed]) => ({ ruleId, dismissed }));

  return { from: new Date(from).toISOString(), to: new Date(now).toISOString(), changes: pulls.length, disciplines, delivery, focus, rulesToTune };
}

function fmt(v: number | null, metric: string): string {
  if (v == null) return "—";
  if (/with tests|beyond|share/i.test(metric)) return `${Math.round(v * 100)}%`;
  return String(Math.round(v * 10) / 10);
}

export function weeklyReportToMarkdown(r: WeeklyReport, practiceTitle?: (id: string) => string | undefined): string {
  const arrow = { better: "↗ better", worse: "↘ worse", stable: "→ stable" } as const;
  const out = [`## Copal team report · ${r.from.slice(0, 10)} → ${r.to.slice(0, 10)}`, "", `${r.changes} changes merged. Team level only.`, ""];
  const weekly = Date.parse(r.to) - Date.parse(r.from) <= 7.5 * 864e5;
  out.push(`| Discipline | Measure | ${weekly ? "This week" : "Value"} | Trend | Status |`, "|---|---|---|---|---|");
  for (const d of r.disciplines) out.push(`| ${d.name} | ${d.metric} | ${fmt(d.value, d.metric)} | ${d.trend ? arrow[d.trend] : "—"} | ${d.status} |`);
  out.push("");
  if (r.focus) {
    const t = practiceTitle?.(r.focus.practice);
    out.push(`### ${weekly ? "This week" : "Start with"}: ${r.focus.name}`, "", r.focus.action, ...(t ? ["", `Practice: **${t}**`] : []), "");
  }
  if (r.rulesToTune.length) {
    out.push("### Rules to tune", "", "Developers dismissed these hints as wrong. Fix the rule, narrow its paths, or remove it: noisy hints get ignored.", "");
    for (const t of r.rulesToTune) out.push(`- \`${t.ruleId}\`: dismissed ${t.dismissed} times`);
    out.push("");
  }
  out.push("### Delivery", "", "| Metric | Value | Note |", "|---|---|---|");
  for (const d of r.delivery) out.push(`| ${d.name} | ${d.value == null ? "—" : d.unit.startsWith("share") ? `${Math.round(d.value * 100)}%` : `${Math.round(d.value * 100) / 100} ${d.unit}`} | ${d.note ?? ""} |`);
  out.push("", "_Delivery metrics follow DORA's five software delivery metrics where the data allows: trends to discuss, not targets._");
  return out.join("\n");
}
