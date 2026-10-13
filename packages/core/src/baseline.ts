/**
 * Baseline: the findings already in the code when a team adopts Copal. They stay quiet, so hints, PR checks and the
 * gate only speak about what a change introduces. Keys follow the line's text, not its number, so edits elsewhere
 * in the file don't wake old findings up. Stored in `.copal/baseline.json` and committed.
 */
import type { Finding, Gate } from "./types";

export interface Baseline {
  version: 1;
  createdAt?: string;
  entries: string[];
}

export const BASELINE_FILE = ".copal/baseline.json";

export function baselineKey(f: Pick<Finding, "ruleId" | "file">, lineText: string): string {
  return `${f.ruleId}|${f.file}|${lineText.trim().replace(/\s+/g, " ")}`;
}

export function createBaseline(findings: Finding[], lineText: (f: Finding) => string, now = new Date()): Baseline {
  return { version: 1, createdAt: now.toISOString().slice(0, 10), entries: [...new Set(findings.map((f) => baselineKey(f, lineText(f))))].sort() };
}

export function parseBaseline(text: string | undefined): Baseline | undefined {
  if (!text) return undefined;
  try {
    const b = JSON.parse(text) as Baseline;
    return Array.isArray(b.entries) ? b : undefined;
  } catch {
    return undefined;
  }
}

/** Findings that are new compared with the baseline. */
export function withoutBaseline(findings: Finding[], baseline: Baseline | undefined, lineText: (f: Finding) => string): Finding[] {
  if (!baseline) return findings;
  const known = new Set(baseline.entries);
  return findings.filter((f) => !known.has(baselineKey(f, lineText(f))));
}

/** Line text of a finding from a change set (full content when present, else the added lines). */
export function lineTextFrom(files: { path: string; content?: string; addedLines: { line: number; text: string }[] }[]): (f: Finding) => string {
  const cache = new Map<string, string[] | null>();
  return (f) => {
    const file = files.find((x) => x.path === f.file);
    if (!file) return "";
    if (!cache.has(f.file)) cache.set(f.file, file.content ? file.content.split(/\r?\n/) : null);
    const lines = cache.get(f.file);
    return (lines ? lines[f.line - 1] : file.addedLines.find((l) => l.line === f.line)?.text) ?? "";
  };
}

// ---------------------------------------------------------------- gate
export interface GateResult {
  passed: boolean;
  reasons: string[];
}

/** Pass/fail for a change, on what it introduces: like a quality gate, in the team's words. */
export function evaluateGate(findings: Finding[], gate: Gate | undefined): GateResult | undefined {
  if (!gate) return undefined;
  const reasons: string[] = [];
  const count = (risk: string) => findings.filter((f) => !f.blocking && f.risk === risk).length;
  const blocking = findings.filter((f) => f.blocking).length;
  if (blocking) reasons.push(`${blocking} finding${blocking > 1 ? "s" : ""} the team set to block`);
  for (const risk of ["high", "medium", "low"] as const) {
    const max = gate.maxNew?.[risk];
    const n = count(risk);
    if (max !== undefined && n > max) reasons.push(`${n} new ${risk}-risk issue${n > 1 ? "s" : ""} (max ${max})`);
  }
  if (gate.requireTests && findings.some((f) => f.kind === "Tests" && /No test/.test(f.message))) reasons.push("code changed without a test");
  return { passed: reasons.length === 0, reasons };
}

export function gateLine(g: GateResult | undefined): string | undefined {
  if (!g) return undefined;
  return g.passed ? "✅ **Gate passed**" : `❌ **Gate failed:** ${g.reasons.join(" · ")}`;
}
