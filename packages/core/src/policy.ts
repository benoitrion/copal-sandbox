import { parseYaml } from "./yaml";
import { containsCode } from "./coach";
import type { Mode, Policy, PolicyMode, RedactPattern, Rule } from "./types";

export const POLICY_FILE = ".copalrules";
export const SUPPORTED_VERSIONS = [3, 4];

const SAMMAN = "https://sammancoaching.org/kata_descriptions";

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
        fix: "Remove the literal, read it from configuration (e.g. config.require('PAYMENTS_KEY') backed by the secret manager), and rotate the exposed credential.",
        coach: {
          question: "Where should this value live so it never reaches git, a prompt or a log?",
          example: { bad: 'const key = "AKIA…"', good: "const key = config.require('PAYMENTS_KEY')" },
        },
      },
      {
        id: "sql-injection",
        category: "security",
        mode: "enforce",
        severity: "error",
        pattern: "\\.(query|execute|raw)\\(\\s*(`[^`]*\\$\\{|[\"'][^\"']*[\"']\\s*\\+)",
        message: "SQL built by string concatenation/interpolation",
        why: "Use parameterised queries so user input can never change the statement.",
        coach: {
          question: "What happens to this statement if the input contains a quote?",
          example: { bad: "db.query(`SELECT * FROM t WHERE id = ${id}`)", good: "db.query('SELECT * FROM t WHERE id = $1', [id])" },
        },
      },
      {
        id: "path-traversal",
        category: "security",
        mode: "audit",
        severity: "warning",
        pattern: "(readFile|readFileSync|createReadStream|sendFile)\\([^)]*req\\.(params|query|body)",
        message: "File path built from request input",
        why: "Resolve against an allow-listed base directory and reject '..' segments.",
        coach: { question: "Which files should a caller be able to reach through this endpoint — and which must they never reach?" },
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
        coach: { question: "Who will read this output in production, and how will they filter or redact it?" },
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
        coach: {
          question: "What do you actually know about this value's shape here?",
          example: { bad: "function parse(x: any)", good: "function parse(x: unknown) { if (typeof x === 'string') … }" },
        },
      },
    ],
  },
  testing: {
    version: 4,
    rules: [
      {
        id: "focused-test",
        category: "testing",
        mode: "enforce",
        severity: "error",
        pattern: "\\b(it|test|describe)\\.only\\(|\\bf(it|describe)\\(",
        paths: ["**/*.{test,spec}.{ts,tsx,js,jsx}"],
        message: "Focused test (.only) silently disables the rest of the suite",
        why: "A focused test makes CI green while skipping everything else.",
        coach: { question: "Which other tests stop running while this one is focused?" },
      },
      {
        id: "skipped-test",
        category: "testing",
        mode: "audit",
        severity: "warning",
        pattern: "\\b(it|test|describe)\\.skip\\(|\\bx(it|describe)\\(",
        paths: ["**/*.{test,spec}.{ts,tsx,js,jsx}"],
        message: "Skipped test",
        why: "Skipped tests rot. Fix it, delete it, or track it with a ticket.",
        coach: {
          question: "What would have to be true for this test to run again — and who will make it true?",
          kata: `${SAMMAN}/string_calculator.html`,
          learningHour: "test-first-small-steps",
        },
      },
    ],
  },
  hexagonal: {
    version: 4,
    rules: [
      {
        id: "domain-no-infra",
        category: "architecture",
        mode: "audit",
        severity: "warning",
        deny: "**/domain/** -> **/infra/**, **/infrastructure/**, **/adapters/**",
        why: "The domain must not depend on technical details; adapters depend on the domain through ports.",
        coach: {
          question: "Who should own this dependency — the domain, or an adapter behind a port?",
          example: { bad: "import { http } from '../infra/http'", good: "constructor(private readonly payments: PaymentPort) {}" },
          kata: `${SAMMAN}/birthday_greetings.html`,
          learningHour: "ports-and-adapters",
        },
        fix: "Declare a port (interface) in the domain, implement it in an adapter, and inject it.",
      },
      {
        id: "domain-no-framework",
        category: "architecture",
        mode: "audit",
        severity: "warning",
        pattern: "from\\s+[\"'](express|fastify|@nestjs/[\\w-]+|pg|mysql2|mongoose|axios|typeorm|prisma)[\"']",
        paths: ["**/domain/**"],
        message: "Framework or driver imported into the domain",
        why: "Framework code in the domain makes business rules hard to test and to move.",
        coach: {
          question: "Could you test this business rule without starting a server or a database?",
          kata: `${SAMMAN}/tire_pressure.html`,
          learningHour: "ports-and-adapters",
        },
      },
    ],
  },
  smells: {
    version: 4,
    rules: [
      {
        id: "long-function",
        category: "quality",
        mode: "audit",
        severity: "info",
        smell: { kind: "long-function", max: 40 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        exclude: ["**/*.test.*", "**/*.spec.*", "**/test/**"],
        why: "Long functions hide several responsibilities; each extra one is a reason to change and a place for bugs.",
        coach: {
          question: "How would you name the steps this code goes through — could each step stand on its own?",
          reference: "https://refactoring.guru/smells/long-method",
          kata: `${SAMMAN}/gilded_rose.html`,
          learningHour: "extract-function",
        },
        fix: "Extract the steps into well-named functions; keep this one as the readable summary.",
      },
      {
        id: "deep-nesting",
        category: "quality",
        mode: "audit",
        severity: "info",
        smell: { kind: "deep-nesting", max: 3 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        why: "Every nested level is a condition the reader must hold in their head.",
        coach: {
          question: "Which condition could exit first, so the main path reads straight down?",
          reference: "https://refactoring.guru/replace-nested-conditional-with-guard-clauses",
          kata: `${SAMMAN}/gilded_rose.html`,
          learningHour: "guard-clauses",
        },
        fix: "Invert the outer conditions into guard clauses, or extract the inner block into a function.",
      },
      {
        id: "too-many-params",
        category: "quality",
        mode: "audit",
        severity: "info",
        smell: { kind: "too-many-params", max: 4 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        why: "Many parameters usually mean a missing concept, and make call sites easy to get wrong.",
        coach: {
          question: "Which of these parameters always travel together — what would you call that thing?",
          reference: "https://refactoring.guru/smells/long-parameter-list",
          kata: `${SAMMAN}/theatrical_players.html`,
          learningHour: "naming-domain-concepts",
        },
        fix: "Introduce a parameter object (or value object) for the values that travel together.",
      },
      {
        id: "large-file",
        category: "quality",
        mode: "audit",
        severity: "info",
        smell: { kind: "large-file", max: 400 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        exclude: ["**/*.test.*", "**/*.spec.*", "**/generated/**"],
        why: "Large files tend to collect unrelated responsibilities and attract merge conflicts.",
        coach: { question: "If you had to split this file in two, where would the seam be?", reference: "https://refactoring.guru/smells/large-class" },
      },
      {
        id: "duplicated-literal",
        category: "quality",
        mode: "audit",
        severity: "info",
        smell: { kind: "duplicated-literal", max: 3 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        exclude: ["**/*.test.*", "**/*.spec.*"],
        why: "The same text in several places drifts apart the day one copy changes.",
        coach: { question: "What does this value mean in the domain, and where should it live once?", reference: "https://refactoring.guru/replace-magic-number-with-symbolic-constant" },
      },
    ],
  },
  "clean-code": {
    version: 4,
    rules: [
      {
        id: "magic-number-money",
        category: "quality",
        mode: "audit",
        severity: "info",
        pattern: "\\*\\s*0?\\.\\d{2,}\\b",
        paths: ["**/*.{ts,tsx,js,jsx}"],
        exclude: ["**/*.test.*", "**/*.spec.*"],
        message: "Unnamed rate or ratio in arithmetic",
        why: "A named constant or domain concept says what the number means and where it may change.",
        coach: {
          question: "What is this number called in the business, and where else does it appear?",
          kata: `${SAMMAN}/supermarket_receipt.html`,
          learningHour: "naming-domain-concepts",
        },
      },
      {
        id: "todo-without-ticket",
        category: "quality",
        mode: "audit",
        severity: "info",
        pattern: "\\b(TODO|FIXME)\\b(?!.*[A-Z]+-\\d+)",
        message: "TODO without a ticket reference",
        why: "Untracked TODOs become permanent.",
        coach: { question: "Is this a decision for now, or a task someone needs to pick up — and where is it tracked?" },
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

const KINDS = ["deny", "pattern", "secrets", "dependencies", "requireTest", "smell"] as const;
const SMELL_KINDS = ["long-function", "deep-nesting", "too-many-params", "large-file", "duplicated-literal"];

export function validatePolicy(p: Policy): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!SUPPORTED_VERSIONS.includes(p.version)) issues.push({ message: `unsupported version ${p.version} (expected ${SUPPORTED_VERSIONS.join(" or ")})` });
  if (p.mode && !["coach", "audit", "enforce"].includes(p.mode)) issues.push({ message: `invalid policy mode "${p.mode}" (coach | audit | enforce)` });
  if (p.navigator) {
    const n = p.navigator;
    if (n.maxQuestions !== undefined && !(n.maxQuestions >= 0 && n.maxQuestions <= 3)) issues.push({ message: "navigator.maxQuestions must be between 0 and 3" });
    for (const q of n.questions ?? []) if (!["first-example", "placement", "risk"].includes(q)) issues.push({ message: `unknown navigator question "${q}"` });
    if (n.minScope && !["feature", "any"].includes(n.minScope)) issues.push({ message: `navigator.minScope must be feature or any` });
  }
  const seen = new Set<string>();
  for (const r of p.rules ?? []) {
    if (!r.id) issues.push({ message: "rule without id" });
    if (seen.has(r.id)) issues.push({ ruleId: r.id, message: "duplicate rule id" });
    seen.add(r.id);
    const kinds = KINDS.filter((k) => r[k] !== undefined && r[k] !== false);
    if (kinds.length !== 1) issues.push({ ruleId: r.id, message: `expected exactly one of ${KINDS.join(", ")}; got ${kinds.join(", ") || "none"}` });
    if (r.mode && !["audit", "enforce", "off"].includes(r.mode)) issues.push({ ruleId: r.id, message: `invalid mode "${r.mode}"` });
    if (r.deny && !/\s->\s/.test(r.deny)) issues.push({ ruleId: r.id, message: 'deny must look like "from/** -> to/**"' });
    if (r.smell && !SMELL_KINDS.includes(r.smell.kind)) issues.push({ ruleId: r.id, message: `unknown smell "${r.smell.kind}" (${SMELL_KINDS.join(", ")})` });
    if (r.smell?.max !== undefined && !(Number(r.smell.max) >= 1)) issues.push({ ruleId: r.id, message: "smell.max must be ≥ 1" });
    if (r.coach?.question && containsCode(r.coach.question)) issues.push({ ruleId: r.id, message: "coach.question must not contain code — ask, don't answer" });
    if (r.coach?.escalateAfter !== undefined && !(r.coach.escalateAfter >= 1)) issues.push({ ruleId: r.id, message: "coach.escalateAfter must be ≥ 1" });
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
    mode: o.mode as PolicyMode | undefined,
    navigator: (o.navigator as Policy["navigator"]) ?? undefined,
    extends: ext === undefined || ext === null ? [] : Array.isArray(ext) ? (ext as string[]) : [String(ext)],
    rules: ((o.rules as Rule[]) ?? []).map((r) => normalizeRule({ ...r, paths: toArr(r.paths), exclude: toArr(r.exclude), sources: toArr(r.sources) })),
    redact: (o.redact as RedactPattern[]) ?? [],
    environments: (o.environments as Policy["environments"]) ?? {},
  };
}

/** v4 `severity: block | audit` → mode + legacy severity. */
function normalizeRule(r: Rule): Rule {
  const sev = r.severity as string | undefined;
  if (sev === "block") return { ...r, mode: r.mode ?? "enforce", severity: "error" };
  if (sev === "audit") return { ...r, mode: r.mode ?? "audit", severity: "warning" };
  return r;
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
    version: Math.max(child.version, parent.version),
    project: child.project ?? parent.project,
    mode: child.mode ?? parent.mode,
    navigator: child.navigator ?? parent.navigator,
    rules: [...byId.values()],
    redact: [...(parent.redact ?? []), ...(child.redact ?? [])],
    environments: envs,
  };
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Loads a policy referenced by a non-builtin `extends` entry. Returns the parsed policy and the directory that
 * its own relative `extends` resolve against. The Node implementation is `nodePolicyLoader` (./node).
 */
export type PolicyLoader = (ref: string, baseDir: string) => { policy: Policy; baseDir: string };

/**
 * Resolve `extends` recursively. `builtin:*` packs always resolve; file references need a `loader`
 * (servers receiving policy text usually pass none and reject file extends).
 */
export function resolvePolicy(p: Policy, baseDir = ".", loader?: PolicyLoader, depth = 0): Policy {
  if (depth > 8) throw new Error("policy extends chain too deep");
  let acc: Policy = { version: 3, rules: [], redact: [], environments: {} };
  for (const ref of p.extends ?? []) {
    let parent: Policy;
    if (ref.startsWith("builtin:")) {
      const pack = BUILTIN_PACKS[ref.slice(8)];
      if (!pack) throw new Error(`unknown built-in pack "${ref}"`);
      parent = pack;
    } else {
      if (!loader) throw new Error(`cannot resolve extends "${ref}": only builtin:* packs are available here`);
      const loaded = loader(ref, baseDir);
      parent = resolvePolicy(loaded.policy, loaded.baseDir, loader, depth + 1);
    }
    acc = mergePolicies(acc, parent);
  }
  const merged = mergePolicies(acc, { ...p, extends: [] });
  return { ...merged, version: p.version };
}

/** Rules effective in an environment, with overrides applied and `off` rules removed. */
export function effectiveRules(p: Policy, environment = "local"): Rule[] {
  const ov = p.environments?.[environment]?.rules ?? {};
  const fallback: Mode = p.mode === "enforce" ? "enforce" : "audit";
  return p.rules
    .map((r) => ({ ...r, ...(ov[r.id] ?? {}), mode: ((ov[r.id]?.mode ?? r.mode) || fallback) as Mode }))
    .filter((r) => r.mode !== "off");
}
