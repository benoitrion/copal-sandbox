import { HttpError, Router } from "./http";

/**
 * Hosts the Git provider app inside the mock (one process, one public port — Codespaces, Render, Docker).
 *   POST /webhooks/github   POST /webhooks/gitlab
 * By default the app talks to this server's own fake GitHub/GitLab APIs. Set COPAL_GIT_TARGET=real (with
 * GITHUB_TOKEN or GITHUB_APP_ID + GITHUB_PRIVATE_KEY, and/or GITLAB_TOKEN) to post on real pull requests.
 * Explicit opt-in on purpose: Codespaces and CI runners inject a GITHUB_TOKEN of their own.
 */
export function mountWebhooks(router: Router, port: number, devKey: string): string {
  let gitApp: typeof import("@copal/git-app");
  try {
    gitApp = require("@copal/git-app");
  } catch {
    return "disabled (@copal/git-app not built)";
  }
  const self = `http://127.0.0.1:${port}`;
  process.env.COPAL_SERVER ??= self;
  process.env.COPAL_API_KEY ??= devKey;
  process.env.COPAL_ENV ??= "ci";
  const real = process.env.COPAL_GIT_TARGET === "real";
  const realGitHub = real && !!(process.env.GITHUB_TOKEN || process.env.GITHUB_APP_ID);
  const realGitLab = real && !!process.env.GITLAB_TOKEN;
  if (!realGitHub) {
    process.env.GITHUB_API_URL = `${self}/github`;
    delete process.env.GITHUB_APP_ID;
    process.env.GITHUB_TOKEN = "mock";
  }
  if (!realGitLab) {
    process.env.GITLAB_API_URL = `${self}/gitlab/api/v4`;
    process.env.GITLAB_TOKEN = "mock";
  }

  for (const provider of ["github", "gitlab"] as const) {
    router.post(`/webhooks/${provider}`, async ({ req, rawBody, res }) => {
      const event = String(req.headers[provider === "github" ? "x-github-event" : "x-gitlab-event"] ?? "");
      const ok =
        provider === "github"
          ? gitApp.verifyGitHubSignature(process.env.GITHUB_WEBHOOK_SECRET, rawBody, req.headers["x-hub-signature-256"] as string)
          : gitApp.verifyGitLabToken(process.env.GITLAB_WEBHOOK_SECRET, req.headers["x-gitlab-token"] as string);
      if (!ok) throw new HttpError(401, "bad webhook signature");
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        throw new HttpError(400, "invalid JSON");
      }
      const job = gitApp.handleWebhook({ provider, event, payload });
      if (req.headers["x-copal-wait"]) return { result: await job };
      job.then((r) => console.log(`[webhook] ${provider} ${event}: ${r}`)).catch((e) => console.error(`[webhook] ${provider} ${event} failed: ${e.message}`));
      res.statusCode = 202;
      return { accepted: true };
    });
  }
  return `/webhooks/github (${realGitHub ? "real GitHub" : "fake GitHub"}), /webhooks/gitlab (${realGitLab ? "real GitLab" : "fake GitLab"})`;
}
