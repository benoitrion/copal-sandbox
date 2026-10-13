/**
 * Scanner results (SARIF 2.1.0: CodeQL, Semgrep, ESLint, Trivy, Bandit…) as Copal findings, so security and quality
 * tools a team already runs get the same risk ranking, quiet rules and coaching. Only lines the change adds are kept
 * when the change set is given.
 */
import type { Finding, IssueKind, Risk } from "./types";

interface SarifResult {
  ruleId?: string;
  level?: "error" | "warning" | "note" | "none";
  message?: { text?: string };
  locations?: { physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number; startColumn?: number } } }[];
}
interface SarifRule { id: string; shortDescription?: { text?: string }; help?: { text?: string }; properties?: { tags?: string[]; "security-severity"?: string } }
interface SarifRun { tool?: { driver?: { name?: string; rules?: SarifRule[] } }; results?: SarifResult[] }

export function findingsFromSarif(sarif: unknown, changed?: { path: string; addedLines: { line: number }[] }[]): Finding[] {
  const runs = ((sarif as { runs?: SarifRun[] })?.runs ?? []) as SarifRun[];
  const added = changed ? new Map(changed.map((f) => [f.path, new Set(f.addedLines.map((l) => l.line))])) : undefined;
  const out: Finding[] = [];
  for (const run of runs) {
    const tool = (run.tool?.driver?.name ?? "scanner").toLowerCase().replace(/\s+/g, "-");
    const rules = new Map((run.tool?.driver?.rules ?? []).map((r) => [r.id, r]));
    for (const r of run.results ?? []) {
      const loc = r.locations?.[0]?.physicalLocation;
      const file = (loc?.artifactLocation?.uri ?? "").replace(/^file:\/\//, "").replace(/^\.\//, "");
      const line = loc?.region?.startLine ?? 1;
      if (!file) continue;
      if (added && !added.get(file)?.has(line)) continue;
      const rule = rules.get(r.ruleId ?? "");
      const tags = rule?.properties?.tags ?? [];
      const sec = Number(rule?.properties?.["security-severity"] ?? NaN);
      const security = tags.some((t) => /security|cwe/i.test(t)) || !Number.isNaN(sec);
      const risk: Risk = !Number.isNaN(sec) ? (sec >= 7 ? "high" : sec >= 4 ? "medium" : "low") : r.level === "error" ? "high" : r.level === "warning" ? "medium" : "low";
      const kind: IssueKind = security ? "Security" : "Best practice";
      out.push({
        ruleId: `${tool}/${r.ruleId ?? "issue"}`,
        category: security ? "security" : "quality",
        severity: r.level === "error" ? "error" : r.level === "note" ? "info" : "warning",
        mode: "audit",
        blocking: false,
        file,
        line,
        column: loc?.region?.startColumn,
        message: r.message?.text ?? rule?.shortDescription?.text ?? r.ruleId ?? "Scanner finding",
        why: rule?.help?.text?.split("\n")[0],
        risk,
        kind,
      } as Finding);
    }
  }
  return out;
}
