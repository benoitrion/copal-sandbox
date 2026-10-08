/**
 * Minimal, dependency-free YAML reader for `.copalrules`.
 *
 * Supports the subset used by policy files: block maps and sequences, "- key: value"
 * list items, quoted / plain scalars, numbers, booleans, null, flow lists `[a, b]`,
 * flow maps `{a: 1}`, block scalars `|` and `>`, and `#` comments.
 * Anchors, tags and multi-document streams are not supported.
 * If the `yaml` npm package is installed, `parseYaml` delegates to it.
 */

interface Line {
  indent: number;
  text: string;
  no: number;
}

export class YamlError extends Error {
  constructor(message: string, public line: number) {
    super(`YAML line ${line}: ${message}`);
  }
}

export function parseYaml(source: string): unknown {
  const lib = optionalYamlLib();
  return lib ? lib.parse(source) : parseYamlSubset(source);
}

/** The `yaml` npm package when it is installed (CommonJS Node only); otherwise the built-in subset parser. */
function optionalYamlLib(): { parse(s: string): unknown } | null {
  if (typeof require !== "function") return null;
  try {
    return require("yaml") as { parse(s: string): unknown };
  } catch {
    return null;
  }
}

function stripComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

export function parseYamlSubset(source: string): unknown {
  const raw = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  const peek = (): Line | null => {
    while (i < raw.length) {
      const t = stripComment(raw[i]);
      if (t.trim() === "" || t.trim() === "---") {
        i++;
        continue;
      }
      if (/^\t/.test(raw[i])) throw new YamlError("tabs are not allowed for indentation", i + 1);
      return { indent: t.length - t.trimStart().length, text: t.trim(), no: i + 1 };
    }
    return null;
  };

  function blockScalar(style: string, parentIndent: number): string {
    const lines: string[] = [];
    let ind = -1;
    while (i < raw.length) {
      const r = raw[i];
      if (r.trim() === "") {
        lines.push("");
        i++;
        continue;
      }
      const cur = r.length - r.trimStart().length;
      if (cur <= parentIndent) break;
      if (ind < 0) ind = cur;
      lines.push(r.slice(Math.min(ind, cur)));
      i++;
    }
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    const keep = style.includes("-") ? "" : "\n";
    if (style.startsWith(">")) return lines.join(" ").replace(/ {2,}/g, " ").trim() + keep;
    return lines.join("\n") + keep;
  }

  function parseNode(indent: number): unknown {
    const l = peek();
    if (!l || l.indent < indent) return null;
    if (l.text === "-" || l.text.startsWith("- ")) return parseSeq(l.indent);
    return parseMap(l.indent);
  }

  function parseSeq(indent: number): unknown[] {
    const out: unknown[] = [];
    for (;;) {
      const l = peek();
      if (!l || l.indent !== indent || !(l.text === "-" || l.text.startsWith("- "))) {
        if (l && l.indent > indent) throw new YamlError("bad indentation", l.no);
        return out;
      }
      const rest = l.text === "-" ? "" : l.text.slice(2).trim();
      i++;
      if (rest === "") {
        out.push(parseNode(indent + 1));
      } else if (isMapEntry(rest)) {
        // "- key: value" opens an inline map whose further keys sit at indent + 2
        const itemIndent = indent + 2;
        raw[i - 1] = " ".repeat(itemIndent) + rest; // re-read as a map line
        i--;
        out.push(parseMap(itemIndent));
      } else {
        out.push(scalarOrFlow(rest, l.no, indent));
      }
    }
  }

  function parseMap(indent: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (;;) {
      const l = peek();
      if (!l || l.indent < indent) return out;
      if (l.indent > indent) throw new YamlError("bad indentation", l.no);
      if (l.text.startsWith("- ")) return out;
      const m = matchEntry(l.text);
      if (!m) throw new YamlError(`expected "key: value", got "${l.text}"`, l.no);
      i++;
      const [key, value] = m;
      if (value === "") {
        const next = peek();
        if (next && (next.indent > indent || (next.indent === indent && next.text.startsWith("- ")))) {
          out[key] = parseNode(next.indent);
        } else out[key] = null;
      } else if (/^[|>][+-]?$/.test(value)) {
        out[key] = blockScalar(value, indent);
      } else {
        out[key] = scalarOrFlow(value, l.no, indent);
      }
    }
  }

  const result = parseNode(0);
  const left = peek();
  if (left) throw new YamlError(`unexpected content "${left.text}"`, left.no);
  return result;
}

function isMapEntry(s: string): boolean {
  return matchEntry(s) !== null;
}

function matchEntry(s: string): [string, string] | null {
  let key: string;
  let rest: string;
  if (s[0] === '"' || s[0] === "'") {
    const end = s.indexOf(s[0], 1);
    if (end < 0) return null;
    key = s.slice(1, end);
    rest = s.slice(end + 1);
    if (!rest.startsWith(":")) return null;
    rest = rest.slice(1);
  } else {
    const m = /^([^:{}\[\],#"'][^:#]*?)\s*:(\s|$)/.exec(s);
    if (!m) return null;
    key = m[1].trim();
    rest = s.slice(m[0].length - (m[2] ? 1 : 0));
  }
  if (rest !== "" && !/^\s/.test(rest)) return null;
  return [key, rest.trim()];
}

function scalarOrFlow(s: string, line: number, _indent: number): unknown {
  if (s.startsWith("[") || s.startsWith("{")) {
    const p = new FlowParser(s, line);
    const v = p.value();
    p.ws();
    if (p.pos !== s.length) throw new YamlError("trailing characters after flow value", line);
    return v;
  }
  return scalar(s, line);
}

export function scalar(s: string, line = 0): unknown {
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new YamlError("unterminated string", line);
    return JSON.parse(s.replace(/\\'/g, "'"));
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new YamlError("unterminated string", line);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?\d+$/.test(s)) return Number(s);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

class FlowParser {
  pos = 0;
  constructor(private s: string, private line: number) {}
  ws() {
    while (this.pos < this.s.length && /\s/.test(this.s[this.pos])) this.pos++;
  }
  value(): unknown {
    this.ws();
    const c = this.s[this.pos];
    if (c === "[") {
      this.pos++;
      const arr: unknown[] = [];
      this.ws();
      if (this.s[this.pos] === "]") {
        this.pos++;
        return arr;
      }
      for (;;) {
        arr.push(this.value());
        this.ws();
        const d = this.s[this.pos++];
        if (d === "]") return arr;
        if (d !== ",") throw new YamlError("expected , or ] in flow list", this.line);
      }
    }
    if (c === "{") {
      this.pos++;
      const obj: Record<string, unknown> = {};
      this.ws();
      if (this.s[this.pos] === "}") {
        this.pos++;
        return obj;
      }
      for (;;) {
        const k = this.atom(":");
        this.ws();
        if (this.s[this.pos++] !== ":") throw new YamlError("expected : in flow map", this.line);
        obj[String(k)] = this.value();
        this.ws();
        const d = this.s[this.pos++];
        if (d === "}") return obj;
        if (d !== ",") throw new YamlError("expected , or } in flow map", this.line);
      }
    }
    return this.atom();
  }
  atom(extraStop = ""): unknown {
    this.ws();
    const c = this.s[this.pos];
    if (c === '"' || c === "'") {
      let j = this.pos + 1;
      while (j < this.s.length) {
        if (c === '"' && this.s[j] === "\\") j += 2;
        else if (this.s[j] === c) {
          if (c === "'" && this.s[j + 1] === "'") j += 2;
          else break;
        } else j++;
      }
      const tok = this.s.slice(this.pos, j + 1);
      this.pos = j + 1;
      return scalar(tok, this.line);
    }
    let j = this.pos;
    while (j < this.s.length && !(",]}" + extraStop).includes(this.s[j])) j++;
    const tok = this.s.slice(this.pos, j).trim();
    this.pos = j;
    return scalar(tok, this.line);
  }
}

/** Serialize plain data to YAML (used by the mock server / MCP to show policies). */
export function toYaml(v: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  const sc = (x: unknown): string => {
    if (x === null || x === undefined) return "null";
    if (typeof x === "string") {
      return /^[\w./@*-][\w ./@*>,()-]*$/.test(x) && !/^(true|false|null|\d)/.test(x) && !x.includes(": ") && !x.includes(" #")
        ? x
        : JSON.stringify(x);
    }
    return String(x);
  };
  if (Array.isArray(v)) {
    if (v.length === 0) return pad + "[]\n";
    return v
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const body = toYaml(item, indent + 2);
          return pad + "- " + body.slice(indent + 2);
        }
        return pad + "- " + sc(item) + "\n";
      })
      .join("");
  }
  if (v && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => {
        if (x && typeof x === "object") {
          if (Array.isArray(x) && x.length === 0) return `${pad}${k}: []\n`;
          if (!Array.isArray(x) && Object.keys(x).length === 0) return `${pad}${k}: {}\n`;
          return `${pad}${k}:\n${toYaml(x, indent + 2)}`;
        }
        return `${pad}${k}: ${sc(x)}\n`;
      })
      .join("");
  }
  return pad + sc(v) + "\n";
}
