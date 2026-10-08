import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Finding, Policy, Report } from "@copal/core";

export interface Project {
  name: string;
  yaml: string;
  policy: Policy;
  updatedAt: string;
  version: number;
}

export interface Analysis extends Report {
  id: string;
  project: string;
  source: "precommit" | "pr" | "mcp" | "ide" | "branch";
  ref?: string;
  title?: string;
  author?: string;
  agent?: string;
  createdAt: string;
  feedback: { ruleId: string; verdict: string; note?: string; at: string }[];
}

export interface FakePull {
  provider: "github" | "gitlab";
  repo: string; // "owner/repo" or GitLab project id
  number: number;
  title: string;
  author: string;
  headSha: string;
  baseSha: string;
  diff: string;
  files: Record<string, string>; // path -> new content
  reviews: { at: string; event?: string; body: string; comments: { path: string; line: number; body: string }[] }[];
  comments: { at: string; body: string }[];
  statuses: { at: string; sha: string; state: string; context: string; description?: string }[];
}

export interface State {
  workspace: string;
  keys: { key: string; name: string; createdAt: string }[];
  projects: Record<string, Project>;
  analyses: Analysis[];
  sessions: { at: string; agent: string; project?: string; durationMs?: number; tokens?: number; findings?: number }[];
  heartbeats: number;
  pulls: FakePull[];
}

export const DEV_KEY = "copal_dev_local";

export class Store {
  state: State = {
    workspace: "copal-sandbox",
    keys: [{ key: DEV_KEY, name: "seed dev key", createdAt: new Date().toISOString() }],
    projects: {},
    analyses: [],
    sessions: [],
    heartbeats: 0,
    pulls: [],
  };

  constructor(private file?: string) {
    if (file && fs.existsSync(file)) {
      this.state = { ...this.state, ...JSON.parse(fs.readFileSync(file, "utf8")) };
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  newKey(name: string) {
    const key = "copal_" + crypto.randomBytes(18).toString("base64url");
    this.state.keys.push({ key, name, createdAt: new Date().toISOString() });
    this.save();
    return key;
  }

  validKey(key: string | undefined) {
    return !!key && this.state.keys.some((k) => k.key === key);
  }

  addAnalysis(a: Omit<Analysis, "id" | "createdAt" | "feedback">): Analysis {
    const full: Analysis = { ...a, id: "an_" + crypto.randomBytes(5).toString("hex"), createdAt: new Date().toISOString(), feedback: [] };
    this.state.analyses.unshift(full);
    this.state.analyses = this.state.analyses.slice(0, 500);
    this.save();
    return full;
  }

  /** Aggregates for the console "engineering evidence" panel. */
  metrics(project?: string) {
    const list = this.state.analyses.filter((a) => !project || a.project === project);
    const byRule: Record<string, number> = {};
    const fp: Record<string, number> = {};
    let gatesPassed = 0;
    let gatesFailed = 0;
    for (const a of list) {
      a.findings.forEach((f: Finding) => (byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1));
      a.feedback.filter((x) => x.verdict === "false-positive").forEach((x) => (fp[x.ruleId] = (fp[x.ruleId] ?? 0) + 1));
      if (a.source === "pr") a.blocking ? gatesFailed++ : gatesPassed++;
    }
    const bySource: Record<string, number> = {};
    list.forEach((a) => (bySource[a.source] = (bySource[a.source] ?? 0) + 1));
    return {
      analyses: list.length,
      bySource,
      drift: Object.entries(byRule)
        .sort((a, b) => b[1] - a[1])
        .map(([ruleId, count]) => ({ ruleId, count, falsePositives: fp[ruleId] ?? 0 })),
      gates: { passed: gatesPassed, failed: gatesFailed },
      governedChanges: new Set(list.filter((a) => a.source === "pr").map((a) => a.ref)).size,
      sessions: this.state.sessions.length,
      tokens: this.state.sessions.reduce((s, x) => s + (x.tokens ?? 0), 0),
    };
  }
}
