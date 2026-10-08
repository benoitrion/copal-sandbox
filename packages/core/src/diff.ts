import type { FileChange } from "./types";

/** Parse a unified diff (git diff / GitHub .diff / GitLab changes) into file changes. */
export function parseUnifiedDiff(diff: string): FileChange[] {
  const files: FileChange[] = [];
  let cur: FileChange | null = null;
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      cur = { path: m ? m[2] : "", status: "modified", addedLines: [] };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!inHunk && line.startsWith("--- ")) {
      if (!cur) {
        cur = { path: "", status: "modified", addedLines: [] };
        files.push(cur);
      }
      if (line === "--- /dev/null") cur.status = "added";
      continue;
    }
    if (!inHunk && line.startsWith("+++ ") && cur) {
      const p = line.slice(4).replace(/\t.*$/, "");
      if (p === "/dev/null") cur.status = "deleted";
      else cur.path = p.replace(/^b\//, "");
      continue;
    }
    if (cur && !inHunk) {
      if (line.startsWith("new file mode")) cur.status = "added";
      else if (line.startsWith("deleted file mode")) cur.status = "deleted";
      else if (line.startsWith("rename to ")) {
        cur.status = "renamed";
        cur.path = line.slice(10);
      }
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h && cur) {
      newLine = Number(h[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || !cur) continue;
    if (line.startsWith("+")) {
      cur.addedLines.push({ line: newLine, text: line.slice(1) });
      newLine++;
    } else if (line.startsWith(" ")) newLine++;
    else if (line.startsWith("-") || line.startsWith("\\")) {
      /* removed line / "no newline" marker */
    } else if (line === "") newLine++;
  }
  return files.filter((f) => f.path);
}

/** Treat a whole file as newly added (editor checks, MCP snippet checks, full-branch scans). */
export function fileAsChange(path: string, content: string): FileChange {
  return {
    path,
    status: "added",
    content,
    addedLines: content.split(/\r?\n/).map((text, i) => ({ line: i + 1, text })),
  };
}
