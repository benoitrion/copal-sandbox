/**
 * Reviewer guide: tells the reviewer where to look first, so review effort goes to the tests, the brief and the
 * risky files instead of every line. Pure; works on the same FileChange[] and findings as the checks.
 */
import { matchGlob, normalizePath } from "./glob";
import type { FileChange, Finding, Policy } from "./types";
import { isTestPath } from "./weekly";

const LOW = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock)$|\.(md|mdx|rst|txt|snap|svg|png|jpe?g|gif)$|(^|\/)(dist|build|vendor|generated)\//i;

export interface ReviewerGuide {
  tests: string[];
  briefUsed: boolean;
  risky: { path: string; reasons: string[] }[];
  rest: string[];
  lowRisk: string[];
}

export function reviewerGuide(input: { files: FileChange[]; findings?: Finding[]; policy?: Policy; outOfScope?: string[]; briefUsed?: boolean; largeFile?: number }): ReviewerGuide {
  const large = input.largeFile ?? 200;
  const riskGlobs = input.policy?.risk ?? [];
  const guide: ReviewerGuide = { tests: [], briefUsed: !!input.briefUsed, risky: [], rest: [], lowRisk: [] };
  for (const f of input.files.filter((x) => x.status !== "deleted")) {
    const p = normalizePath(f.path);
    if (isTestPath(p)) { guide.tests.push(p); continue; }
    if (LOW.test(p)) { guide.lowRisk.push(p); continue; }
    const reasons: string[] = [];
    const glob = riskGlobs.find((g) => matchGlob(p, g));
    if (glob) reasons.push(`risk path (${glob})`);
    const rules = [...new Set((input.findings ?? []).filter((x) => normalizePath(x.file) === p).map((x) => x.ruleId))];
    if (rules.length) reasons.push(`team rule: ${rules.join(", ")}`);
    if (input.outOfScope?.some((o) => normalizePath(o) === p)) reasons.push("outside the brief");
    if (f.addedLines.length > large) reasons.push(`${f.addedLines.length} lines added`);
    if (reasons.length) guide.risky.push({ path: p, reasons });
    else guide.rest.push(p);
  }
  return guide;
}

export function reviewerGuideToMarkdown(g: ReviewerGuide): string {
  const out = ["### Reviewer guide", ""];
  const first: string[] = [];
  if (g.briefUsed) first.push("the task brief (`.copal/brief.md`): is this the right change?");
  first.push(g.tests.length ? `the tests (${g.tests.map((t) => `\`${t}\``).join(", ")}): do they state the business rule?` : "**no test changed**: ask which example proves this change is right");
  out.push("**1. Read first:** " + first.join("; "), "");
  out.push(g.risky.length ? "**2. Then the risky files:**" : "**2. Risky files:** none flagged", "");
  for (const r of g.risky) out.push(`- \`${r.path}\`: ${r.reasons.join(", ")}`);
  if (g.risky.length) out.push("");
  if (g.rest.length) out.push(`**3. The rest** (${g.rest.length} file${g.rest.length > 1 ? "s" : ""}): a quick read is usually enough when the tests above are convincing.`, "");
  if (g.lowRisk.length) out.push(`_Low risk, skim or skip: ${g.lowRisk.length} file${g.lowRisk.length > 1 ? "s" : ""} (docs, lockfiles, generated)._`);
  return out.join("\n").trim();
}
