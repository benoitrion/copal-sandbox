/**
 * "Review my change": the engine on the developer's working-tree change plus the scope check, as hint cards in the
 * same format as PR comments. Local only — no server call.
 */
import { hintCard, HintCard } from "./coach";
import { evaluate } from "./engine";
import { findingToMarkdown } from "./format";
import { scopeCheck, ScopeItem } from "./scope";
import type { FileChange, Finding, Policy } from "./types";

export type ReviewAction = "Ask me" | "Explain" | "Show me";

export interface ReviewCard extends HintCard {
  file: string;
  line: number;
  /** The ladder steps this card offers, in order. */
  actions: ReviewAction[];
  /** Same markdown as the PR bot's inline comment. */
  markdown: string;
  finding: Finding;
}

export interface ReviewResult {
  cards: ReviewCard[];
  scope: ScopeItem[];
  blocking: boolean;
}

export function reviewActions(c: HintCard): ReviewAction[] {
  const out: ReviewAction[] = [];
  if (c.question) out.push("Ask me");
  if (c.why || c.reference || c.example) out.push("Explain");
  if (c.fix) out.push("Show me");
  return out;
}

export function reviewChange(changes: FileChange[], policy: Policy, opts: { brief?: string; environment?: string; referenceBase?: string } = {}): ReviewResult {
  const report = evaluate(changes, policy, { environment: opts.environment ?? "local" });
  const cards = report.findings.map((f) => {
    const card = hintCard(f);
    return { ...card, file: f.file, line: f.line, actions: reviewActions(card), markdown: findingToMarkdown(f, { referenceBase: opts.referenceBase }), finding: f };
  });
  return { cards, scope: opts.brief ? scopeCheck(opts.brief, changes) : [], blocking: report.blocking };
}
