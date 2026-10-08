export type Mode = "audit" | "enforce" | "off";
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
  /** Concrete correction for `pattern` rules. `with` may use $1 back-references. */
  fix?: { replace?: string; with: string };
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
  sources?: string[];
}

export interface Report {
  environment: string;
  findings: Finding[];
  blocking: boolean;
  summary: { total: number; blocking: number; audit: number; byCategory: Record<string, number> };
  filesChecked: number;
  rulesEvaluated: number;
}
