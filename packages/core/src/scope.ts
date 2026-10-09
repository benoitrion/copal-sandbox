/**
 * Scope check: compare a change with the agreed brief (`.copal/brief.md`) and ask about what goes beyond it.
 * Heuristic (word overlap between paths/names and the brief); it asks, it never blocks.
 */
import type { FileChange } from "./types";

export interface ParsedBrief {
  task: string;
  scope: { in?: string; out?: string };
  examples: { text: string; done: boolean }[];
  next?: string;
}

const NOT_STATED = /^\(not stated/i;

export function parseBriefMarkdown(md: string): ParsedBrief {
  const line = (rx: RegExp) => md.match(rx)?.[1]?.trim();
  const keep = (s?: string) => (s && !NOT_STATED.test(s) ? s : undefined);
  const examples = [...md.matchAll(/^\s*-\s*\[([ xX])\]\s+(.+?)\s*$/gm)].map((m) => ({ text: m[2], done: m[1] !== " " }));
  const scope: ParsedBrief["scope"] = {};
  const sin = keep(line(/^Scope in:\s*(.+)$/im));
  const sout = keep(line(/^Scope out:\s*(.+)$/im));
  if (sin) scope.in = sin;
  if (sout) scope.out = sout;
  return { task: line(/^#\s*Task:\s*(.+)$/im) ?? "", scope, examples, next: line(/^Next:\s*(.+)$/im) };
}

export interface ScopeItem {
  file: string;
  question: string;
  /** New exports / endpoints found in the file. */
  details: string[];
}

const STOP = new Set(
  "the and for with from into onto that this then than when what which should must only not don dont touch change changes add adds added new make pass passes error errors test tests spec specs src lib main app index java kotlin ts tsx js jsx mjs cjs kt py go rb cs".split(" "),
);

function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w))
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

const EXPORT = /^\s*(?:export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)|(?:public\s+)?(?:fun|class|object|interface)\s+([A-Za-z_][\w]*))/;
const ENDPOINT = /\b(?:router|app|server|route[rs]?)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]|@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:value\s*=\s*)?["']([^"']+)["']/i;

function newSymbols(c: FileChange): { exports: string[]; endpoints: string[] } {
  const exports: string[] = [];
  const endpoints: string[] = [];
  for (const { text } of c.addedLines) {
    const e = text.match(EXPORT);
    if (e) exports.push(e[1] ?? e[2]);
    const p = text.match(ENDPOINT);
    if (p) endpoints.push(`${(p[1] ?? p[3]).toUpperCase()} ${p[2] ?? p[4]}`);
  }
  return { exports, endpoints };
}

/** Items of the change not covered by the brief's task, in-scope list or examples, as questions. */
export function scopeCheck(briefMd: string, changes: FileChange[]): ScopeItem[] {
  const b = parseBriefMarkdown(briefMd);
  const vocab = new Set(words([b.task, b.scope.in ?? "", ...b.examples.map((e) => e.text)].join(" ")));
  const outWords = new Set(words(b.scope.out ?? ""));
  const hits = (ws: string[], set: Set<string>) => ws.some((w) => set.has(w));
  const items: ScopeItem[] = [];
  for (const c of changes) {
    if (c.status === "deleted" || c.path.startsWith(".copal/")) continue;
    const pathWords = words(c.path);
    const { exports, endpoints } = newSymbols(c);
    const details = [...exports.map((e) => `new export ${e}`), ...endpoints.map((e) => `new endpoint ${e}`)];
    if (b.scope.out && hits(pathWords, outWords)) {
      items.push({ file: c.path, question: `${c.path}: the brief says not to touch "${b.scope.out}" — is this change needed?`, details });
      continue;
    }
    if (!hits(pathWords, vocab)) {
      items.push({ file: c.path, question: `Not in the brief: ${c.path} — keep it?`, details });
      continue;
    }
    const extra = [...exports.filter((e) => !hits(words(e), vocab)).map((e) => `new export ${e}`), ...endpoints.filter((e) => !hits(words(e), vocab)).map((e) => `new endpoint ${e}`)];
    if (extra.length) items.push({ file: c.path, question: `Not in the brief: ${extra.join(", ")} in ${c.path} — keep it?`, details: extra });
  }
  return items;
}
