/*! @copal/core 0.2.0 — Copal rule engine (isomorphic build). https://github.com/benoitrion/copal-sandbox */
// ---- types
export type Mode = "audit" | "enforce" | "off";
/** Policy-wide stance (v4). `coach` (default): hints lead with a question and fixes are only shown on request. */
export type PolicyMode = "coach" | "audit" | "enforce";
/** Hint ladder: 0 signal · 1 question · 2 quick reference · 3 worked example · 4 fix ("Show me"). */
export type HintLevel = 0 | 1 | 2 | 3 | 4;
/** Coaching content attached to a rule (v4). Everything is optional; a rule without it shows levels 0 and 4 only. */
export interface Coach {
    /** Level 1 — one Socratic question that makes the developer think. Must not contain the answer. */
    question?: string;
    /** Level 2 — quick reference: a repo path (docs/rules/x.md) or URL with the why, examples and team reasoning. */
    reference?: string;
    /** Level 2/3 — short wrong-vs-right example. */
    example?: {
        bad?: string;
        good?: string;
    };
    /** Practice for recurring mistakes — URL of a canonical kata (link and credit, never copy CC-BY-SA text). */
    kata?: string;
    /** Learning-hour topic suggested to the lead/coach when the rule recurs across a team. */
    learningHour?: string;
    /** Occurrences per developer per sprint before Copal suggests the kata (default 3). */
    escalateAfter?: number;
}
/** Navigator mode (v4): a short strong-style pairing session before an AI agent builds a feature. */
export type NavigatorQuestionKind = "first-example" | "placement" | "risk";
export interface NavigatorConfig {
    enabled?: boolean;
    /** Smallest task that triggers it: "feature" skips small edits, "any" always asks. */
    minScope?: "feature" | "any";
    maxQuestions?: number;
    questions?: NavigatorQuestionKind[];
}
/** In v4 files `severity: block` / `severity: audit` are accepted and normalised to mode enforce/audit. */
export type Severity = "info" | "warning" | "error";
export type Category = "quality" | "architecture" | "security" | "dependency" | "testing";
/** One rule of a `.copalrules` file (version 3). Exactly one check kind should be set. */
export interface Rule {
    id: string;
    category?: Category;
    mode?: Mode;
    severity?: Severity;
    /** Why the rule exists. Shown to agents (MCP) and in every finding. */
    why?: string;
    message?: string;
    /** Globs the rule applies to (default: every file). */
    paths?: string[];
    exclude?: string[];
    /** Provenance shown with findings, e.g. "Jira FIN-402". */
    sources?: string[];
    /** Import boundary: "src/web/** -> src/persistence/**" forbids imports from left to right. */
    deny?: string;
    /** Regex matched against added lines. */
    pattern?: string;
    flags?: string;
    /**
     * Level 4 ("Show me"). For `pattern` rules: `{ replace?, with }` computes a concrete replacement ($1 back-references).
     * For any rule (v4): a string describing the fix in words.
     */
    fix?: {
        replace?: string;
        with: string;
    } | string;
    /** Coaching content (v4). */
    coach?: Coach;
    /** Built-in hard-coded credential detectors (+ policy `redact` patterns). */
    secrets?: boolean;
    /** Dependency policy applied to package.json changes. */
    dependencies?: {
        allow?: string[];
        deny?: string[];
    };
    /** Changes to `paths` must come with a changed test file matching this template ({name}, {dir}). */
    requireTest?: {
        test: string;
    };
}
export interface RedactPattern {
    name: string;
    pattern: string;
    flags?: string;
}
export interface EnvironmentOverride {
    rules?: Record<string, Partial<Pick<Rule, "mode" | "severity">>>;
}
export interface Policy {
    version: number;
    project?: string;
    /** v4: coach (default) | audit | enforce. */
    mode?: PolicyMode;
    /** v4: navigator mode configuration. */
    navigator?: NavigatorConfig;
    extends?: string[];
    rules: Rule[];
    redact?: RedactPattern[];
    environments?: Record<string, EnvironmentOverride>;
}
export interface AddedLine {
    line: number;
    text: string;
}
export interface FileChange {
    path: string;
    status: "added" | "modified" | "deleted" | "renamed";
    addedLines: AddedLine[];
    /** Full new content when available (better import resolution, VS Code). */
    content?: string;
}
export interface Suggestion {
    original: string;
    replacement: string;
}
export interface Finding {
    ruleId: string;
    category: Category;
    severity: Severity;
    mode: Mode;
    /** true when the rule is in enforce mode — blocks pre-commit and fails the PR check. */
    blocking: boolean;
    file: string;
    line: number;
    column?: number;
    endColumn?: number;
    message: string;
    why?: string;
    suggestion?: Suggestion;
    /** Level-4 fix described in words (v4 string `fix`). */
    fixText?: string;
    sources?: string[];
    /** Coaching content copied from the rule (v4). */
    coach?: Coach;
}
export interface Report {
    environment: string;
    /** Policy stance the report was produced under (v4). */
    policyMode?: PolicyMode;
    findings: Finding[];
    blocking: boolean;
    summary: {
        total: number;
        blocking: number;
        audit: number;
        byCategory: Record<string, number>;
    };
    filesChecked: number;
    rulesEvaluated: number;
}

// ---- yaml
/**
 * Minimal, dependency-free YAML reader for `.copalrules`.
 *
 * Supports the subset used by policy files: block maps and sequences, "- key: value"
 * list items, quoted / plain scalars, numbers, booleans, null, flow lists `[a, b]`,
 * flow maps `{a: 1}`, block scalars `|` and `>`, and `#` comments.
 * Anchors, tags and multi-document streams are not supported.
 * If the `yaml` npm package is installed, `parseYaml` delegates to it.
 */
export declare class YamlError extends Error {
    line: number;
    constructor(message: string, line: number);
}
export declare function parseYaml(source: string): unknown;
export declare function parseYamlSubset(source: string): unknown;
export declare function scalar(s: string, line?: number): unknown;
/** Serialize plain data to YAML (used by the mock server / MCP to show policies). */
export declare function toYaml(v: unknown, indent?: number): string;

// ---- glob
export declare function globToRegExp(glob: string): RegExp;
export declare function normalizePath(p: string): string;
export declare function matchGlob(path: string, glob: string | string[]): boolean;
export declare function inScope(path: string, include?: string[], exclude?: string[]): boolean;

// ---- posix
/** Minimal POSIX path helpers so the engine runs unchanged in Node, Deno (Supabase Edge) and browsers. */
export declare function normalize(p: string): string;
export declare function join(...parts: string[]): string;
export declare function dirname(p: string): string;
export declare function basename(p: string): string;

// ---- policy
export declare const POLICY_FILE = ".copalrules";
export declare const SUPPORTED_VERSIONS: number[];
/** Built-in rule packs, referenced with `extends: [builtin:security]`. */
export declare const BUILTIN_PACKS: Record<string, Policy>;
export declare const BUILTIN_REDACT: RedactPattern[];
export interface ValidationIssue {
    ruleId?: string;
    message: string;
}
export declare function validatePolicy(p: Policy): ValidationIssue[];
/** Parse policy text (YAML or JSON) without resolving `extends`. */
export declare function parsePolicy(text: string, origin?: string): Policy;
/** Merge parent → child: child rules replace parent rules with the same id. */
export declare function mergePolicies(parent: Policy, child: Policy): Policy;
/**
 * Loads a policy referenced by a non-builtin `extends` entry. Returns the parsed policy and the directory that
 * its own relative `extends` resolve against. The Node implementation is `nodePolicyLoader` (./node).
 */
export type PolicyLoader = (ref: string, baseDir: string) => {
    policy: Policy;
    baseDir: string;
};
/**
 * Resolve `extends` recursively. `builtin:*` packs always resolve; file references need a `loader`
 * (servers receiving policy text usually pass none and reject file extends).
 */
export declare function resolvePolicy(p: Policy, baseDir?: string, loader?: PolicyLoader, depth?: number): Policy;
/** Rules effective in an environment, with overrides applied and `off` rules removed. */
export declare function effectiveRules(p: Policy, environment?: string): Rule[];

// ---- diff
/** Parse a unified diff (git diff / GitHub .diff / GitLab changes) into file changes. */
export declare function parseUnifiedDiff(diff: string): FileChange[];
/** Treat a whole file as newly added (editor checks, MCP snippet checks, full-branch scans). */
export declare function fileAsChange(path: string, content: string): FileChange;

// ---- engine
export interface EvaluateOptions {
    environment?: string;
    /** Only evaluate these rule ids. */
    only?: string[];
}
export declare function evaluate(changes: FileChange[], policy: Policy, opts?: EvaluateOptions): Report;
export declare function parseDeny(deny: string): {
    from: string[];
    to: string[];
};
export declare function mask(s: string): string;
export interface RedactionResult {
    text: string;
    redactions: {
        name: string;
        count: number;
    }[];
}
/** Remove secrets / restricted context before text leaves the machine (MCP, model calls). */
export declare function redact(text: string, policy?: Policy): RedactionResult;
/** Rules that apply to a given path — what Copal MCP hands to agents before they write code. */
export declare function applicableRules(policy: Policy, filePath: string | undefined, environment?: string): Rule[];

// ---- format
export declare const red: (s: string) => string;
export declare const yellow: (s: string) => string;
export declare const green: (s: string) => string;
export declare const dim: (s: string) => string;
export declare const bold: (s: string) => string;
export declare const cyan: (s: string) => string;
export interface FormatOptions {
    /** Reveal level 4 (the fix). Default: only when the report is not in coach mode. */
    showMe?: boolean;
    /** Reveal levels 2–3 (why, reference, example). Default true. */
    explain?: boolean;
}
export declare function formatFinding(f: Finding, opts?: FormatOptions): string;
export declare function formatReport(r: Report, opts?: FormatOptions): string;
/** Markdown body for a PR/MR summary comment. */
export declare function reportToMarkdown(r: Report, title?: string): string;
/**
 * Markdown body for one inline review comment — a hint card: question first, explanation folded,
 * fix ("Show me") folded and never as a one-click suggestion when the rule has coaching.
 */
export declare function findingToMarkdown(f: Finding): string;
/** Rules rendered as agent guidance (MCP). */
export declare function rulesToGuidance(rules: Rule[], filePath?: string): string;
export {};
