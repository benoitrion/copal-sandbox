/**
 * Lightweight code-smell detectors (no AST, no dependencies) for the `smell` rule kind.
 * They run on every keystroke in the IDE plugins, so they are heuristic and cheap: brace/indentation tracking on
 * text with strings and comments blanked out. Findings are hints (audit), never blockers; teams that already run
 * a full analyzer (ESLint, Sonar, PMD…) keep it — Copal adds the question, the reference and the kata.
 */
export type SmellKind = "long-function" | "deep-nesting" | "too-many-params" | "large-file" | "duplicated-literal" | "complexity" | "duplicate-block";

export const SMELL_DEFAULTS: Record<SmellKind, number> = {
  "long-function": 40,
  "deep-nesting": 3,
  "too-many-params": 4,
  "large-file": 400,
  "duplicated-literal": 3,
  complexity: 10,
  "duplicate-block": 3,
};

export interface SmellHit {
  line: number;
  message: string;
  /** Advice specific to this code (what to extract, which values drive the branches…), shown as the fix. */
  advice?: string;
}

const KEYWORDS = new Set("if else for while do switch case break continue return function const let var new typeof instanceof in of true false null undefined this async await try catch finally throw class extends import export default from yield void delete def elif and or not is None True False self pass lambda with as public private protected static final".split(" "));

/** Function spans (start line index, body start/end index, name) found with the brace or indentation scan. */
function functionSpans(lines: string[], isPython: boolean): { start: number; open: number; end: number; name: string }[] {
  const out: { start: number; open: number; end: number; name: string }[] = [];
  if (isPython) {
    lines.forEach((l, i) => {
      const m = /^(\s*)(?:async\s+)?def\s+(\w+)/.exec(l);
      if (!m) return;
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        if (lines[j].length - lines[j].trimStart().length <= m[1].length) break;
        end = j;
      }
      out.push({ start: i, open: i, end, name: m[2] });
    });
    return out;
  }
  for (let i = 0; i < lines.length; i++) {
    if (!FN_START.some((rx) => rx.test(lines[i]))) continue;
    let open = -1;
    for (let j = i; j < Math.min(lines.length, i + 3); j++) if (lines[j].includes("{")) { open = j; break; }
    if (open < 0) continue;
    let depth = 0, end = -1;
    for (let j = open; j < lines.length && end < 0; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) { end = j; break; }
      }
    }
    if (end < 0) continue;
    const name = /([\w$]+)\s*(?:=\s*(?:async\s*)?)?\(/.exec(lines[i])?.[1] ?? "function";
    out.push({ start: i, open, end, name });
  }
  return out;
}

/** What a long function is made of, in one sentence of advice. */
function longFunctionAdvice(body: string[], name: string): string {
  const heads = new Map<string, number>();
  for (const l of body) {
    const m = /^\s*(?:await\s+)?([\w$]+(?:\.[\w$]+)*)\s*\(/.exec(l);
    if (m && !KEYWORDS.has(m[1])) heads.set(m[1], (heads.get(m[1]) ?? 0) + 1);
  }
  const top = [...heads].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 5) return `${name} calls ${top[0]}(…) ${top[1]} times: group those calls into smaller functions (one per area), or drive them from a table.`;
  const blocks = body.join("\n").split(/\n\s*\n/).filter((b) => b.trim()).length;
  if (blocks >= 3) return `${name} has ${blocks} blocks separated by blank lines: give each block a name and extract it as its own function.`;
  return `Extract the steps of ${name} into well-named functions, and keep ${name} as their readable summary.`;
}

/** Cyclomatic complexity of a body, and the identifiers its conditions test most. */
function complexityOf(body: string[]): { score: number; drivers: string[] } {
  let score = 1;
  const vars = new Map<string, number>();
  for (const l of body) {
    const decisions = (l.match(/\b(if|elif|for|while|case|catch|except)\b|&&|\|\||\?(?![.?:])/g) ?? []).length;
    score += decisions;
    // The tested expression only: up to the closing parenthesis (if/while/switch); a switch subject weighs per case.
    const m = /\b(if|elif|while|switch)\b\s*\((.*)\)/.exec(l) ?? /\b(if|elif|while)\b\s+(.*):\s*$/.exec(l);
    if (m) for (const w of m[2].match(/[A-Za-z_$][\w$]*(?:\.[\w$]+)*/g) ?? []) {
      const last = w.split(".").pop()!;
      if (!KEYWORDS.has(last) && last.length > 1) vars.set(last, (vars.get(last) ?? 0) + (m[1] === "switch" ? body.filter((x) => /\bcase\b/.test(x)).length : 1));
    }
  }
  return { score, drivers: [...vars].sort((a, b) => b[1] - a[1]).slice(0, 2).filter(([, n]) => n >= 2).map(([v]) => v) };
}

/** Replace string/char literals and comments with spaces, keeping line structure and column positions. */
export function blankCode(src: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of src.split(/\r?\n/)) {
    let line = "";
    let i = 0;
    let quote: string | null = null;
    while (i < raw.length) {
      const c = raw[i];
      const n = raw[i + 1];
      if (inBlock) {
        if (c === "*" && n === "/") {
          inBlock = false;
          line += "  ";
          i += 2;
        } else {
          line += " ";
          i++;
        }
        continue;
      }
      if (quote) {
        if (c === "\\") {
          line += "  ";
          i += 2;
          continue;
        }
        if (c === quote) quote = null;
        line += c === quote || quote === null ? c : " ";
        i++;
        continue;
      }
      if (c === "/" && n === "/") break;
      if (c === "#" && /^\s*$/.test(line)) break; // python / shell comment line
      if (c === "/" && n === "*") {
        inBlock = true;
        line += "  ";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      line += c;
      i++;
    }
    out.push(line);
  }
  return out;
}

const FN_START = [
  /\bfunction\b[\s\w$]*\(([^)]*)\)/, // function foo(a, b)
  /(?:^|[=:,(]\s*)(?:async\s+)?\(([^)]*)\)\s*(?::\s*[^=]+)?=>/, // (a, b) => / const f = (a) =>
  /^\s*(?:(?:public|private|protected|static|final|async|override|abstract|synchronized|export|default|readonly)\s+)*[\w$<>[\],.?]+\s+[\w$]+\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\{?\s*$/, // Java/C#/TS method: Type name(a, b) {
  /^\s*(?:(?:public|private|protected|static|async|override|get|set)\s+)*(?!if\b|for\b|while\b|switch\b|catch\b|return\b)[\w$]+\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\{\s*$/, // TS/JS method: name(a, b) {
  /^\s*(?:async\s+)?def\s+\w+\s*\(([^)]*)\)/, // python
  /^\s*fun\s+[\w.<>]+\s*\(([^)]*)\)/, // kotlin
  /^\s*func\s+(?:\([^)]*\)\s*)?\w+\s*\(([^)]*)\)/, // go
];
const CONTROL = /\b(if|else|for|foreach|while|do|switch|case|try|catch|finally|when|with)\b/;

function paramCount(list: string): number {
  const cleaned = list.replace(/<[^<>]*>/g, "").replace(/\{[^{}]*\}/g, "x").replace(/\[[^[\]]*\]/g, "x").trim();
  if (!cleaned) return 0;
  return cleaned.split(",").filter((p) => p.trim() && !/^(self|cls|this)\b/.test(p.trim())).length;
}

/** Run one smell detector on full file content. `max` overrides the default threshold. */
export function detectSmell(kind: SmellKind, content: string, max = SMELL_DEFAULTS[kind]): SmellHit[] {
  const lines = blankCode(content);
  const isPython = /^\s*(?:async\s+)?def\s+\w+\s*\(/m.test(content) && !/[{}]/.test(lines.join(""));
  const hits: SmellHit[] = [];

  if (kind === "large-file") {
    const n = content.split(/\r?\n/).filter((l) => l.trim()).length;
    if (n > max) hits.push({ line: 1, message: `File has ${n} non-empty lines (more than ${max})` });
    return hits;
  }

  if (kind === "duplicated-literal") {
    const raw = content.split(/\r?\n/);
    const seen = new Map<string, number[]>();
    raw.forEach((l, i) => {
      if (/^\s*(import|export\s+.*from|from\s+\S+\s+import|package|#include|\/\/|\*|#)/.test(l)) return;
      for (const m of l.matchAll(/(["'])((?:(?!\1)[^\\]|\\.){8,})\1/g)) {
        const v = m[2];
        if (/^[\w./@-]+$/.test(v) && /[/.@]/.test(v) && !/\s/.test(v) && v.split("/").length > 2) continue; // paths / module ids
        seen.set(v, [...(seen.get(v) ?? []), i + 1]);
      }
    });
    for (const [v, at] of seen) if (at.length >= max) hits.push({ line: at[max - 1], message: `String "${v.length > 30 ? v.slice(0, 27) + "…" : v}" repeated ${at.length} times` });
    return hits;
  }

  if (kind === "complexity") {
    for (const f of functionSpans(lines, isPython)) {
      const { score, drivers } = complexityOf(lines.slice(f.open + 1, f.end));
      if (score > max) {
        hits.push({
          line: f.start + 1,
          message: `Function ${f.name} has ${score} decision paths (more than ${max})`,
          advice: drivers.length
            ? `Most branches test ${drivers.map((d) => `\`${d}\``).join(" and ")}: a lookup table or one small function per case would replace them.`
            : `Return early for the simple cases, and extract each remaining branch into a named function.`,
        });
      }
    }
    return hits;
  }

  if (kind === "duplicate-block") {
    // 6 consecutive lines that occur `max`+ times once names, strings and numbers are blanked out
    const spans = functionSpans(lines, isPython);
    const fnAt = (i: number) => spans.filter((f) => i >= f.start && i <= f.end).sort((a, b) => b.start - a.start)[0]?.name;
    const norm = lines.map((l) => l.trim().replace(/(["'`])\s*\1/g, "S").replace(/\s+/g, " ").replace(/\b\d+(\.\d+)?\b/g, "N").replace(/[A-Za-z_$][\w$]*/g, (w) => (KEYWORDS.has(w) ? w : "I")));
    const seen = new Map<string, number[]>();
    for (let i = 0; i + 6 <= norm.length; i++) {
      const win = norm.slice(i, i + 6);
      if (win.filter((x) => x.length > 3 && !/^[{}()\];,]*$/.test(x)).length < 5) continue;
      const k = win.join("\n");
      seen.set(k, [...(seen.get(k) ?? []), i]);
    }
    const groups = [...seen.values()].filter((at) => at.length >= max).sort((a, b) => b.length - a.length);
    const reported = new Set<number>();
    for (const at of groups) {
      if (at.some((i) => reported.has(i))) continue;
      at.forEach((i) => { for (let d = -5; d <= 5; d++) reported.add(i + d); });
      const names = [...new Set(at.map(fnAt).filter(Boolean))] as string[];
      hits.push({
        line: at[1] + 1,
        message: `The same block appears ${at.length} times in this file`,
        advice: names.length > 1
          ? `It is repeated in ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}: keep one function, and pass what differs as a parameter.`
          : `Keep one copy in a named function and call it from each place.`,
      });
    }
    return hits;
  }

  if (kind === "too-many-params") {
    lines.forEach((l, i) => {
      for (const rx of FN_START) {
        const m = rx.exec(l);
        if (!m) continue;
        const n = paramCount(m[1] ?? "");
        const names = (m[1] ?? "").split(",").map((p) => p.trim().split(/[\s:=?]/)[0]).filter(Boolean);
        if (n > max) hits.push({ line: i + 1, message: `Function takes ${n} parameters (more than ${max})`, advice: `Parameters ${names.join(", ")}: group the ones that always travel together into one object with a name.` });
        break;
      }
    });
    return hits;
  }

  if (kind === "long-function") {
    if (isPython) {
      lines.forEach((l, i) => {
        const m = /^(\s*)(?:async\s+)?def\s+(\w+)/.exec(l);
        if (!m) return;
        const indent = m[1].length;
        let end = i;
        for (let j = i + 1; j < lines.length; j++) {
          if (!lines[j].trim()) continue;
          if (lines[j].length - lines[j].trimStart().length <= indent) break;
          end = j;
        }
        const len = lines.slice(i + 1, end + 1).filter((x) => x.trim()).length;
        if (len > max) hits.push({ line: i + 1, message: `Function ${m[2]} is ${len} lines long (more than ${max})`, advice: longFunctionAdvice(lines.slice(i + 1, end + 1), m[2]) });
      });
      return hits;
    }
    for (let i = 0; i < lines.length; i++) {
      if (!FN_START.some((rx) => rx.test(lines[i]))) continue;
      // find the opening brace (same or next line), then its matching close
      let open = -1;
      for (let j = i; j < Math.min(lines.length, i + 3); j++) if (lines[j].includes("{")) {
        open = j;
        break;
      }
      if (open < 0) continue;
      let depth = 0;
      let end = -1;
      for (let j = open; j < lines.length && end < 0; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") depth++;
          else if (ch === "}" && --depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end < 0) continue;
      const body = lines.slice(open + 1, end).filter((x) => x.trim()).length;
      if (body > max) {
        const name = /([\w$]+)\s*(?:=\s*(?:async\s*)?)?\(/.exec(lines[i])?.[1] ?? "function";
        hits.push({ line: i + 1, message: `Function ${name} is ${body} lines long (more than ${max})`, advice: longFunctionAdvice(lines.slice(open + 1, end), name) });
        i = open; // nested functions are checked too, but don't re-report the same start
      }
    }
    return hits;
  }

  // deep-nesting: count open control-flow blocks
  if (isPython) {
    const stack: number[] = [];
    lines.forEach((l, i) => {
      if (!l.trim()) return;
      const indent = l.length - l.trimStart().length;
      while (stack.length && indent <= stack[stack.length - 1]) stack.pop();
      if (/^\s*(if|elif|else|for|while|try|except|finally|with)\b.*:\s*$/.test(l)) {
        stack.push(indent);
        if (stack.length === max + 1) hits.push({ line: i + 1, message: `Control flow nested ${stack.length} levels deep (more than ${max})` });
      }
    });
    return hits;
  }
  const stack: boolean[] = [];
  let pendingControl = false;
  lines.forEach((l, i) => {
    const control = CONTROL.test(l) || pendingControl;
    pendingControl = control && !l.includes("{") && /\)\s*$|\belse\s*$|\btry\s*$|\bdo\s*$/.test(l);
    let reported = false;
    for (const ch of l) {
      if (ch === "{") {
        stack.push(control);
        const depth = stack.filter(Boolean).length;
        if (control && depth === max + 1 && !reported) {
          hits.push({ line: i + 1, message: `Control flow nested ${depth} levels deep (more than ${max})` });
          reported = true;
        }
      } else if (ch === "}") stack.pop();
    }
  });
  return hits;
}
