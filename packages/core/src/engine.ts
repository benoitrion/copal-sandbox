import * as posix from "./posix";
import { inScope, matchGlob, normalizePath } from "./glob";
import { BUILTIN_REDACT, effectiveRules } from "./policy";
import type { Category, FileChange, Finding, Policy, Report, Rule, Severity } from "./types";

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
    for (const file of files) {
      if (!inScope(file.path, rule.paths, rule.exclude)) continue;
      let found: Finding[] = [];
      if (rule.deny) found = checkBoundary(rule, file);
      else if (rule.pattern) found = checkPattern(rule, file);
      else if (rule.secrets) found = checkSecrets(rule, file, policy);
      else if (rule.dependencies) found = checkDependencies(rule, file);
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
    ...(typeof rule.fix === "string" ? { fixText: rule.fix } : {}),
  };
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
    if (rule.fix && typeof rule.fix === "object") {
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
      out.push(base(rule, file.path, file.addedLines[0]?.line ?? 1, `Change has no accompanying test (expected ${expected})`, "testing", "warning"));
    }
  }
  return out;
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
