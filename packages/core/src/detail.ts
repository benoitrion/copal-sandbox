/**
 * Code-specific wording for a finding: names, fields and branches from the code itself, so a hint says something
 * about this line instead of repeating the rule. Pure string analysis, no type checker.
 */

/** `x: any` → which fields of `x` the code reads, and the type that would describe them. */
export function anyDetail(lineText: string, content?: string): { detail: string; fix?: string } | undefined {
  const m = /(\w+)\s*\??:\s*any\b/.exec(lineText);
  const fnReturn = !m && /\)\s*:\s*any\b/.test(lineText);
  if (fnReturn) return { detail: "This function returns `any`: callers lose type checking", fix: "Return a named type, or `unknown` if callers must check it." };
  if (!m) return undefined;
  const name = m[1];
  const fields = content ? [...new Set([...content.matchAll(new RegExp(`\\b${name}\\??\\.(\\w+)`, "g"))].map((x) => x[1]))].filter((f) => !/^(length|map|forEach|filter|push|then)$/.test(f)).slice(0, 5) : [];
  if (!fields.length) return { detail: `\`${name}\` is \`any\`: nothing checks how it is used`, fix: `Type \`${name}\`, or use \`unknown\` and check it before use.` };
  const shape = `{ ${fields.map((f) => `${f}: …`).join("; ")} }`;
  return { detail: `\`${name}\` is \`any\` but the code reads ${fields.map((f) => `.${f}`).join(", ")}`, fix: `Type it: \`${name}: ${shape}\`` };
}

/** Exported functions of a file with their number of decision points (if, case, ?:, &&, ||). */
export function exportedFunctions(content: string): { name: string; branches: number }[] {
  const lines = content.split(/\r?\n/);
  const out: { name: string; branches: number }[] = [];
  lines.forEach((l, i) => {
    const m = /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/.exec(l);
    if (!m) return;
    let depth = 0, started = false, branches = 0;
    for (let j = i; j < lines.length; j++) {
      const t = lines[j].replace(/(["'`]).*?\1/g, "");
      branches += (t.match(/\bif\s*\(|\bcase\b|\?[^.?:]|&&|\|\|/g) ?? []).length;
      for (const ch of t) {
        if (ch === "{") (depth++, (started = true));
        if (ch === "}") depth--;
      }
      if (started && depth <= 0) break;
    }
    out.push({ name: m[1] ?? m[2], branches });
  });
  return out;
}

/** "No test changed" → which functions are untested and how many cases they have. */
export function testDetail(fileName: string, content?: string): string | undefined {
  if (!content) return undefined;
  const fns = exportedFunctions(content);
  if (!fns.length) return undefined;
  const top = [...fns].sort((a, b) => b.branches - a.branches);
  const cases = (n: number) => (n ? `${n + 1} cases` : "1 case");
  if (fns.length === 1) return `\`${fns[0].name}\` has ${cases(fns[0].branches)} and no test`;
  return `${fns.length} functions in ${fileName} and no test; start with \`${top[0].name}\` (${cases(top[0].branches)})`;
}

/** A first test file for the untested functions: one example per function to fill in, cases listed. */
export function testSkeletonFor(sourcePath: string, testPath: string, content?: string): string | undefined {
  if (!content) return undefined;
  const fns = exportedFunctions(content).slice(0, 3);
  if (!fns.length) return undefined;
  const rel = (() => {
    const from = testPath.split("/").slice(0, -1);
    const to = sourcePath.replace(/\.[jt]sx?$/, "").split("/");
    let i = 0;
    while (i < from.length && from[i] === to[i]) i++;
    const up = from.length - i;
    return (up ? "../".repeat(up) : "./") + to.slice(i).join("/");
  })();
  const lines = [`import { ${fns.map((f) => f.name).join(", ")} } from "${rel}";`, ""];
  for (const f of fns) {
    lines.push(`describe("${f.name}", () => {`, `  it("<first example: input → expected result>", () => {`, `    expect(${f.name}(/* input */)).toEqual(/* expected */);`, "  });");
    if (f.branches) lines.push(`  // ${f.branches} more case${f.branches > 1 ? "s" : ""} to pin down: one example each`);
    lines.push("});", "");
  }
  return lines.join("\n").trimEnd();
}
