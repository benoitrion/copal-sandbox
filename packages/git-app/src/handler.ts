import * as crypto from "node:crypto";
import { CopalClient } from "@copal/client";
import { parsePolicy, reportToMarkdown, resolvePolicy, scopeCheck, testOrderFindings } from "@copal/core";
import { GitHubProvider, githubConfigFromEnv, GitLabProvider, gitlabConfigFromEnv, GitProvider, ChangeSet } from "./providers";
import { COMMAND_RX, runCommand } from "./commands";

const lastAnalysis = new Map<string, string>(); // PR label -> analysisId (for /copal feedback)

export function verifyGitHubSignature(secret: string | undefined, rawBody: string, header: string | undefined): boolean {
  if (!secret) return true;
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(header);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

export function verifyGitLabToken(secret: string | undefined, header: string | undefined): boolean {
  if (!secret) return true;
  if (!header) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const log = (...a: unknown[]) => console.log(`[copal-git-app] ${new Date().toISOString()}`, ...a);

/** What the change adds beyond `.copal/brief.md`, as questions (undefined when there is no brief or nothing to ask). */
function scopeMarkdown(cs: ChangeSet): string | undefined {
  if (!cs.briefText) return undefined;
  const items = scopeCheck(cs.briefText, cs.files);
  if (!items.length) return undefined;
  return ["#### Beyond the agreed brief", "", ...items.map((i) => `- ${i.question}${i.details.length ? ` _(${i.details.join(", ")})_` : ""}`)].join("\n");
}

/** Analyze one PR/MR and publish results natively in the Git provider. */
export async function runCheck(provider: GitProvider, client = new CopalClient()) {
  const cs = await provider.load();
  await provider.setStatus(cs.headSha, "pending", "Copal is analyzing this change…");
  try {
    if (!cs.policyText) {
      await provider.setStatus(cs.headSha, "success", "No .copalrules in this repository — nothing enforced");
      return null;
    }
    const result = await client.analyze({
      project: undefined,
      environment: process.env.COPAL_ENV ?? "ci",
      source: "pr",
      ref: cs.ref,
      title: cs.title,
      author: cs.author,
      files: cs.files,
      policyText: cs.policyText,
    });
    if (provider.commits) {
      try {
        // Tests first: code committed before its test on this PR → audit question (never changes the status).
        const order = testOrderFindings(resolvePolicy(parsePolicy(cs.policyText)), await provider.commits(), process.env.COPAL_ENV ?? "ci");
        if (order.length) {
          result.findings.push(...order);
          result.summary.total += order.length;
          result.summary.audit += order.length;
          result.summary.byCategory.testing = (result.summary.byCategory.testing ?? 0) + order.length;
        }
      } catch (e) {
        log(`${provider.label}: commit order unavailable (${(e as Error).message})`);
      }
    }
    // project name comes from the policy itself when the server parses it
    if (result.analysisId) lastAnalysis.set(provider.label, result.analysisId);
    const desc = result.blocking
      ? `${result.summary.blocking} blocking finding(s) — changes requested`
      : result.findings.length
        ? `Passed with ${result.summary.audit} audit finding(s)`
        : "Passed — no findings";
    const scope = scopeMarkdown(cs);
    if (result.findings.length) {
      // GitHub/GitLab reject the whole review if an inline comment targets a line outside the diff:
      // inline only findings on added lines; every finding is still listed in the review summary.
      const inDiff = new Set(cs.files.flatMap((f) => f.addedLines.map((l) => `${f.path}:${l.line}`)));
      const inline = result.findings.filter((f) => inDiff.has(`${f.file}:${f.line}`));
      try {
        await provider.postReview(cs.headSha, result, inline, scope);
      } catch (e) {
        log(`${provider.label} review failed (${(e as Error).message}); posting a summary comment instead`);
        await provider.comment(reportToMarkdown(result) + (scope ? `\n\n${scope}` : ""));
      }
    } else if (scope) await provider.comment(scope);
    await provider.setStatus(cs.headSha, result.blocking ? "failure" : "success", desc);
    // Growth: the PR author saw these hints (best effort; same ladder level as the inline comment shows).
    if (result.findings.length && typeof client.coachEvents === "function") {
      let project: string | undefined;
      try {
        project = parsePolicy(cs.policyText).project;
      } catch {
        /* unparsable policy */
      }
      await client
        .coachEvents(result.findings.map((f) => ({ project, developer: cs.author, ruleId: f.ruleId, category: f.category, levelReached: f.coach?.question ? 1 : 0, action: "shown" as const, source: "pr" as const })))
        .catch(() => false);
    }
    log(`${provider.label} → ${desc}`);
    return result;
  } catch (e) {
    await provider.setStatus(cs.headSha, "error", `Copal error: ${(e as Error).message}`).catch(() => {});
    throw e;
  }
}

const FEEDBACK_RX = /^\/copal\s+(false-positive|fp|accept)\s+([\w-]+)\s*(.*)$/m;

async function handleFeedback(provider: GitProvider, body: string, client = new CopalClient()) {
  const m = FEEDBACK_RX.exec(body ?? "");
  if (!m) return false;
  const analysisId = lastAnalysis.get(provider.label);
  if (!analysisId) {
    await provider.comment("Copal: no analysis recorded for this PR yet.");
    return true;
  }
  await client.feedback(analysisId, m[2], m[1] === "accept" ? "accepted" : "false-positive", m[3] || undefined);
  await provider.comment(`Copal: recorded **${m[1] === "accept" ? "accepted" : "false positive"}** for \`${m[2]}\`. Rule owners will see it in the console.`);
  return true;
}

/** `/copal help|explain|rule` in a PR conversation or review thread (GitHub App webhook or Actions event). */
export async function handleGitHubCommand(p: GitHubProvider, payload: any, client = new CopalClient()): Promise<boolean> {
  const c = payload.comment ?? {};
  if (!COMMAND_RX.test(c.body ?? "")) return false;
  const parent = c.in_reply_to_id ? await p.reviewComment(c.in_reply_to_id).catch(() => undefined) : undefined;
  const reply = await runCommand(
    {
      body: c.body,
      author: c.user?.login,
      url: c.html_url,
      path: c.path,
      parent: parent ? { body: parent.body, path: parent.path, url: parent.html_url, byBot: parent.user?.type === "Bot" } : undefined,
      loadPolicy: () => p.readFile(".copalrules"),
      referenceBase: payload.repository?.html_url ? `${payload.repository.html_url}/blob/${payload.pull_request?.head?.sha ?? "HEAD"}/` : undefined,
    },
    client,
  );
  if (!reply) return false;
  if (c.in_reply_to_id || payload.pull_request) await p.replyInThread(c.in_reply_to_id ?? c.id, reply).catch(() => p.comment(reply));
  else await p.comment(reply);
  return true;
}

export interface WebhookInput {
  provider: "github" | "gitlab";
  event: string;
  payload: any;
}

/** Route a verified webhook. Returns a short description of what was done. */
export async function handleWebhook({ provider, event, payload }: WebhookInput, client = new CopalClient()): Promise<string> {
  if (provider === "github") {
    const repo = payload.repository?.full_name;
    const installation = payload.installation?.id;
    if (event === "ping") return "pong";
    if (event === "pull_request" && ["opened", "synchronize", "reopened", "ready_for_review"].includes(payload.action)) {
      if (payload.pull_request?.draft && process.env.COPAL_SKIP_DRAFTS === "1") return "draft skipped";
      await runCheck(new GitHubProvider(githubConfigFromEnv(), repo, payload.pull_request.number, installation), client);
      return `checked ${repo}#${payload.pull_request.number}`;
    }
    if ((event === "issue_comment" && payload.action === "created" && payload.issue?.pull_request) || (event === "pull_request_review_comment" && payload.action === "created")) {
      const number = payload.issue?.number ?? payload.pull_request?.number;
      const p = new GitHubProvider(githubConfigFromEnv(), repo, number, installation);
      if (await handleFeedback(p, payload.comment?.body, client)) return "feedback recorded";
      return (await handleGitHubCommand(p, payload, client)) ? "command answered" : "ignored comment";
    }
    return `ignored ${event}/${payload.action ?? ""}`;
  }
  // GitLab
  const project = payload.project?.path_with_namespace ?? String(payload.project?.id);
  if (event === "Merge Request Hook") {
    const a = payload.object_attributes;
    const relevant = a.action === "open" || a.action === "reopen" || (a.action === "update" && a.oldrev);
    if (!relevant) return `ignored MR action ${a.action}`;
    await runCheck(new GitLabProvider(gitlabConfigFromEnv(), project, a.iid), client);
    return `checked ${project}!${a.iid}`;
  }
  if (event === "Note Hook" && payload.merge_request) {
    const p = new GitLabProvider(gitlabConfigFromEnv(), project, payload.merge_request.iid);
    if (await handleFeedback(p, payload.object_attributes?.note, client)) return "feedback recorded";
    const note = payload.object_attributes ?? {};
    if (!COMMAND_RX.test(note.note ?? "")) return "ignored note";
    const parent = note.discussion_id ? await p.discussionStart(note.discussion_id).catch(() => undefined) : undefined;
    const reply = await runCommand(
      {
        body: note.note,
        author: payload.user?.username,
        url: note.url,
        path: note.position?.new_path,
        parent: parent && parent.id !== note.id ? { body: parent.body, path: parent.position?.new_path, url: note.url, byBot: !!parent.author?.bot } : undefined,
        loadPolicy: () => p.readFile(".copalrules"),
      },
      client,
    );
    if (reply) await p.comment(reply);
    return reply ? "command answered" : "ignored note";
  }
  return `ignored ${event}`;
}
