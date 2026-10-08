// Exact API types of the Copal reference implementation (https://github.com/benoitrion/copal-sandbox).
export type Mode = "audit" | "enforce" | "off";
export type Severity = "info" | "warning" | "error";
export type Category = "quality" | "architecture" | "security" | "dependency" | "testing";
export type Source = "precommit" | "pr" | "mcp" | "ide" | "branch";

export interface Suggestion { original: string; replacement: string }

export interface Finding {
  ruleId: string; category: Category; severity: Severity; mode: Mode; blocking: boolean;
  file: string; line: number; column?: number; endColumn?: number;
  message: string; why?: string; suggestion?: Suggestion; sources?: string[];
}

export interface Report {
  environment: string; findings: Finding[]; blocking: boolean;
  summary: { total: number; blocking: number; audit: number; byCategory: Partial<Record<Category, number>> };
  filesChecked: number; rulesEvaluated: number;
}

export interface Analysis extends Report {
  id: string; project: string; source: Source; ref?: string; title?: string; author?: string; agent?: string;
  createdAt: string; feedback: { ruleId: string; verdict: "false-positive" | "accepted"; note?: string; at: string }[];
}

export interface Rule {
  id: string; category?: Category; mode?: Mode; severity?: Severity; why?: string; message?: string;
  paths?: string[]; exclude?: string[]; sources?: string[];
  deny?: string; pattern?: string; flags?: string; fix?: { replace?: string; with: string };
  secrets?: boolean; dependencies?: { allow?: string[]; deny?: string[] }; requireTest?: { test: string };
}

export interface Policy {
  version: number; project?: string; rules: Rule[];
  redact?: { name: string; pattern: string; flags?: string }[];
  environments?: Record<string, { rules?: Record<string, { mode?: Mode; severity?: Severity }> }>;
}

export interface Status { workspace: string; plan: string; projects: string[]; controls: number; serverTime: string }
export interface ProjectSummary { name: string; version: number; updatedAt: string; rules: number }
export interface PolicyResponse { project: string; version: number; yaml: string; policy: Policy; applicable?: Rule[]; resolvedYaml: string }

export interface Metrics {
  analyses: number; bySource: Partial<Record<Source, number>>;
  drift: { ruleId: string; count: number; falsePositives: number }[];
  gates: { passed: number; failed: number }; governedChanges: number; sessions: number; tokens: number;
}

export interface Suggestions { project: string; suggestions: { ruleId: string; text: string }[] }
export interface MentorResponse { guidance: string; findings: Finding[]; redactedSnippet: string; redactions: { name: string; count: number }[] }
export interface PlanResponse { story: string; steps: string[]; constraints: string[] }
export interface ApiErrorBody { error: string }
