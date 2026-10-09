import { execFileSync } from "node:child_process";
import { fileAsChange, FileChange, parseUnifiedDiff } from "@copal/core";

export function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export function repoRoot(cwd: string): string {
  return git(["rev-parse", "--show-toplevel"], cwd).trim();
}

function tryGit(args: string[], cwd: string): string | undefined {
  try {
    return git(args, cwd);
  } catch {
    return undefined;
  }
}

/** Changes in the index (what is about to be committed), with staged file contents. */
export function stagedChanges(root: string): FileChange[] {
  const diff = git(["diff", "--cached", "--no-color", "--no-ext-diff", "-U0", "--diff-filter=ACMR"], root);
  return parseUnifiedDiff(diff).map((f) => ({ ...f, content: tryGit(["show", `:${f.path}`], root) }));
}

/** Changes of the current branch against a base ref (merge-base), with HEAD contents. */
export function branchChanges(root: string, base: string): FileChange[] {
  const diff = git(["diff", "--no-color", "--no-ext-diff", "-U0", "--diff-filter=ACMR", `${base}...HEAD`], root);
  return parseUnifiedDiff(diff).map((f) => ({ ...f, content: tryGit(["show", `HEAD:${f.path}`], root) }));
}

/** Branch + uncommitted + untracked changes against a base ref (what "my change" is right now). */
export function worktreeChanges(root: string, base: string): FileChange[] {
  const mb = (tryGit(["merge-base", base, "HEAD"], root) ?? base).trim();
  const diff = git(["diff", "--no-color", "--no-ext-diff", "-U0", "--diff-filter=ACMR", mb], root);
  const fs = require("node:fs");
  const changes = parseUnifiedDiff(diff);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], root).split("\n").filter(Boolean);
  for (const p of untracked) {
    try {
      changes.push(fileAsChange(p, fs.readFileSync(`${root}/${p}`, "utf8")));
    } catch {
      /* unreadable */
    }
  }
  return changes;
}

/** The base to compare with: the given ref, else origin/main, main or master. */
export function defaultBase(root: string, given?: string): string {
  if (given) return given;
  for (const b of ["origin/main", "main", "master"]) if (tryGit(["rev-parse", "--verify", "--quiet", b], root)) return b;
  return "HEAD";
}

/** Commits of the branch since base, oldest first, with the paths each one touched. */
export function branchCommits(root: string, base: string): { sha: string; files: string[] }[] {
  const out = tryGit(["log", "--reverse", "--no-merges", "--name-only", "--format=%x01%H", `${base}..HEAD`], root) ?? "";
  return out
    .split("\x01")
    .filter((b) => b.trim())
    .map((b) => {
      const [sha, ...files] = b.trim().split("\n").map((l) => l.trim()).filter(Boolean);
      return { sha, files };
    });
}

/** Every tracked file as fully added (full branch analysis). */
export function allTrackedFiles(root: string, filter = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|py|go|java)$/): FileChange[] {
  return git(["ls-files"], root)
    .split("\n")
    .filter((p) => p && filter.test(p))
    .map((p) => fileAsChange(p, tryGit(["show", `HEAD:${p}`], root) ?? require("node:fs").readFileSync(`${root}/${p}`, "utf8")));
}

export function currentRef(root: string): string {
  return (tryGit(["rev-parse", "--abbrev-ref", "HEAD"], root) ?? "HEAD").trim();
}

export function author(root: string): string | undefined {
  return tryGit(["config", "user.name"], root)?.trim() || undefined;
}
