import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { evaluate, FileChange, loadPolicy, nodePolicyLoader, parsePolicy, Policy, redact, Report, resolvePolicy } from "@copal/core";

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
  recordSession(s: { agent: string; project?: string; durationMs?: number; tokens?: number; findings?: number }) {
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

  /**
   * Analyze changes. Uses the Copal server when configured (so the console records evidence);
   * falls back to the local engine with the repository's `.copalrules` otherwise.
   */
  async analyze(req: AnalyzeRequest, localPolicy?: Policy): Promise<AnalyzeResult> {
    if (this.remote) {
      try {
        const r = await this.request<AnalyzeResult>("POST", "/v1/analyze", req);
        return { ...r, mode: "remote" };
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
