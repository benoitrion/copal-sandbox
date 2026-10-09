/**
 * Request check: before an AI builds, does the request state a goal, a scope (what not to touch) and a definition of
 * done? Heuristic and cheap — it runs on every prompt. Silent on small, clear or bypassed requests.
 */
export type RequestGap = "goal" | "scope" | "done";

const SMALL = /^\s*(fix (a |the )?typo|rename|format|reformat|bump|lint|sort imports|remove unused|add (a )?comment)\b/i;
const QUESTION = /^\s*(what|why|how|where|when|which|who|is|are|can|could|does|do|explain|show me|tell me)\b|\?\s*$/i;
const BYPASS = /\b(just do it|no questions)\b|(^|[\s.,;:!])skip\s*[.!]?\s*$/i;
const CONTINUE = /^\s*(please\s+)?(continue|go on|keep going|proceed|carry on|next|do it|go ahead|finish( it)?)\b[\w\s.,!]*$/i;
const SCOPE = /\b(only|don'?t (touch|change|modify)|do not (touch|change|modify)|without (changing|touching)|leave .* (untouched|as is)|scope|limited to|nothing else|just (the|this))\b/i;
const DONE = /\b(should|must|expect(ed)?|returns?|so that|done when|until|passes?|pass)\b|→|->|=>/i;

/** Missing elements, most important first: goal, then scope, then done. Empty = clear enough. */
export function requestGaps(prompt: string): RequestGap[] {
  const p = prompt.trim();
  if (!p || SMALL.test(p) || QUESTION.test(p)) return [];
  if (CONTINUE.test(p)) return ["goal"];
  const gaps: RequestGap[] = [];
  if (!SCOPE.test(p)) gaps.push("scope");
  if (!DONE.test(p)) gaps.push("done");
  return gaps;
}

/** The "Next:" line of .copal/brief.md, if any. */
export function briefNextStep(brief?: string): string | undefined {
  return brief?.match(/^\s*Next:\s*(.+?)\s*$/im)?.[1];
}

const QUESTIONS: Record<RequestGap, string> = {
  goal: "What exactly should happen next?",
  scope: "What should this change not touch?",
  done: "How will we know it's done — which example or test should pass?",
};

/**
 * Context for the AI (Claude Code UserPromptSubmit hook): ask the developer ONE question about the most important gap
 * before doing anything. Returns null when the request is clear, small or bypassed.
 */
export function requestCheckContext(prompt: string, brief?: string): string | null {
  if (BYPASS.test(prompt)) return null;
  const gaps = requestGaps(prompt);
  if (!gaps.length) return null;
  const gap = gaps[0];
  const next = gap === "goal" ? briefNextStep(brief) : undefined;
  const lines = [
    "Copal request check: before doing anything, ask the developer exactly one short question and wait for the answer. Do not assume the answer and do not start coding.",
    `Question: ${QUESTIONS[gap]}`,
  ];
  if (next) lines.push("Offer these options:", `1. ${next}`, "2. Something else (they describe it)");
  lines.push('If the developer says "just do it" or "skip", proceed without asking.');
  return lines.join("\n");
}
