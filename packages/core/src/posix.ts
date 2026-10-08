/** Minimal POSIX path helpers so the engine runs unchanged in Node, Deno (Supabase Edge) and browsers. */

export function normalize(p: string): string {
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
    } else out.push(seg);
  }
  const s = out.join("/");
  return abs ? "/" + s : s || ".";
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((x) => x !== "").join("/"));
}

export function dirname(p: string): string {
  const i = p.replace(/\/+$/, "").lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return p.slice(0, i);
}

export function basename(p: string): string {
  const s = p.replace(/\/+$/, "");
  return s.slice(s.lastIndexOf("/") + 1);
}
