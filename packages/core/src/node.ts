/** Node-only helpers (filesystem). Not part of the isomorphic entry used by Deno and browsers. */
import * as fs from "node:fs";
import * as path from "node:path";
import { parsePolicy, POLICY_FILE, PolicyLoader, resolvePolicy } from "./policy";
import type { Policy } from "./types";

export function readPolicyFile(file: string): Policy {
  return parsePolicy(fs.readFileSync(file, "utf8"), file);
}

/** Resolves file `extends` relative to the referencing policy, using the platform's path rules. */
export const nodePolicyLoader: PolicyLoader = (ref, baseDir) => {
  const file = path.resolve(baseDir, ref);
  return { policy: readPolicyFile(file), baseDir: path.dirname(file) };
};

/** Find `.copalrules` walking up from `start`. */
export function findPolicyFile(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    const f = path.join(dir, POLICY_FILE);
    if (fs.existsSync(f)) return f;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function loadPolicy(fileOrDir: string): { policy: Policy; file: string; root: string } {
  const file = fs.existsSync(fileOrDir) && fs.statSync(fileOrDir).isDirectory() ? findPolicyFile(fileOrDir) : fileOrDir;
  if (!file || !fs.existsSync(file)) throw new Error(`no ${POLICY_FILE} found from ${fileOrDir}`);
  const root = path.dirname(file);
  return { policy: resolvePolicy(readPolicyFile(file), root, nodePolicyLoader), file, root };
}
