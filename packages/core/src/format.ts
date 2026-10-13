import { hintCard } from "./coach";
import type { Finding, Report, Rule } from "./types";

const useColor = () =>
  typeof process !== "undefined" && !!process.stdout?.isTTY && !process.env?.NO_COLOR;
const c = (code: number) => (s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
export const red = c(31);
export const yellow = c(33);
export const green = c(32);
export const dim = c(2);
export const bold = c(1);
export const cyan = c(36);

export interface FormatOptions {
  /** Reveal level 4 (the fix). Default: only when the report is not in coach mode. */
  showMe?: boolean;
  /** Reveal levels 2–3 (why, reference, example). Default true. */
  explain?: boolean;
}

const coaching = (r: Pick<Report, "policyMode">) => r.policyMode === "coach";

export function formatFinding(f: Finding, opts: FormatOptions = {}): string {
  const showMe = opts.showMe ?? !f.coach;
  const explain = opts.explain ?? true;
  const card = hintCard(f);
  const tag = f.blocking ? red("BLOCK") : f.coach ? cyan("COACH") : yellow("AUDIT");
  const lines = [`${tag} ${bold(`${f.file}:${f.line}${f.column ? ":" + f.column : ""}`)}  ${f.message}  ${dim(`[${f.ruleId}]`)}`];
  if (card.question) lines.push(`      ${cyan("?")} ${card.question}`);
  if (explain) {
    if (f.why) lines.push(`      ${dim("why:")} ${f.why}`);
    if (card.reference) lines.push(`      ${dim("explain:")} ${card.reference}`);
    if (card.example?.bad) lines.push(`      ${dim("instead of:")} ${card.example.bad}`);
    if (card.example?.good) lines.push(`      ${dim("prefer:")}     ${card.example.good}`);
  }
  if (showMe) {
    if (f.suggestion) {
      lines.push(`      ${red("- " + f.suggestion.original.trim())}`);
      lines.push(`      ${green("+ " + f.suggestion.replacement.trim())}`);
    } else if (f.fixText) lines.push(`      ${dim("fix:")} ${f.fixText}`);
  } else if (card.fix) lines.push(`      ${dim("show me: copal check --show-me")}`);
  if (card.kata) lines.push(`      ${dim("practice:")} ${card.kata}`);
  if (f.sources?.length) lines.push(`      ${dim("sources: " + f.sources.join(" · "))}`);
  return lines.join("\n");
}

export function formatReport(r: Report, opts: FormatOptions = {}): string {
  if (!r.findings.length) return green(`✔ Copal: ${r.filesChecked} file(s), ${r.rulesEvaluated} rule(s), no findings (${r.environment}).`);
  const head = r.blocking
    ? red(bold(`✖ Copal: ${r.summary.blocking} blocking finding(s)`)) + `, ${r.summary.audit} audit-only`
    : coaching(r)
      ? cyan(bold(`◇ Copal: ${r.summary.audit} hint(s) to think about`)) + " (nothing blocking)"
      : yellow(bold(`⚠ Copal: ${r.summary.audit} audit finding(s)`)) + " (nothing blocking)";
  const fopts = { ...opts, showMe: opts.showMe ?? (coaching(r) ? false : undefined) };
  return [head + dim(` — env ${r.environment}, ${r.filesChecked} file(s), ${r.rulesEvaluated} rule(s)`), "", ...r.findings.map((f) => formatFinding(f, fopts))].join("\n");
}

/** Markdown body for a PR/MR summary comment. */
/** Findings grouped by rule and file, in report order; blocking findings keep their own group. */
export function groupFindings(findings: Finding[]): Finding[][] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const k = `${f.ruleId}\u0000${f.file}\u0000${f.blocking}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
  }
  return [...groups.values()];
}

export function reportToMarkdown(r: Report, title = "Copal check"): string {
  // Read in mail and on phones: one short line per rule, most risky first, top 5 only. Noise makes people stop reading.
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const rank = (f: Finding) => (f.blocking ? -1 : order[f.risk ?? "low"] ?? 3);
  const byRule = new Map<string, Finding[]>();
  for (const f of r.findings) (byRule.get(f.ruleId) ?? byRule.set(f.ruleId, []).get(f.ruleId)!).push(f);
  const groups = [...byRule.values()].map((g) => g.sort((a, b) => rank(a) - rank(b))).sort((a, b) => rank(a[0]) - rank(b[0]) || b.length - a.length);
  const status = r.blocking ? "🔴 **Changes requested**" : r.findings.length ? `🟡 **${groups.length} thing${groups.length > 1 ? "s" : ""} to look at**` : "🟢 **Passed**";
  const out = [`### ${title}`, "", `${status}${r.blocking ? ` — ${r.summary.blocking} blocking` : ""}`, ""];
  const TOP = 5;
  groups.slice(0, TOP).forEach((g, i) => {
    const f = g[0];
    const risk = f.blocking ? "⛔ Blocking" : f.risk === "high" ? "🔴 High" : f.risk === "medium" ? "🟠 Medium" : "⚪ Low";
    const files = [...new Set(g.map((x) => x.file))];
    const where = `\`${f.file}:${f.line}\`${files.length > 1 ? ` and ${files.length - 1} other file${files.length > 2 ? "s" : ""}` : ""}${g.length > 1 ? ` · ${g.length}×` : ""}`;
    out.push(`${i + 1}. ${risk}${f.kind ? ` · ${f.kind}` : ""} — **${f.message}**`, `   ${where}`);
    if (f.fixText && (f.kind === "Complexity" || f.kind === "Duplication" || f.kind === "Change size")) out.push(`   Suggestion: ${f.fixText.replace(/\n/g, "\n   ")}`);
    else if (hintCard(f).question) out.push(`   _${hintCard(f).question}_`);
    else if (g.length === 1 && f.detail) out.push(`   ${f.detail}`);
  });
  if (groups.length > TOP) out.push("", `<sub>+${groups.length - TOP} lower-risk rule${groups.length - TOP > 1 ? "s" : ""} (${groups.slice(TOP).reduce((n, g) => n + g.length, 0)} findings) in the inline comments.</sub>`);
  out.push("", "<sub>Not relevant? Reply `/copal false-positive <rule-id>`.</sub>");
  return out.join("\n");
}

/**
 * Markdown body for one inline review comment — a hint card: question first, explanation folded,
 * fix ("Show me") folded and never as a one-click suggestion when the rule has coaching.
 */
const KIND_ICON: Record<string, string> = { Security: "🔒", Architecture: "🏛️", Dependencies: "📦", Tests: "🧪", Complexity: "🌀", Duplication: "📑", "Error prone": "🐞", "Best practice": "✨", "Change size": "📏" };

/** Marker so the bot recognises its own inline comments (never repeat one) without parsing the prose. */
export const commentMarker = (ruleId: string, kind?: string) => `<!-- copal:${ruleId}${kind ? `|${kind}` : ""} -->`;

/**
 * One inline review comment, like a good reviewer's: a label with the risk, one specific paragraph (what this code
 * does, why it matters), the change to commit when there is one, and a one-line footer for feedback.
 */
export function findingToMarkdown(f: Finding, opts: { referenceBase?: string } = {}): string {
  const card = hintCard(f);
  const risk = f.blocking ? "⛔ Blocking" : f.risk ? `${f.risk[0].toUpperCase()}${f.risk.slice(1)} risk` : "";
  const label = [f.kind ? `${KIND_ICON[f.kind] ?? "💬"} **${f.kind}**` : "💬 **Copal**", risk].filter(Boolean).join(" · ");
  const sentence = (t: string) => t.replace(/\s+$/, "").replace(/([^.?!:])$/, "$1.");
  const fixLine = card.fix && !card.fix.includes("\n") && !f.suggestion ? ` ${sentence(card.fix)}` : "";
  const body = card.question
    ? `**${card.question}** ${sentence(card.signal)}${f.why ? ` ${sentence(f.why)}` : ""}`
    : `${sentence(card.signal)}${fixLine || (f.why ? ` ${sentence(f.why)}` : "")}`;
  const out = [label, "", body];
  if (f.suggestion) out.push("", "```suggestion", f.suggestion.replacement, "```");
  else if (card.fix && card.fix.includes("\n")) {
    const title = f.kind === "Tests" ? "Suggested test" : f.kind === "Change size" ? "Suggested split" : "Suggested change";
    out.push("", `<details><summary>${title}</summary>\n\n\`\`\`${f.kind === "Tests" ? "ts" : ""}\n${card.fix}\n\`\`\`\n\n</details>`);
  }
  const ref = card.reference ? ` · ${referenceLink(card.reference, opts.referenceBase)}` : "";
  const kata = card.kata ? ` · [practice](${card.kata})` : "";
  out.push("", `<sub>Spotted by **Copal** · \`${f.ruleId}\`${ref}${kata} · Is this helpful? React 👍 or 👎</sub>`, commentMarker(f.ruleId, f.kind));
  return out.join("\n");
}

/** A repo-relative reference becomes a link to that file at the reviewed commit; URLs stay links. */
export function referenceLink(ref: string, base?: string): string {
  if (/^https?:\/\//.test(ref)) return `[${ref.replace(/^https?:\/\//, "")}](${ref})`;
  if (!base) return `\`${ref}\``;
  return `[${ref}](${base.replace(/\/?$/, "/")}${ref.replace(/^\.?\//, "").split("/").map(encodeURIComponent).join("/")})`;
}

/** Rules rendered as agent guidance (MCP). */
export function rulesToGuidance(rules: Rule[], filePath?: string): string {
  if (!rules.length) return `No Copal rules apply${filePath ? ` to ${filePath}` : ""}.`;
  const out = [`Copal engineering policy${filePath ? ` for ${filePath}` : ""} — follow these rules when writing code:`, ""];
  for (const r of rules) {
    const what = r.deny
      ? `Do not import across: ${r.deny}`
      : r.dependencies
        ? `Dependencies — allowed: ${r.dependencies.allow?.join(", ") || "any"}; denied: ${r.dependencies.deny?.join(", ") || "none"}`
        : r.secrets
          ? "Never hard-code credentials; read them from configuration/secret manager."
          : r.requireTest
            ? `Add/update a test matching ${r.requireTest.test}`
            : r.changeSize
              ? `Keep each change small: under ${r.changeSize.maxLines ?? "any number of"} lines and ${r.changeSize.maxFiles ?? "any number of"} files — split larger work into verified steps`
            : r.smell
              ? `Avoid ${r.smell.kind.replace(/-/g, " ")}${r.smell.max ? ` (max ${r.smell.max})` : ""}`
              : r.message ?? `Avoid pattern /${r.pattern}/`;
    const fix = typeof r.fix === "string" ? r.fix : r.fix?.with;
    out.push(`- [${r.mode === "enforce" ? "ENFORCED" : "audit"}] ${r.id}: ${what}${r.why ? ` — ${r.why}` : ""}${fix ? ` (preferred: ${fix})` : ""}`);
    if (r.coach?.question) out.push(`  Ask the developer before writing this kind of code: "${r.coach.question}"`);
  }
  return out.join("\n");
}
