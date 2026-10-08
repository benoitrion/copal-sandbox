import { HttpError, Router, send } from "./http";
import type { FakePull, Store } from "./store";

/** Split a multi-file unified diff into per-file chunks (GitLab "changes" format). */
function splitDiff(diff: string) {
  return diff
    .split(/^(?=diff --git )/m)
    .filter((c) => c.startsWith("diff --git"))
    .map((chunk) => {
      const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk)!;
      const hunkStart = chunk.indexOf("\n@@");
      return {
        old_path: m[1],
        new_path: m[2],
        new_file: /^new file mode/m.test(chunk),
        deleted_file: /^deleted file mode/m.test(chunk),
        renamed_file: /^rename to /m.test(chunk),
        diff: hunkStart >= 0 ? chunk.slice(hunkStart + 1) : "",
      };
    });
}

export function registerFakeGit(router: Router, store: Store) {
  const now = () => new Date().toISOString();
  const find = (provider: FakePull["provider"], repo: string, n: string) => {
    const pr = store.state.pulls.find((p) => p.provider === provider && p.repo === repo && p.number === Number(n));
    if (!pr) throw new HttpError(404, `no ${provider} PR ${repo}#${n} (create one with POST /${provider}/_sim/pulls)`);
    return pr;
  };

  // ---- simulator entry point: register / update a PR (used by `copal-git-app simulate`)
  for (const provider of ["github", "gitlab"] as const) {
    router.post(`/${provider}/_sim/pulls`, ({ body }) => {
      const existing = store.state.pulls.find((p) => p.provider === provider && p.repo === body.repo && p.number === body.number);
      if (existing) {
        Object.assign(existing, { headSha: body.headSha, baseSha: body.baseSha, diff: body.diff, files: body.files });
        store.save();
        return existing;
      }
      const pr: FakePull = {
        provider,
        repo: body.repo,
        number: body.number ?? store.state.pulls.filter((p) => p.provider === provider && p.repo === body.repo).length + 1,
        title: body.title ?? "Untitled",
        author: body.author ?? "dev",
        headSha: body.headSha,
        baseSha: body.baseSha,
        diff: body.diff,
        files: body.files ?? {},
        reviews: [],
        comments: [],
        statuses: [],
      };
      store.state.pulls.unshift(pr);
      store.save();
      return pr;
    });
  }

  // ---- GitHub REST subset
  router.get("/github/repos/:owner/:repo/pulls/:n", ({ params, req, res }) => {
    const pr = find("github", `${params.owner}/${params.repo}`, params.n);
    if ((req.headers.accept ?? "").includes("diff")) {
      res.writeHead(200, { "content-type": "text/x-diff" });
      return res.end(pr.diff);
    }
    return { number: pr.number, title: pr.title, user: { login: pr.author }, head: { sha: pr.headSha }, base: { sha: pr.baseSha } };
  });
  router.get("/github/repos/:owner/:repo/contents/*", ({ params, query }) => {
    const pr = store.state.pulls.find((p) => p.provider === "github" && p.repo === `${params.owner}/${params.repo}` && p.headSha === query.get("ref"));
    const content = pr?.files[params.rest];
    if (content === undefined) throw new HttpError(404, "Not Found");
    return { path: params.rest, encoding: "base64", content: Buffer.from(content).toString("base64") };
  });
  router.post("/github/repos/:owner/:repo/pulls/:n/reviews", ({ params, body }) => {
    const pr = find("github", `${params.owner}/${params.repo}`, params.n);
    pr.reviews.push({ at: now(), event: body.event, body: body.body ?? "", comments: (body.comments ?? []).map((c: any) => ({ path: c.path, line: c.line, body: c.body })) });
    store.save();
    return { id: pr.reviews.length, state: body.event };
  });
  router.post("/github/repos/:owner/:repo/issues/:n/comments", ({ params, body }) => {
    const pr = find("github", `${params.owner}/${params.repo}`, params.n);
    pr.comments.push({ at: now(), body: body.body });
    store.save();
    return { id: pr.comments.length };
  });
  router.post("/github/repos/:owner/:repo/statuses/:sha", ({ params, body }) => {
    const pr = store.state.pulls.find((p) => p.provider === "github" && p.repo === `${params.owner}/${params.repo}` && p.headSha === params.sha);
    if (!pr) throw new HttpError(422, "No commit found for SHA");
    pr.statuses.push({ at: now(), sha: params.sha, state: body.state, context: body.context, description: body.description });
    store.save();
    return { state: body.state, context: body.context };
  });

  // ---- GitLab REST subset (:id is the URL-encoded "group/project")
  const G = "/gitlab/api/v4/projects/:id";
  router.get(`${G}/merge_requests/:iid`, ({ params }) => {
    const pr = find("gitlab", params.id, params.iid);
    return { iid: pr.number, title: pr.title, author: { username: pr.author }, sha: pr.headSha, diff_refs: { base_sha: pr.baseSha, head_sha: pr.headSha, start_sha: pr.baseSha } };
  });
  router.get(`${G}/merge_requests/:iid/changes`, ({ params }) => {
    const pr = find("gitlab", params.id, params.iid);
    return { iid: pr.number, changes: splitDiff(pr.diff), diff_refs: { base_sha: pr.baseSha, head_sha: pr.headSha, start_sha: pr.baseSha } };
  });
  router.get(`${G}/repository/files/:path/raw`, ({ params, query, res }) => {
    const pr = store.state.pulls.find((p) => p.provider === "gitlab" && p.repo === params.id && p.headSha === query.get("ref"));
    const content = pr?.files[params.path];
    if (content === undefined) throw new HttpError(404, "404 File Not Found");
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(content);
  });
  router.post(`${G}/merge_requests/:iid/discussions`, ({ params, body }) => {
    const pr = find("gitlab", params.id, params.iid);
    const pos = body.position;
    const comment = { path: pos?.new_path ?? "", line: Number(pos?.new_line ?? 0), body: body.body };
    const last = pr.reviews[pr.reviews.length - 1];
    // group discussions created within the same second into one "review" for the console
    if (last && Date.now() - Date.parse(last.at) < 3000 && last.event === "discussions") last.comments.push(comment);
    else pr.reviews.push({ at: now(), event: "discussions", body: "", comments: [comment] });
    store.save();
    return { id: String(Date.now()), notes: [{ body: body.body }] };
  });
  router.post(`${G}/merge_requests/:iid/notes`, ({ params, body }) => {
    const pr = find("gitlab", params.id, params.iid);
    pr.comments.push({ at: now(), body: body.body });
    store.save();
    return { id: pr.comments.length };
  });
  router.post(`${G}/statuses/:sha`, ({ params, body }) => {
    const pr = store.state.pulls.find((p) => p.provider === "gitlab" && p.repo === params.id && p.headSha === params.sha);
    if (!pr) throw new HttpError(404, "404 Commit Not Found");
    pr.statuses.push({ at: now(), sha: params.sha, state: body.state, context: body.name ?? "copal", description: body.description });
    store.save();
    return { status: body.state };
  });

  void send;
}
