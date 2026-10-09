import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { FileChange, Finding, findingToMarkdown, parseUnifiedDiff, Report, reportToMarkdown } from "@copal/core";

export interface ChangeSet {
  files: FileChange[];
  headSha: string;
  title: string;
  author: string;
  policyText?: string;
  /** `.copal/brief.md` at the head, when the repository has one. */
  briefText?: string;
  ref: string;
}

export type CheckState = "pending" | "success" | "failure" | "error";

export interface GitProvider {
  readonly name: "github" | "gitlab";
  readonly label: string; // "acme/billing-api#248"
  load(): Promise<ChangeSet>;
  setStatus(sha: string, state: CheckState, description: string): Promise<void>;
  postReview(sha: string, report: Report, findings: Finding[], extraMarkdown?: string): Promise<void>;
  comment(body: string): Promise<void>;
}

async function http(url: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { accept: init.accept ?? "application/json", "content-type": "application/json", ...(init.headers as object) } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} → ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  return res;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// =================================================================== GitHub
export interface GitHubConfig {
  apiUrl: string;
  token?: string;
  appId?: string;
  privateKey?: string;
}

export function githubConfigFromEnv(): GitHubConfig {
  const keyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
  return {
    apiUrl: (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, ""),
    token: process.env.GITHUB_TOKEN,
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY ?? (keyPath ? fs.readFileSync(keyPath, "utf8") : undefined),
  };
}

/** GitHub App auth: RS256 JWT → installation access token (cached ~50 min). */
const tokenCache = new Map<number, { token: string; exp: number }>();
export async function githubToken(cfg: GitHubConfig, installationId?: number): Promise<string> {
  if (cfg.appId && cfg.privateKey && installationId) {
    const hit = tokenCache.get(installationId);
    if (hit && hit.exp > Date.now()) return hit.token;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: cfg.appId })}`;
    const jwt = `${unsigned}.${crypto.sign("RSA-SHA256", Buffer.from(unsigned), cfg.privateKey).toString("base64url")}`;
    const res = await http(`${cfg.apiUrl}/app/installations/${installationId}/access_tokens`, { method: "POST", headers: { authorization: `Bearer ${jwt}` } });
    const { token } = (await res.json()) as { token: string };
    tokenCache.set(installationId, { token, exp: Date.now() + 50 * 60_000 });
    return token;
  }
  if (cfg.token) return cfg.token;
  throw new Error("GitHub auth missing: set GITHUB_TOKEN or GITHUB_APP_ID + GITHUB_PRIVATE_KEY(_PATH)");
}

export class GitHubProvider implements GitProvider {
  readonly name = "github" as const;
  constructor(private cfg: GitHubConfig, private repo: string, private number: number, private installationId?: number) {}
  get label() {
    return `${this.repo}#${this.number}`;
  }
  private async h() {
    const t = await githubToken(this.cfg, this.installationId);
    return { authorization: `Bearer ${t}`, "x-github-api-version": "2022-11-28" };
  }
  private api(p: string) {
    return `${this.cfg.apiUrl}/repos/${this.repo}${p}`;
  }
  /** Web URL of the repo at a commit (github.com, GitHub Enterprise, or GITHUB_SERVER_URL in Actions). */
  private blobBase(sha: string): string | undefined {
    const web = process.env.GITHUB_SERVER_URL ?? (this.cfg.apiUrl === "https://api.github.com" ? "https://github.com" : this.cfg.apiUrl.endsWith("/api/v3") ? this.cfg.apiUrl.slice(0, -7) : undefined);
    return web ? `${web}/${this.repo}/blob/${sha}/` : undefined;
  }

  async load(): Promise<ChangeSet> {
    const headers = await this.h();
    const pr = (await (await http(this.api(`/pulls/${this.number}`), { headers })).json()) as any;
    const diff = await (await http(this.api(`/pulls/${this.number}`), { headers, accept: "application/vnd.github.diff" })).text();
    const sha = pr.head.sha as string;
    const read = async (p: string) => {
      try {
        const r = (await (await http(this.api(`/contents/${encodeURI(p)}?ref=${sha}`), { headers })).json()) as any;
        return Buffer.from(r.content, "base64").toString("utf8");
      } catch {
        return undefined;
      }
    };
    const files = await mapLimit(parseUnifiedDiff(diff), 6, async (f) => ({ ...f, content: f.status === "deleted" ? undefined : await read(f.path) }));
    return { files, headSha: sha, title: pr.title, author: pr.user?.login ?? "unknown", policyText: await read(".copalrules"), briefText: await read(".copal/brief.md"), ref: `${this.repo}#${this.number}` };
  }

  async setStatus(sha: string, state: CheckState, description: string) {
    await http(this.api(`/statuses/${sha}`), {
      method: "POST",
      headers: await this.h(),
      body: JSON.stringify({ state, context: process.env.COPAL_STATUS_CONTEXT ?? "copal/check", description: description.slice(0, 140), target_url: process.env.COPAL_CONSOLE_URL }),
    });
  }

  async postReview(sha: string, report: Report, findings: Finding[], extraMarkdown?: string) {
    await http(this.api(`/pulls/${this.number}/reviews`), {
      method: "POST",
      headers: await this.h(),
      body: JSON.stringify({
        commit_id: sha,
        event: report.blocking ? "REQUEST_CHANGES" : "COMMENT",
        body: reportToMarkdown(report) + (extraMarkdown ? `\n\n${extraMarkdown}` : ""),
        comments: findings.map((f) => ({ path: f.file, line: f.line, side: "RIGHT", body: findingToMarkdown(f, { referenceBase: this.blobBase(sha) }) })),
      }),
    });
  }

  async readFile(p: string, ref = "HEAD"): Promise<string | undefined> {
    try {
      const pr = ref === "HEAD" ? ((await (await http(this.api(`/pulls/${this.number}`), { headers: await this.h() })).json()) as any) : undefined;
      const sha = pr?.head?.sha ?? ref;
      const r = (await (await http(this.api(`/contents/${encodeURI(p)}?ref=${sha}`), { headers: await this.h() })).json()) as any;
      return Buffer.from(r.content, "base64").toString("utf8");
    } catch {
      return undefined;
    }
  }

  async reviewComment(id: number): Promise<{ body: string; path?: string; html_url?: string; user?: { login: string; type: string } }> {
    return (await (await http(this.api(`/pulls/comments/${id}`), { headers: await this.h() })).json()) as any;
  }

  /** Reply inside a review thread (falls back to a PR comment when the thread can't be replied to). */
  async replyInThread(commentId: number, body: string) {
    await http(this.api(`/pulls/${this.number}/comments/${commentId}/replies`), { method: "POST", headers: await this.h(), body: JSON.stringify({ body }) });
  }

  async comment(body: string) {
    await http(this.api(`/issues/${this.number}/comments`), { method: "POST", headers: await this.h(), body: JSON.stringify({ body }) });
  }
}

// =================================================================== GitLab
export interface GitLabConfig {
  apiUrl: string;
  token?: string;
}

export function gitlabConfigFromEnv(): GitLabConfig {
  return { apiUrl: (process.env.GITLAB_API_URL ?? "https://gitlab.com/api/v4").replace(/\/$/, ""), token: process.env.GITLAB_TOKEN };
}

export class GitLabProvider implements GitProvider {
  readonly name = "gitlab" as const;
  private refs?: { base_sha: string; head_sha: string; start_sha: string };
  constructor(private cfg: GitLabConfig, private project: string, private iid: number) {}
  get label() {
    return `${this.project}!${this.iid}`;
  }
  private h() {
    if (!this.cfg.token) throw new Error("GitLab auth missing: set GITLAB_TOKEN");
    return { "private-token": this.cfg.token };
  }
  private api(p: string) {
    return `${this.cfg.apiUrl}/projects/${encodeURIComponent(this.project)}${p}`;
  }
  private blobBase(): string | undefined {
    if (!this.refs?.head_sha || /^\d+$/.test(this.project) || !this.cfg.apiUrl.endsWith("/api/v4")) return undefined;
    return `${this.cfg.apiUrl.slice(0, -7)}/${this.project}/-/blob/${this.refs.head_sha}/`;
  }

  async load(): Promise<ChangeSet> {
    const headers = this.h();
    const mr = (await (await http(this.api(`/merge_requests/${this.iid}`), { headers })).json()) as any;
    const ch = (await (await http(this.api(`/merge_requests/${this.iid}/changes`), { headers })).json()) as any;
    this.refs = ch.diff_refs ?? mr.diff_refs;
    const sha = this.refs!.head_sha;
    const read = async (p: string) => {
      try {
        return await (await http(this.api(`/repository/files/${encodeURIComponent(p)}/raw?ref=${sha}`), { headers, accept: "text/plain" })).text();
      } catch {
        return undefined;
      }
    };
    const diff = (ch.changes as any[])
      .map((c) => `diff --git a/${c.old_path} b/${c.new_path}\n${c.new_file ? "new file mode 100644\n" : ""}${c.deleted_file ? "deleted file mode 100644\n" : ""}--- ${c.new_file ? "/dev/null" : "a/" + c.old_path}\n+++ ${c.deleted_file ? "/dev/null" : "b/" + c.new_path}\n${c.diff}`)
      .join("\n");
    const files = await mapLimit(parseUnifiedDiff(diff), 6, async (f) => ({ ...f, content: f.status === "deleted" ? undefined : await read(f.path) }));
    return { files, headSha: sha, title: mr.title, author: mr.author?.username ?? "unknown", policyText: await read(".copalrules"), briefText: await read(".copal/brief.md"), ref: this.label };
  }

  async setStatus(sha: string, state: CheckState, description: string) {
    const glState = state === "pending" ? "running" : state === "error" ? "failed" : state === "failure" ? "failed" : "success";
    await http(this.api(`/statuses/${sha}`), {
      method: "POST",
      headers: this.h(),
      body: JSON.stringify({ state: glState, name: process.env.COPAL_STATUS_CONTEXT ?? "copal/check", description: description.slice(0, 140), target_url: process.env.COPAL_CONSOLE_URL }),
    });
  }

  async readFile(p: string): Promise<string | undefined> {
    try {
      const mr = (await (await http(this.api(`/merge_requests/${this.iid}`), { headers: this.h() })).json()) as any;
      return await (await http(this.api(`/repository/files/${encodeURIComponent(p)}/raw?ref=${mr.sha}`), { headers: this.h(), accept: "text/plain" })).text();
    } catch {
      return undefined;
    }
  }

  async discussionStart(discussionId: string): Promise<{ id: number; body: string; position?: { new_path?: string }; author?: { bot?: boolean } }> {
    const d = (await (await http(this.api(`/merge_requests/${this.iid}/discussions/${discussionId}`), { headers: this.h() })).json()) as any;
    return d.notes[0];
  }

  async postReview(_sha: string, report: Report, findings: Finding[], extraMarkdown?: string) {
    for (const f of findings) {
      await http(this.api(`/merge_requests/${this.iid}/discussions`), {
        method: "POST",
        headers: this.h(),
        body: JSON.stringify({
          body: findingToMarkdown(f, { referenceBase: this.blobBase() }).replace("```suggestion", "```suggestion:-0+0"),
          position: { position_type: "text", base_sha: this.refs?.base_sha, start_sha: this.refs?.start_sha, head_sha: this.refs?.head_sha, new_path: f.file, old_path: f.file, new_line: f.line },
        }),
      });
    }
    await this.comment(reportToMarkdown(report) + (extraMarkdown ? `\n\n${extraMarkdown}` : ""));
  }

  async comment(body: string) {
    await http(this.api(`/merge_requests/${this.iid}/notes`), { method: "POST", headers: this.h(), body: JSON.stringify({ body }) });
  }
}
