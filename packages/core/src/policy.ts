import * as fs from "node:fs";
import * as path from "node:path";
import { parseYaml } from "./yaml";
import type { Mode, Policy, RedactPattern, Rule } from "./types";

export const POLICY_FILE = ".copalrules";

/** Built-in rule packs, referenced with `extends: [builtin:security]`. */
export const BUILTIN_PACKS: Record<string, Policy> = {
  security: {
    version: 3,
    rules: [
      {
        id: "hardcoded-credentials",
        category: "security",
        mode: "enforce",
        severity: "error",
        secrets: true,
        why: "Credentials in source end up in git history, prompts and logs. Load them from the secret manager.",
      },
      {
        id: "sql-injection",
        category: "security",
        mode: "enforce",
        severity: "error",
        pattern: "\\.(query|execute|raw)\\(\\s*(`[^`]*\\$\\{|[\"'][^\"']*[\"']\\s*\\+)",
        message: "SQL built by string concatenation/interpolation",
        why: "Use parameterised queries so user input can never change the statement.",
      },
      {
        id: "path-traversal",
        category: "security",
        mode: "audit",
        severity: "warning",
        pattern: "(readFile|readFileSync|createReadStream|sendFile)\\([^)]*req\\.(params|query|body)",
        message: "File path built from request input",
        why: "Resolve against an allow-listed base directory and reject '..' segments.",
      },
    ],
  },
  quality: {
    version: 3,
    rules: [
      {
        id: "no-console",
        category: "quality",
        mode: "audit",
        severity: "info",
        pattern: "\\bconsole\\.(log|debug)\\(",
        paths: ["**/*.{ts,tsx,js,jsx}"],
        exclude: ["**/*.test.*", "**/scripts/**"],
        message: "console.log left in production code",
        why: "Use the structured logger so output is levelled and redacted.",
      },
      {
        id: "no-explicit-any",
        category: "quality",
        mode: "audit",
        severity: "warning",
        pattern: ":\\s*any\\b",
        paths: ["**/*.{ts,tsx}"],
        message: "Explicit `any` disables type checking",
        why: "Prefer a precise type or `unknown` with narrowing.",
      },
    ],
  },
};

export const BUILTIN_REDACT: RedactPattern[] = [
  { name: "aws-access-key", pattern: "AKIA[0-9A-Z]{16}" },
  { name: "github-token", pattern: "gh[pousr]_[A-Za-z0-9]{36,}" },
  { name: "slack-token", pattern: "xox[baprs]-[A-Za-z0-9-]{10,}" },
  { name: "stripe-live-key", pattern: "sk_live_[0-9a-zA-Z]{16,}" },
  { name: "private-key", pattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----" },
  {
    name: "generic-secret-assignment",
    pattern: "(?:api[_-]?key|secret|password|passwd|token)[\"']?\\s*[:=]\\s*[\"']([^\"'\\s]{8,})[\"']",
    flags: "i",
  },
];

export interface ValidationIssue {
  ruleId?: string;
  message: string;
}

const KINDS = ["deny", "pattern", "secrets", "dependencies", "requireTest"] as const;

export function validatePolicy(p: Policy): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (p.version !== 3) issues.push({ message: `unsupported version ${p.version} (expected 3)` });
  const seen = new Set<string>();
  for (const r of p.rules ?? []) {
    if (!r.id) issues.push({ message: "rule without id" });
    if (seen.has(r.id)) issues.push({ ruleId: r.id, message: "duplicate rule id" });
    seen.add(r.id);
    const kinds = KINDS.filter((k) => r[k] !== undefined && r[k] !== false);
    if (kinds.length !== 1) issues.push({ ruleId: r.id, message: `expected exactly one of ${KINDS.join(", ")}; got ${kinds.join(", ") || "none"}` });
    if (r.mode && !["audit", "enforce", "off"].includes(r.mode)) issues.push({ ruleId: r.id, message: `invalid mode "${r.mode}"` });
    if (r.deny && !/\s->\s/.test(r.deny)) issues.push({ ruleId: r.id, message: 'deny must look like "from/** -> to/**"' });
    if (r.pattern) {
      try {
        new RegExp(r.pattern, r.flags);
      } catch (e) {
        issues.push({ ruleId: r.id, message: `invalid pattern: ${(e as Error).message}` });
      }
    }
  }
  return issues;
}

function normalize(raw: unknown, origin: string): Policy {
  if (!raw || typeof raw !== "object") throw new Error(`${origin}: policy must be a mapping`);
  const o = raw as Record<string, unknown>;
  const ext = o.extends;
  return {
    version: Number(o.version ?? 3),
    project: o.project as string | undefined,
    extends: ext === undefined || ext === null ? [] : Array.isArray(ext) ? (ext as string[]) : [String(ext)],
    rules: ((o.rules as Rule[]) ?? []).map((r) => ({ ...r, paths: toArr(r.paths), exclude: toArr(r.exclude), sources: toArr(r.sources) })),
    redact: (o.redact as RedactPattern[]) ?? [],
    environments: (o.environments as Policy["environments"]) ?? {},
  };
}

function toArr(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** Parse policy text (YAML or JSON) without resolving `extends`. */
export function parsePolicy(text: string, origin = POLICY_FILE): Policy {
  const trimmed = text.trim();
  const raw = trimmed.startsWith("{") ? JSON.parse(trimmed) : parseYaml(text);
  return normalize(raw, origin);
}

/** Merge parent → child: child rules replace parent rules with the same id. */
export function mergePolicies(parent: Policy, child: Policy): Policy {
  const byId = new Map<string, Rule>();
  for (const r of parent.rules) byId.set(r.id, r);
  for (const r of child.rules) byId.set(r.id, byId.has(r.id) ? { ...byId.get(r.id)!, ...stripUndef(r) } : r);
  const envs: Policy["environments"] = { ...parent.environments };
  for (const [name, env] of Object.entries(child.environments ?? {})) {
    envs[name] = { rules: { ...(envs[name]?.rules ?? {}), ...(env?.rules ?? {}) } };
  }
  return {
    version: child.version,
    project: child.project ?? parent.project,
    rules: [...byId.values()],
    redact: [...(parent.redact ?? []), ...(child.redact ?? [])],
    environments: envs,
  };
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Resolve `extends` recursively. Paths are relative to `baseDir`. */
export function resolvePolicy(p: Policy, baseDir: string, loader = readPolicyFile, depth = 0): Policy {
  if (depth > 8) throw new Error("policy extends chain too deep");
  let acc: Policy = { version: 3, rules: [], redact: [], environments: {} };
  for (const ref of p.extends ?? []) {
    let parent: Policy;
    if (ref.startsWith("builtin:")) {
      const pack = BUILTIN_PACKS[ref.slice(8)];
      if (!pack) throw new Error(`unknown built-in pack "${ref}"`);
      parent = pack;
    } else {
      const file = path.resolve(baseDir, ref);
      parent = resolvePolicy(loader(file), path.dirname(file), loader, depth + 1);
    }
    acc = mergePolicies(acc, parent);
  }
  return mergePolicies(acc, { ...p, extends: [] });
}

export function readPolicyFile(file: string): Policy {
  return parsePolicy(fs.readFileSync(file, "utf8"), file);
}

/** Find `.copalrules` walking up from `start`. */
export function findPolicyFile(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    const f = path.join(dir, POLICY_FILE);
    if (fs.existsSync(f)) return f;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function loadPolicy(fileOrDir: string): { policy: Policy; file: string; root: string } {
  const file = fs.existsSync(fileOrDir) && fs.statSync(fileOrDir).isDirectory() ? findPolicyFile(fileOrDir) : fileOrDir;
  if (!file || !fs.existsSync(file)) throw new Error(`no ${POLICY_FILE} found from ${fileOrDir}`);
  const root = path.dirname(file);
  return { policy: resolvePolicy(readPolicyFile(file), root), file, root };
}

/** Rules effective in an environment, with overrides applied and `off` rules removed. */
export function effectiveRules(p: Policy, environment = "local"): Rule[] {
  const ov = p.environments?.[environment]?.rules ?? {};
  return p.rules
    .map((r) => ({ ...r, ...(ov[r.id] ?? {}), mode: ((ov[r.id]?.mode ?? r.mode) || "audit") as Mode }))
    .filter((r) => r.mode !== "off");
}
