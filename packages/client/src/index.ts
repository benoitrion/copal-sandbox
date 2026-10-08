import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AgentBrief,
  buildBrief,
  evaluate,
  FileChange,
  HintLevel,
  loadPolicy,
  NavigatorAnswer,
  NavigatorQuestion,
  navigatorQuestions,
  nodePolicyLoader,
  parsePolicy,
  Policy,
  redact,
  Report,
  resolvePolicy,
} from "@copal/core";

export type Source = "precommit" | "pr" | "mcp" | "ide" | "branch";

export interface CopalConfig {
  serverUrl?: string;
  apiKey?: string;
  /** When the server is unreachable, fall back to the local engine (default true). */
  offlineFallback?: boolean;
}

export interface AnalyzeRequest {
  project?: string;
  environment?: string;
  source: Source;
  ref?: string;
  title?: string;
  author?: string;
  agent?: string;
  files: FileChange[];
  /** Raw `.copalrules` text from the repository (project-owned policy). */
  policyText?: string;
}

export interface AnalyzeResult extends Report {
  analysisId?: string;
  mode: "remote" | "local";
  project?: string;
}

/** One step on the hint ladder, recorded for the growth metric (POST /v1/coach/events). */
export interface CoachEvent {
  project?: string;
  developer?: string;
  ruleId: string;
  category?: string;
  levelReached: HintLevel;
  action: "shown" | "ask" | "explain" | "show_me" | "skipped" | "answered";
  source: "ide" | "cli" | "agent" | "pr";
  at?: string;
}

export interface ReflectResult {
  sessionId: string;
  engage: boolean;
  reason?: string;
  questions: NavigatorQuestion[];
  mode: "remote" | "local";
}

/**
 * Servers that predate v4 (or another implementation) may return findings without coaching data:
 * fill it in from the repository's own policy so every surface can render hint cards.
 */
export function enrichWithPolicy<R extends Report>(r: R, policy?: Policy): R {
  if (!policy) return r;
  const byId = new Map(policy.rules.map((x) => [x.id, x]));
  return {
    ...r,
    policyMode: r.policyMode ?? policy.mode ?? (policy.version >= 4 ? "coach" : "audit"),
    findings: r.findings.map((f) => {
      const rule = byId.get(f.ruleId);
      if (!rule) return f;
      return {
        ...f,
        coach: f.coach ?? rule.coach,
        fixText: f.fixText ?? (typeof rule.fix === "string" ? rule.fix : undefined),
      };
    }),
  };
}

const localSessions = new Map<string, { task: string; questions: NavigatorQuestion[] }>();

export const CONFIG_FILE = path.join(os.homedir(), ".copal", "config.json");

/** Config precedence: explicit > env (COPAL_SERVER, COPAL_API_KEY) > ~/.copal/config.json. */
export function loadConfig(explicit: CopalConfig = {}): CopalConfig {
  let file: CopalConfig = {};
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    /* no config yet */
  }
  return {
    offlineFallback: true,
    ...file,
    ...(process.env.COPAL_SERVER !== undefined ? { serverUrl: process.env.COPAL_SERVER } : {}),
    ...(process.env.COPAL_API_KEY ? { apiKey: process.env.COPAL_API_KEY } : {}),
    ...Object.fromEntries(Object.entries(explicit).filter(([, v]) => v !== undefined)),
  };
}

export function saveConfig(cfg: CopalConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

export class CopalApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export class CopalClient {
  readonly cfg: CopalConfig;
  constructor(cfg: CopalConfig = loadConfig()) {
    this.cfg = cfg;
  }

  get remote(): boolean {
    return !!this.cfg.serverUrl;
  }

  async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    if (!this.cfg.serverUrl) throw new CopalApiError("no Copal server configured");
    const url = this.cfg.serverUrl.replace(/\/$/, "") + route;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { "content-type": "application/json", ...(this.cfg.apiKey ? { "x-api-key": this.cfg.apiKey } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(Number(process.env.COPAL_TIMEOUT_MS ?? 8000)),
      });
    } catch (e) {
      throw new CopalApiError(`cannot reach Copal at ${url}: ${(e as Error).message}`);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new CopalApiError(data.error ?? `HTTP ${res.status}`, res.status);
    return data as T;
  }

  status() {
    return this.request<{ workspace: string; projects: string[]; controls: number; plan: string }>("GET", "/v1/status");
  }
  createKey(name: string) {
    return this.request<{ key: string }>("POST", "/v1/keys", { name });
  }
  getPolicy(project: string) {
    return this.request<{ project: string; yaml: string; policy: Policy }>("GET", `/v1/projects/${encodeURIComponent(project)}/policy`);
  }
  recordSession(s: {
    agent: string;
    project?: string;
    durationMs?: number;
    tokens?: number;
    findings?: number;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    model?: string;
    retries?: number;
    navigatorUsed?: boolean;
  }) {
    return this.request("POST", "/v1/sessions", s);
  }
  heartbeats(beats: { file: string; ts: number; editor: string }[]) {
    return this.request("POST", "/v1/heartbeats", { heartbeats: beats });
  }
  mentor(snippet: string, project?: string, file?: string) {
    return this.request<{ guidance: string; findings: Report["findings"]; redactions: { name: string; count: number }[] }>("POST", "/v1/mentor", {
      snippet,
      project,
      file,
    });
  }
  feedback(analysisId: string, ruleId: string, verdict: "false-positive" | "accepted", note?: string) {
    return this.request("POST", `/v1/analyses/${analysisId}/feedback`, { ruleId, verdict, note });
  }

  /** Navigator mode: questions to ask before an agent builds `task`. Server first, local engine as fallback. */
  async reflect(req: { project?: string; task: string; files?: string[]; developer?: string }, localPolicy?: Policy): Promise<ReflectResult> {
    if (this.remote) {
      try {
        const r = await this.request<Omit<ReflectResult, "mode">>("POST", "/v1/coach/reflect", req);
        return { ...r, engage: r.engage ?? r.questions.length > 0, mode: "remote" };
      } catch (e) {
        if (!(e instanceof CopalApiError) || (e.status && e.status !== 404 && e.status < 500)) throw e;
      }
    }
    const s = navigatorQuestions(localPolicy, req.task, { files: req.files });
    const sessionId = `local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    localSessions.set(sessionId, { task: req.task, questions: s.questions });
    return { sessionId, engage: s.engage, reason: s.reason, questions: s.questions, mode: "local" };
  }

  /** Send the developer's answers; returns the brief the agent works from. */
  async answer(sessionId: string, answers: NavigatorAnswer[], skipped = false, localPolicy?: Policy, fallback?: { task: string; questions: NavigatorQuestion[] }): Promise<AgentBrief> {
    if (this.remote && !sessionId.startsWith("local_")) {
      const r = await this.request<{ brief: AgentBrief }>("POST", `/v1/coach/reflect/${encodeURIComponent(sessionId)}/answers`, { answers, skipped });
      return r.brief;
    }
    const s = localSessions.get(sessionId) ?? fallback;
    if (!s) throw new CopalApiError(`unknown navigator session ${sessionId}`);
    return buildBrief(localPolicy, s.task, s.questions, answers, skipped);
  }

  /** Best effort: growth events never break the developer's flow. */
  async coachEvents(events: CoachEvent[]): Promise<boolean> {
    if (!this.remote || !events.length) return false;
    try {
      for (const e of events) await this.request("POST", "/v1/coach/events", { at: new Date().toISOString(), ...e });
      return true;
    } catch {
      return false;
    }
  }

  growth(project: string, developer?: string) {
    return this.request<unknown>("GET", `/v1/growth?project=${encodeURIComponent(project)}${developer ? `&developer=${encodeURIComponent(developer)}` : ""}`);
  }
  katas() {
    return this.request<unknown[]>("GET", "/v1/katas");
  }

  /**
   * Analyze changes. Uses the Copal server when configured (so the console records evidence);
   * falls back to the local engine with the repository's `.copalrules` otherwise.
   */
  async analyze(req: AnalyzeRequest, localPolicy?: Policy): Promise<AnalyzeResult> {
    if (this.remote) {
      try {
        const r = await this.request<AnalyzeResult>("POST", "/v1/analyze", req);
        return enrichWithPolicy({ ...r, mode: "remote" as const }, localPolicy);
      } catch (e) {
        if (!this.cfg.offlineFallback || (e instanceof CopalApiError && e.status && e.status < 500)) throw e;
        process.stderr.write(`copal: ${(e as Error).message} — falling back to local engine\n`);
      }
    }
    const policy = localPolicy ?? (req.policyText ? resolvePolicy(parsePolicy(req.policyText), process.cwd(), nodePolicyLoader) : undefined);
    if (!policy) throw new CopalApiError("no policy available for local analysis");
    return { ...evaluate(req.files, policy, { environment: req.environment }), mode: "local", project: req.project };
  }
}

/** Load the project policy from a repo directory, returning text (for the server) and resolved policy (for local runs). */
export function loadRepoPolicy(dir: string) {
  const { policy, file, root } = loadPolicy(dir);
  return { policy, file, root, text: fs.readFileSync(file, "utf8"), project: policy.project ?? path.basename(root) };
}

export { redact };
