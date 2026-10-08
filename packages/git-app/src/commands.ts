/**
 * PR/MR chat commands — the bot answers in the pull request, where the developer already is.
 *   /copal help
 *   /copal explain <rule-id>      the rule as a hint card: question, why, reference, example, kata
 *   /copal rule [text]            draft a rule from this comment (or, as a reply, from the comment it replies to)
 *   /copal false-positive <rule> [note] · /copal accept <rule> [note]   (feedback, handled in handler.ts)
 */
import { draftRuleFromReview, findingToMarkdown, parsePolicy, Policy, resolvePolicy } from "@copal/core";
import { CopalClient } from "@copal/client";

export interface CommandContext {
  body: string;
  author?: string;
  /** Text and file of the comment this one replies to (review threads). */
  parent?: { body: string; path?: string; url?: string };
  path?: string;
  url?: string;
  project?: string;
  loadPolicy: () => Promise<string | undefined>;
  referenceBase?: string;
}

export const COMMAND_RX = /^\s*\/copal\s+(help|explain|rule)\b(.*)$/im;

export const HELP = [
  "**Copal commands**",
  "",
  "- `/copal explain <rule-id>` — the rule's question, why, reference and kata",
  "- `/copal rule <what reviewers keep saying>` — draft a rule; as a reply in a review thread, drafts it from the comment you reply to",
  "- `/copal false-positive <rule-id> [note]` · `/copal accept <rule-id> [note]` — feedback that keeps rules trustworthy",
].join("\n");

/** Returns the markdown reply, or null when the comment holds no command handled here. */
export async function runCommand(ctx: CommandContext, client = new CopalClient()): Promise<string | null> {
  const m = COMMAND_RX.exec(ctx.body ?? "");
  if (!m) return null;
  const [, cmd, rest] = m;
  const arg = rest.trim();

  if (cmd === "help") return HELP;

  if (cmd === "explain") {
    const id = arg.split(/\s+/)[0];
    if (!id) return "Usage: `/copal explain <rule-id>`";
    const text = await ctx.loadPolicy();
    if (!text) return "Copal: this repository has no `.copalrules`.";
    let policy: Policy;
    try {
      policy = resolvePolicy(parsePolicy(text));
    } catch (e) {
      return `Copal: cannot read .copalrules (${(e as Error).message}).`;
    }
    const rule = policy.rules.find((r) => r.id === id);
    if (!rule) return `Copal: no rule \`${id}\`. Rules: ${policy.rules.map((r) => `\`${r.id}\``).join(", ")}`;
    return findingToMarkdown(
      {
        ruleId: rule.id,
        category: rule.category ?? "quality",
        severity: rule.severity ?? "warning",
        mode: rule.mode ?? "audit",
        blocking: rule.mode === "enforce",
        file: "",
        line: 0,
        message: rule.message ?? rule.why ?? rule.id,
        why: rule.message ? rule.why : undefined,
        coach: rule.coach,
        fixText: typeof rule.fix === "string" ? rule.fix : rule.fix?.with,
        sources: rule.sources,
      },
      { referenceBase: ctx.referenceBase },
    );
  }

  // rule: from the inline text, or from the parent comment in a review thread
  const source = arg || ctx.parent?.body?.trim();
  if (!source) return "Usage: `/copal rule <what reviewers keep saying>`, or reply `/copal rule` to a review comment.";
  const draft = draftRuleFromReview({ text: source, path: ctx.parent?.path ?? ctx.path, source: ctx.parent?.url ?? ctx.url, author: ctx.author });
  let recorded = "";
  if (client.remote) {
    try {
      const r = await client.request<{ id: string }>("POST", "/v1/rules/drafts", { project: ctx.project, ...draft.rule, text: source, source: ctx.parent?.url ?? ctx.url, author: ctx.author });
      recorded = `\n\nSaved as draft \`${r.id}\` in the Copal console (Rules → Drafts) for the lead to approve.`;
    } catch {
      recorded = "";
    }
  }
  return [`**Copal · rule draft** from ${ctx.parent ? "this review thread" : "your comment"}`, "", "```yaml", draft.yaml, "```", "", "Add it to `.copalrules`, then run `copal sync-context` so AI assistants receive it too." + recorded].join("\n");
}
