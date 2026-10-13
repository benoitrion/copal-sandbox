import { anyDetail, testDetail, testSkeletonFor } from "./detail";
import { splitPlan, splitPlanText } from "./split";
import * as posix from "./posix";
import { inScope, matchGlob, normalizePath } from "./glob";
import { BUILTIN_REDACT, effectiveRules } from "./policy";
import { detectSmell } from "./smells";
import type { Category, FileChange, Finding, IssueKind, Policy, Report, Risk, Rule, Severity } from "./types";

export interface EvaluateOptions {
  environment?: string;
  /** Only evaluate these rule ids. */
  only?: string[];
}

const IMPORT_RX = [
  /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+[^'"]*?\s+from\s+["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const NON_DEP_KEYS = new Set(["name", "version", "description", "main", "types", "module", "node", "npm", "license", "type", "private"]);

export function evaluate(changes: FileChange[], policy: Policy, opts: EvaluateOptions = {}): Report {
  const environment = opts.environment ?? "local";
  let rules = effectiveRules(policy, environment);
  if (opts.only?.length) rules = rules.filter((r) => opts.only!.includes(r.id));
  const files = changes.filter((c) => c.status !== "deleted").map((c) => ({ ...c, path: normalizePath(c.path) }));
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (rule.requireTest) {
      findings.push(...checkRequireTest(rule, files));
      continue;
    }
    if (rule.changeSize) {
      findings.push(...checkChangeSize(rule, files));
      continue;
    }
    for (const file of files) {
      if (!inScope(file.path, rule.paths, rule.exclude)) continue;
      let found: Finding[] = [];
      if (rule.deny) found = checkBoundary(rule, file);
      else if (rule.pattern) found = checkPattern(rule, file);
      else if (rule.secrets) found = checkSecrets(rule, file, policy);
      else if (rule.dependencies) found = checkDependencies(rule, file);
      else if (rule.smell) found = checkSmell(rule, file);
      findings.push(...found.filter((f) => !isSuppressed(file, f)));
    }
  }

  findings.sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.file.localeCompare(b.file) || a.line - b.line);
  const byCategory: Record<string, number> = {};
  for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  const blocking = findings.filter((f) => f.blocking).length;
  return {
    environment,
    policyMode: policy.mode ?? (policy.version >= 4 ? "coach" : "audit"),
    findings,
    blocking: blocking > 0,
    summary: { total: findings.length, blocking, audit: findings.length - blocking, byCategory },
    filesChecked: files.length,
    rulesEvaluated: rules.length,
  };
}

function base(rule: Rule, file: string, line: number, message: string, cat: Category, sev: Severity): Finding {
  const mode = rule.mode ?? "audit";
  return {
    ruleId: rule.id,
    category: rule.category ?? cat,
    severity: rule.severity ?? sev,
    mode,
    blocking: mode === "enforce",
    file,
    line,
    message: rule.message ?? message,
    why: rule.why,
    sources: rule.sources,
    ...(rule.coach ? { coach: rule.coach } : {}),
    ...classify(rule, rule.category ?? cat, rule.severity ?? sev, mode === "enforce"),
    ...(typeof rule.fix === "string" ? { fixText: rule.fix } : {}),
  };
}

/** Risk and family of a rule's findings: what a lead sees first, in every surface. Rules can override both. */
export function classify(rule: Rule, category: Category | string, severity: Severity | string, blocking: boolean): { risk: Risk; kind: IssueKind } {
  const smell = rule.smell?.kind;
  let kind: IssueKind, risk: Risk;
  if (category === "security") [kind, risk] = ["Security", "high"];
  else if (category === "architecture") [kind, risk] = ["Architecture", "medium"];
  else if (category === "dependency") [kind, risk] = ["Dependencies", "medium"];
  else if (rule.id === "focused-test") [kind, risk] = ["Error prone", "high"];
  else if (rule.changeSize) [kind, risk] = ["Change size", "low"];
  else if (category === "testing") [kind, risk] = ["Tests", rule.id === "skipped-test" ? "low" : "medium"];
  else if (smell === "duplicate-block" || smell === "duplicated-literal") [kind, risk] = ["Duplication", smell === "duplicate-block" ? "medium" : "low"];
  else if (smell) [kind, risk] = ["Complexity", smell === "complexity" ? "medium" : "low"];
  else [kind, risk] = ["Best practice", severity === "error" ? "medium" : "low"];
  if (blocking || severity === "error") risk = "high";
  return { risk: rule.risk ?? risk, kind: rule.kind ?? kind };
}

/** `// copal-ignore rule-id` on the same or previous line suppresses a finding (recorded as a false positive). */
function isSuppressed(file: FileChange, f: Finding): boolean {
  const lines = file.content ? file.content.split(/\r?\n/) : null;
  const get = (n: number) => (lines ? lines[n - 1] : file.addedLines.find((l) => l.line === n)?.text) ?? "";
  const rx = new RegExp(`copal-ignore[: ]\\s*(\\*|[\\w,-]*\\b${f.ruleId}\\b)`);
  return rx.test(get(f.line)) || rx.test(get(f.line - 1));
}

// ---------------------------------------------------------------- boundary
export function parseDeny(deny: string): { from: string[]; to: string[] } {
  const [l, r] = deny.split(/\s+->\s+/);
  const split = (s: string) => s.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
  return { from: split(l ?? ""), to: split(r ?? "") };
}

function resolveImport(fromFile: string, spec: string): string {
  if (!spec.startsWith(".")) return spec;
  return posix.normalize(posix.join(posix.dirname(fromFile), spec));
}

function checkBoundary(rule: Rule, file: FileChange): Finding[] {
  const { from, to } = parseDeny(rule.deny!);
  if (!matchGlob(file.path, from)) return [];
  const out: Finding[] = [];
  for (const { line, text } of file.addedLines) {
    for (const rx of IMPORT_RX) {
      rx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(text))) {
        const target = resolveImport(file.path, m[1]);
        const candidates = [target, `${target}/index`, `${target}.ts`];
        if (candidates.some((c) => matchGlob(c, to))) {
          const f = base(rule, file.path, line, `Import of "${m[1]}" crosses a forbidden boundary (${rule.deny})`, "architecture", "error");
          f.column = text.indexOf(m[1]) + 1;
          f.endColumn = f.column + m[1].length;
          out.push(f);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- pattern
function checkPattern(rule: Rule, file: FileChange): Finding[] {
  const flags = (rule.flags ?? "").replace("g", "");
  const rx = new RegExp(rule.pattern!, flags);
  const out: Finding[] = [];
  for (const { line, text } of file.addedLines) {
    const m = rx.exec(text);
    if (!m) continue;
    const f = base(rule, file.path, line, `Matches forbidden pattern of rule ${rule.id}`, "quality", "warning");
    f.column = m.index + 1;
    f.endColumn = m.index + m[0].length + 1;
    if (/\bany\b/.test(rule.pattern!)) {
      const d = anyDetail(text, file.content ?? file.addedLines.map((l) => l.text).join("\n"));
      if (d) Object.assign(f, { detail: d.detail }, d.fix && !f.fixText ? { fixText: d.fix } : {});
    }
    if (rule.fix && typeof rule.fix === "object") {
      if (!f.detail) f.detail = `${f.message}: \`${m[0].trim()}\``;
      const fixRx = new RegExp(rule.fix.replace ?? rule.pattern!, flags);
      const replacement = text.replace(fixRx, rule.fix.with);
      if (replacement !== text) f.suggestion = { original: text, replacement };
    }
    out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------- secrets
export function mask(s: string): string {
  return s.length <= 8 ? "****" : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function checkSecrets(rule: Rule, file: FileChange, policy: Policy): Finding[] {
  const detectors = [...BUILTIN_REDACT, ...(policy.redact ?? [])];
  const out: Finding[] = [];
  for (const { line, text } of file.addedLines) {
    for (const d of detectors) {
      const m = new RegExp(d.pattern, (d.flags ?? "").replace("g", "")).exec(text);
      if (!m) continue;
      const secret = m[1] ?? m[0];
      if (/^(process\.env|<|\$\{|your[-_]|xxx|changeme|example)/i.test(secret)) continue;
      const f = base(rule, file.path, line, `Hard-coded credential detected (${d.name}: ${mask(secret)})`, "security", "error");
      f.column = m.index + 1;
      f.endColumn = m.index + m[0].length + 1;
      out.push(f);
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- dependencies
function depNames(file: FileChange): Set<string> | null {
  if (!file.content) return null;
  try {
    const pkg = JSON.parse(file.content) as Record<string, Record<string, string>>;
    return new Set(DEP_SECTIONS.flatMap((s) => Object.keys(pkg[s] ?? {})));
  } catch {
    return null;
  }
}

function checkDependencies(rule: Rule, file: FileChange): Finding[] {
  if (posix.basename(file.path) !== "package.json") return [];
  const known = depNames(file);
  const { allow, deny } = rule.dependencies!;
  const out: Finding[] = [];
  for (const { line, text } of file.addedLines) {
    const m = /^\s*"([^"]+)"\s*:\s*"([^"]*)"/.exec(text);
    if (!m) continue;
    const [, name, version] = m;
    if (known ? !known.has(name) : NON_DEP_KEYS.has(name) || !/^[\^~><=*\dxvwl]|^(npm|git|file|workspace):/.test(version)) continue;
    const denied = deny?.some((g) => matchGlob(name, g));
    const notAllowed = allow && allow.length > 0 && !allow.some((g) => matchGlob(name, g));
    if (denied || notAllowed) {
      const f = base(
        rule,
        file.path,
        line,
        denied ? `Dependency "${name}" is on the deny list` : `Dependency "${name}" is not on the approved list`,
        "dependency",
        "error",
      );
      f.column = text.indexOf(`"${name}"`) + 1;
      f.endColumn = f.column + name.length + 2;
      out.push(f);
    }
  }
  return out;
}

// ---------------------------------------------------------------- smells
/** Needs full content. Reports only smells anchored on a changed line (or anywhere in a new file / editor buffer). */
function checkSmell(rule: Rule, file: FileChange): Finding[] {
  if (!file.content) return [];
  const added = new Set(file.addedLines.map((l) => l.line));
  const whole = file.status === "added" || added.size >= file.content.split(/\r?\n/).length;
  return detectSmell(rule.smell!.kind, file.content, rule.smell!.max)
    .filter((h) => whole || added.has(h.line))
    .map((h) => ({ ...base(rule, file.path, h.line, h.message, "quality", "info"), ...(h.advice ? { fixText: h.advice } : {}) }));
}

// ---------------------------------------------------------------- tests
function checkRequireTest(rule: Rule, files: FileChange[]): Finding[] {
  const out: Finding[] = [];
  const isTest = (p: string) => /\.(test|spec)\.[jt]sx?$/.test(p) || p.includes("/__tests__/");
  for (const file of files) {
    if (isTest(file.path) || !inScope(file.path, rule.paths, rule.exclude)) continue;
    const dir = posix.dirname(file.path);
    const name = posix.basename(file.path).replace(/\.[^.]+$/, "");
    const expected = rule.requireTest!.test.replace(/\{dir\}/g, dir).replace(/\{name\}/g, name);
    if (!files.some((f) => matchGlob(f.path, expected))) {
      const f = base(rule, file.path, file.addedLines[0]?.line ?? 1, `No test changed for ${posix.basename(file.path)} (for example ${concreteTestPath(expected, file.path)})`, "testing", "warning");
      const d = testDetail(posix.basename(file.path), file.content ?? file.addedLines.map((l) => l.text).join("\n"));
      if (d) f.detail = `${d}; add \`${concreteTestPath(expected, file.path)}\``;
      const skeleton = testSkeletonFor(file.path, concreteTestPath(expected, file.path), file.content ?? file.addedLines.map((l) => l.text).join("\n"));
      if (skeleton && !f.fixText) f.fixText = skeleton;
      out.push(f);
    }
  }
  return out;
}

// ---------------------------------------------------------------- change size
/** Small, verified steps: one finding for the whole change when it exceeds the rule's line or file budget. */
export function changeSizeOf(rule: Rule, files: FileChange[]): { lines: number; files: number } {
  const own = files.filter((f) => inScope(normalizePath(f.path), rule.paths, rule.exclude));
  return { lines: own.reduce((n, f) => n + f.addedLines.length, 0), files: own.length };
}

function checkChangeSize(rule: Rule, files: FileChange[]): Finding[] {
  const { maxLines, maxFiles } = rule.changeSize!;
  const size = changeSizeOf(rule, files);
  const over: string[] = [];
  if (maxLines && size.lines > maxLines) over.push(`${size.lines} lines (budget ${maxLines})`);
  if (maxFiles && size.files > maxFiles) over.push(`${size.files} files (budget ${maxFiles})`);
  if (!over.length) return [];
  const first = files.find((f) => inScope(normalizePath(f.path), rule.paths, rule.exclude))!;
  const f = base(rule, first.path, first.addedLines[0]?.line ?? 1, `This change is ${over.join(" and ")}: too big to verify in one step`, "quality", "info");
  const steps = splitPlan(files.filter((x) => inScope(normalizePath(x.path), rule.paths, rule.exclude)));
  if (steps.length > 1) {
    f.detail = `${size.lines} lines in ${size.files} files; it splits into ${steps.length} changes`;
    f.fixText = `Split it, each step reviewed and merged on its own:\n${splitPlanText(steps)}`;
  }
  return [f];
}

/**
 * A concrete test path from a glob template, for messages and "Create the test":
 * "src/**\/reminders.test.ts" for src/payments/reminders.ts → "src/payments/reminders.test.ts".
 */
export function concreteTestPath(expected: string, file: string): string {
  const i = expected.indexOf("**");
  if (i < 0) return expected;
  const prefix = expected.slice(0, i);
  const dirSegs = posix.dirname(file).split("/");
  const preSegs = prefix.split("/").filter(Boolean);
  // Continue after the last folder the template's prefix shares with the file (src/main/java → src/test/java).
  let at = -1;
  for (let k = preSegs.length - 1; k >= 0 && at < 0; k--) at = dirSegs.lastIndexOf(preSegs[k]);
  const rest = (at >= 0 ? dirSegs.slice(at + 1) : dirSegs.slice(1)).join("/");
  return (prefix + rest + "/" + expected.slice(i + 2).replace(/^\/+/, "")).replace(/\/+/g, "/");
}

// ---------------------------------------------------------------- redaction
export interface RedactionResult {
  text: string;
  redactions: { name: string; count: number }[];
}

/** Remove secrets / restricted context before text leaves the machine (MCP, model calls). */
export function redact(text: string, policy?: Policy): RedactionResult {
  const counts = new Map<string, number>();
  let out = text;
  for (const d of [...BUILTIN_REDACT, ...(policy?.redact ?? [])]) {
    const flags = (d.flags ?? "").includes("g") ? d.flags! : (d.flags ?? "") + "g";
    out = out.replace(new RegExp(d.pattern, flags), (whole: string, g1?: string) => {
      counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
      const tag = `[REDACTED:${d.name}]`;
      return typeof g1 === "string" && g1 && whole.includes(g1) ? whole.replace(g1, tag) : tag;
    });
  }
  return { text: out, redactions: [...counts].map(([name, count]) => ({ name, count })) };
}

/** Rules that apply to a given path — what Copal MCP hands to agents before they write code. */
export function applicableRules(policy: Policy, filePath: string | undefined, environment = "local"): Rule[] {
  const rules = effectiveRules(policy, environment);
  if (!filePath) return rules;
  const p = normalizePath(filePath);
  return rules.filter((r) => {
    if (r.deny) return matchGlob(p, parseDeny(r.deny).from) && inScope(p, r.paths, r.exclude);
    if (r.dependencies) return posix.basename(p) === "package.json";
    return inScope(p, r.paths, r.exclude);
  });
}

// ---------------------------------------------------------------- tests first (commit order)
export interface CommitFiles {
  sha: string;
  /** Paths touched by the commit. */
  files: string[];
}

/**
 * Tests-first check for the PR/CI path: for every requireTest rule, an implementation file whose first commit on the
 * branch comes before the first commit of its test. Always audit (never blocks), phrased as a question; the rule's
 * coaching (explanation, reference, kata) stays attached for the ladder. `commits` is oldest first.
 */
export function testOrderFindings(policy: Policy, commits: CommitFiles[], environment = "ci"): Finding[] {
  const first = new Map<string, number>();
  commits.forEach((c, i) => c.files.map(normalizePath).forEach((p) => first.has(p) || first.set(p, i)));
  const paths = [...first.keys()];
  const out: Finding[] = [];
  for (const rule of effectiveRules(policy, environment).filter((r) => r.requireTest)) {
    for (const p of paths) {
      if (/\.(test|spec)\.[jt]sx?$/.test(p) || p.includes("/__tests__/") || !inScope(p, rule.paths, rule.exclude)) continue;
      const expected = rule.requireTest!.test.replace(/\{dir\}/g, posix.dirname(p)).replace(/\{name\}/g, posix.basename(p).replace(/\.[^.]+$/, ""));
      const testPath = paths.find((t) => matchGlob(t, expected));
      if (!testPath) continue;
      const code = first.get(p)!;
      const tst = first.get(testPath)!;
      if (code >= tst) continue;
      const question = `Was the test for ${posix.basename(p)} written after the code? It came in ${commits[tst].sha.slice(0, 7)}, the code in ${commits[code].sha.slice(0, 7)}. Next time, which example could you write as a failing test first?`;
      out.push({
        ...base(rule, p, 1, question, "testing", "info"),
        message: question,
        mode: "audit",
        blocking: false,
        coach: { ...(rule.coach ?? {}), question: rule.coach?.question ?? "Which example would you write as a failing test before the code?" },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- changed code only (IDE)
/**
 * Lines (1-based) of `current` that are not in `head` (the committed version), matched as a multiset so moved
 * lines don't count. `head` undefined (new or uncommitted file) → null: every line is new.
 */
export function changedLineSet(head: string | undefined, current: string): Set<number> | null {
  if (head === undefined) return null;
  const before = new Map<string, number>();
  for (const l of head.split(/\r?\n/)) before.set(l, (before.get(l) ?? 0) + 1);
  const out = new Set<number>();
  current.split(/\r?\n/).forEach((l, i) => {
    const n = before.get(l) ?? 0;
    if (n > 0) before.set(l, n - 1);
    else out.add(i + 1);
  });
  return out;
}

/** Keeps findings on changed lines; file-level rules (tests with the change, change size) only when the file changed. */
export function onChangedLines(findings: Finding[], policy: Policy, file: string, changed: Set<number> | null): Finding[] {
  if (!changed) return findings.filter((f) => f.file === file);
  const fileLevel = new Set(policy.rules.filter((r) => r.requireTest || r.changeSize).map((r) => r.id));
  return findings.filter((f) => f.file === file && (changed.has(f.line) || (fileLevel.has(f.ruleId) && changed.size > 0)));
}
