/** Tiny glob matcher: `**`, `*`, `?`, `{a,b}`, `[abc]`. Paths use forward slashes. */
const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const hit = cache.get(glob);
  if (hit) return hit;
  let re = "";
  let inGroup = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**/" matches zero or more directories, trailing "**" matches everything
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      inGroup++;
      re += "(?:";
    } else if (c === "}" && inGroup) {
      inGroup--;
      re += ")";
    } else if (c === "," && inGroup) re += "|";
    else if (c === "[") {
      const end = glob.indexOf("]", i);
      if (end < 0) re += "\\[";
      else {
        re += "[" + glob.slice(i + 1, end).replace(/^!/, "^") + "]";
        i = end;
      }
    } else re += c.replace(/[.+^$()|\\\/]/g, "\\$&");
  }
  const rx = new RegExp("^" + re + "$");
  cache.set(glob, rx);
  return rx;
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchGlob(path: string, glob: string | string[]): boolean {
  const p = normalizePath(path);
  const globs = Array.isArray(glob) ? glob : [glob];
  return globs.some((g) => globToRegExp(normalizePath(g)).test(p));
}

export function inScope(path: string, include?: string[], exclude?: string[]): boolean {
  if (include && include.length && !matchGlob(path, include)) return false;
  if (exclude && exclude.length && matchGlob(path, exclude)) return false;
  return true;
}
