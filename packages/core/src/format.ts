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
export function reportToMarkdown(r: Report, title = "Copal check"): string {
  const status = r.blocking ? "🔴 **Changes requested**" : r.findings.length ? "🟡 **Passed with audit findings**" : "🟢 **Passed**";
  const out = [`### ${title}`, "", `${status} — ${r.summary.blocking} blocking · ${r.summary.audit} audit · env \`${r.environment}\``, ""];
  if (r.findings.length) {
    out.push("| | Rule | Location | Finding |", "|---|---|---|---|");
    for (const f of r.findings) {
      const text = f.coach?.question ? `${f.message} — _${f.coach.question}_` : f.message;
      out.push(`| ${f.blocking ? "⛔" : f.coach ? "💬" : "⚠️"} | \`${f.ruleId}\` | \`${f.file}:${f.line}\` | ${text.replace(/\|/g, "\\|")} |`);
    }
  }
  out.push("", "<sub>Reply `/copal false-positive <rule-id>` or add `// copal-ignore <rule-id>` to suppress a finding.</sub>");
  return out.join("\n");
}

/**
 * Markdown body for one inline review comment — a hint card: question first, explanation folded,
 * fix ("Show me") folded and never as a one-click suggestion when the rule has coaching.
 */
export function findingToMarkdown(f: Finding): string {
  const card = hintCard(f);
  const head = f.blocking ? "⛔ Copal (blocking)" : f.coach ? "💬 Copal coach" : "⚠️ Copal (audit)";
  const out = [`**${head}** · \`${f.ruleId}\``, "", f.message];
  if (card.question) out.push("", `**${card.question}**`);
  const explain: string[] = [];
  if (f.why) explain.push(f.why);
  if (card.reference) explain.push(`Reference: ${card.reference}`);
  if (card.example?.bad) explain.push(`Instead of: \`${card.example.bad}\``);
  if (card.example?.good) explain.push(`Prefer: \`${card.example.good}\``);
  if (explain.length) out.push("", f.coach ? `<details><summary>Explain</summary>\n\n${explain.join("\n\n")}\n\n</details>` : `> ${explain.join("\n> ")}`);
  if (f.suggestion && !f.coach) out.push("", "```suggestion", f.suggestion.replacement, "```");
  else if (card.fix) out.push("", `<details><summary>Show me</summary>\n\n\`\`\`\n${card.fix}\n\`\`\`\n\n</details>`);
  if (card.kata) out.push("", `<sub>Practice: ${card.kata}${card.learningHour ? ` · learning hour: ${card.learningHour}` : ""}</sub>`);
  if (f.sources?.length) out.push("", `<sub>Sources: ${f.sources.join(" · ")}</sub>`);
  return out.join("\n");
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
            : r.message ?? `Avoid pattern /${r.pattern}/`;
    const fix = typeof r.fix === "string" ? r.fix : r.fix?.with;
    out.push(`- [${r.mode === "enforce" ? "ENFORCED" : "audit"}] ${r.id}: ${what}${r.why ? ` — ${r.why}` : ""}${fix ? ` (preferred: ${fix})` : ""}`);
    if (r.coach?.question) out.push(`  Ask the developer before writing this kind of code: "${r.coach.question}"`);
  }
  return out.join("\n");
}
