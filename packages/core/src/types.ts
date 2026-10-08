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
  example?: { bad?: string; good?: string };
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

  // ---- check kinds ----
  /** Import boundary: "src/web/** -> src/persistence/**" forbids imports from left to right. */
  deny?: string;
  /** Regex matched against added lines. */
  pattern?: string;
  flags?: string;
  /**
   * Level 4 ("Show me"). For `pattern` rules: `{ replace?, with }` computes a concrete replacement ($1 back-references).
   * For any rule (v4): a string describing the fix in words.
   */
  fix?: { replace?: string; with: string } | string;
  /** Coaching content (v4). */
  coach?: Coach;
  /** Built-in hard-coded credential detectors (+ policy `redact` patterns). */
  secrets?: boolean;
  /** Dependency policy applied to package.json changes. */
  dependencies?: { allow?: string[]; deny?: string[] };
  /** Changes to `paths` must come with a changed test file matching this template ({name}, {dir}). */
  requireTest?: { test: string };
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
  summary: { total: number; blocking: number; audit: number; byCategory: Record<string, number> };
  filesChecked: number;
  rulesEvaluated: number;
}
