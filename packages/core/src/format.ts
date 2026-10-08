import type { Finding, Report, Rule } from "./types";

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number) => (s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
export const red = c(31);
export const yellow = c(33);
export const green = c(32);
export const dim = c(2);
export const bold = c(1);
export const cyan = c(36);

export function formatFinding(f: Finding): string {
  const tag = f.blocking ? red("BLOCK") : yellow("AUDIT");
  const lines = [`${tag} ${bold(`${f.file}:${f.line}${f.column ? ":" + f.column : ""}`)}  ${f.message}  ${dim(`[${f.ruleId}]`)}`];
  if (f.why) lines.push(`      ${dim("why:")} ${f.why}`);
  if (f.suggestion) {
    lines.push(`      ${red("- " + f.suggestion.original.trim())}`);
    lines.push(`      ${green("+ " + f.suggestion.replacement.trim())}`);
  }
  if (f.sources?.length) lines.push(`      ${dim("sources: " + f.sources.join(" · "))}`);
  return lines.join("\n");
}

export function formatReport(r: Report): string {
  if (!r.findings.length) return green(`✔ Copal: ${r.filesChecked} file(s), ${r.rulesEvaluated} rule(s), no findings (${r.environment}).`);
  const head = r.blocking
    ? red(bold(`✖ Copal: ${r.summary.blocking} blocking finding(s)`)) + `, ${r.summary.audit} audit-only`
    : yellow(bold(`⚠ Copal: ${r.summary.audit} audit finding(s)`)) + " (nothing blocking)";
  return [head + dim(` — env ${r.environment}, ${r.filesChecked} file(s), ${r.rulesEvaluated} rule(s)`), "", ...r.findings.map(formatFinding)].join("\n");
}

/** Markdown body for a PR/MR summary comment. */
export function reportToMarkdown(r: Report, title = "Copal check"): string {
  const status = r.blocking ? "🔴 **Changes requested**" : r.findings.length ? "🟡 **Passed with audit findings**" : "🟢 **Passed**";
  const out = [`### ${title}`, "", `${status} — ${r.summary.blocking} blocking · ${r.summary.audit} audit · env \`${r.environment}\``, ""];
  if (r.findings.length) {
    out.push("| | Rule | Location | Finding |", "|---|---|---|---|");
    for (const f of r.findings) out.push(`| ${f.blocking ? "⛔" : "⚠️"} | \`${f.ruleId}\` | \`${f.file}:${f.line}\` | ${f.message.replace(/\|/g, "\\|")} |`);
  }
  out.push("", "<sub>Reply `/copal false-positive <rule-id>` or add `// copal-ignore <rule-id>` to suppress a finding.</sub>");
  return out.join("\n");
}

/** Markdown body for one inline review comment. */
export function findingToMarkdown(f: Finding): string {
  const out = [`**${f.blocking ? "⛔ Copal (enforce)" : "⚠️ Copal (audit)"}** · \`${f.ruleId}\``, "", f.message];
  if (f.why) out.push("", `> ${f.why}`);
  if (f.suggestion) out.push("", "```suggestion", f.suggestion.replacement, "```");
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
    out.push(`- [${r.mode === "enforce" ? "ENFORCED" : "audit"}] ${r.id}: ${what}${r.why ? ` — ${r.why}` : ""}${r.fix ? ` (preferred: ${r.fix.with})` : ""}`);
  }
  return out.join("\n");
}
