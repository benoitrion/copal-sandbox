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
