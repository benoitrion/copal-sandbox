/*! @copal/core 0.1.0 — Copal rule engine (isomorphic build). https://github.com/benoitrion/copal-sandbox */
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/yaml.ts
var YamlError = class extends Error {
  constructor(message, line) {
    super(`YAML line ${line}: ${message}`);
    __publicField(this, "line", line);
  }
};
function parseYaml(source) {
  const lib = optionalYamlLib();
  return lib ? lib.parse(source) : parseYamlSubset(source);
}
function optionalYamlLib() {
  if (typeof __require !== "function") return null;
  try {
    return __require("yaml");
  } catch {
    return null;
  }
}
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c2 = s[i];
    if (q) {
      if (c2 === "\\" && q === '"') i++;
      else if (c2 === q) q = null;
    } else if (c2 === '"' || c2 === "'") q = c2;
    else if (c2 === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}
function parseYamlSubset(source) {
  const raw = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  const peek = () => {
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
  function blockScalar(style, parentIndent) {
    const lines = [];
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
  function parseNode(indent) {
    const l = peek();
    if (!l || l.indent < indent) return null;
    if (l.text === "-" || l.text.startsWith("- ")) return parseSeq(l.indent);
    return parseMap(l.indent);
  }
  function parseSeq(indent) {
    const out = [];
    for (; ; ) {
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
        const itemIndent = indent + 2;
        raw[i - 1] = " ".repeat(itemIndent) + rest;
        i--;
        out.push(parseMap(itemIndent));
      } else {
        out.push(scalarOrFlow(rest, l.no, indent));
      }
    }
  }
  function parseMap(indent) {
    const out = {};
    for (; ; ) {
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
        if (next && (next.indent > indent || next.indent === indent && next.text.startsWith("- "))) {
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
function isMapEntry(s) {
  return matchEntry(s) !== null;
}
function matchEntry(s) {
  let key;
  let rest;
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
function scalarOrFlow(s, line, _indent) {
  if (s.startsWith("[") || s.startsWith("{")) {
    const p = new FlowParser(s, line);
    const v = p.value();
    p.ws();
    if (p.pos !== s.length) throw new YamlError("trailing characters after flow value", line);
    return v;
  }
  return scalar(s, line);
}
function scalar(s, line = 0) {
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
var FlowParser = class {
  constructor(s, line) {
    __publicField(this, "s", s);
    __publicField(this, "line", line);
    __publicField(this, "pos", 0);
  }
  ws() {
    while (this.pos < this.s.length && /\s/.test(this.s[this.pos])) this.pos++;
  }
  value() {
    this.ws();
    const c2 = this.s[this.pos];
    if (c2 === "[") {
      this.pos++;
      const arr = [];
      this.ws();
      if (this.s[this.pos] === "]") {
        this.pos++;
        return arr;
      }
      for (; ; ) {
        arr.push(this.value());
        this.ws();
        const d = this.s[this.pos++];
        if (d === "]") return arr;
        if (d !== ",") throw new YamlError("expected , or ] in flow list", this.line);
      }
    }
    if (c2 === "{") {
      this.pos++;
      const obj = {};
      this.ws();
      if (this.s[this.pos] === "}") {
        this.pos++;
        return obj;
      }
      for (; ; ) {
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
  atom(extraStop = "") {
    this.ws();
    const c2 = this.s[this.pos];
    if (c2 === '"' || c2 === "'") {
      let j2 = this.pos + 1;
      while (j2 < this.s.length) {
        if (c2 === '"' && this.s[j2] === "\\") j2 += 2;
        else if (this.s[j2] === c2) {
          if (c2 === "'" && this.s[j2 + 1] === "'") j2 += 2;
          else break;
        } else j2++;
      }
      const tok2 = this.s.slice(this.pos, j2 + 1);
      this.pos = j2 + 1;
      return scalar(tok2, this.line);
    }
    let j = this.pos;
    while (j < this.s.length && !(",]}" + extraStop).includes(this.s[j])) j++;
    const tok = this.s.slice(this.pos, j).trim();
    this.pos = j;
    return scalar(tok, this.line);
  }
};
function toYaml(v, indent = 0) {
  const pad = " ".repeat(indent);
  const sc = (x) => {
    if (x === null || x === void 0) return "null";
    if (typeof x === "string") {
      return /^[\w./@*-][\w ./@*>,()-]*$/.test(x) && !/^(true|false|null|\d)/.test(x) && !x.includes(": ") && !x.includes(" #") ? x : JSON.stringify(x);
    }
    return String(x);
  };
  if (Array.isArray(v)) {
    if (v.length === 0) return pad + "[]\n";
    return v.map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const body = toYaml(item, indent + 2);
        return pad + "- " + body.slice(indent + 2);
      }
      return pad + "- " + sc(item) + "\n";
    }).join("");
  }
  if (v && typeof v === "object") {
    return Object.entries(v).filter(([, x]) => x !== void 0).map(([k, x]) => {
      if (x && typeof x === "object") {
        if (Array.isArray(x) && x.length === 0) return `${pad}${k}: []
`;
        if (!Array.isArray(x) && Object.keys(x).length === 0) return `${pad}${k}: {}
`;
        return `${pad}${k}:
${toYaml(x, indent + 2)}`;
      }
      return `${pad}${k}: ${sc(x)}
`;
    }).join("");
  }
  return pad + sc(v) + "\n";
}

// src/glob.ts
var cache = /* @__PURE__ */ new Map();
function globToRegExp(glob) {
  const hit = cache.get(glob);
  if (hit) return hit;
  let re = "";
  let inGroup = 0;
  for (let i = 0; i < glob.length; i++) {
    const c2 = glob[i];
    if (c2 === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c2 === "?") re += "[^/]";
    else if (c2 === "{") {
      inGroup++;
      re += "(?:";
    } else if (c2 === "}" && inGroup) {
      inGroup--;
      re += ")";
    } else if (c2 === "," && inGroup) re += "|";
    else if (c2 === "[") {
      const end = glob.indexOf("]", i);
      if (end < 0) re += "\\[";
      else {
        re += "[" + glob.slice(i + 1, end).replace(/^!/, "^") + "]";
        i = end;
      }
    } else re += c2.replace(/[.+^$()|\\\/]/g, "\\$&");
  }
  const rx = new RegExp("^" + re + "$");
  cache.set(glob, rx);
  return rx;
}
function normalizePath(p) {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}
function matchGlob(path, glob) {
  const p = normalizePath(path);
  const globs = Array.isArray(glob) ? glob : [glob];
  return globs.some((g) => globToRegExp(normalizePath(g)).test(p));
}
function inScope(path, include, exclude) {
  if (include && include.length && !matchGlob(path, include)) return false;
  if (exclude && exclude.length && matchGlob(path, exclude)) return false;
  return true;
}

// src/policy.ts
var POLICY_FILE = ".copalrules";
var BUILTIN_PACKS = {
  security: {
    version: 3,
    rules: [
      {
        id: "hardcoded-credentials",
        category: "security",
        mode: "enforce",
        severity: "error",
        secrets: true,
        why: "Credentials in source end up in git history, prompts and logs. Load them from the secret manager."
      },
      {
        id: "sql-injection",
        category: "security",
        mode: "enforce",
        severity: "error",
        pattern: `\\.(query|execute|raw)\\(\\s*(\`[^\`]*\\$\\{|["'][^"']*["']\\s*\\+)`,
        message: "SQL built by string concatenation/interpolation",
        why: "Use parameterised queries so user input can never change the statement."
      },
      {
        id: "path-traversal",
        category: "security",
        mode: "audit",
        severity: "warning",
        pattern: "(readFile|readFileSync|createReadStream|sendFile)\\([^)]*req\\.(params|query|body)",
        message: "File path built from request input",
        why: "Resolve against an allow-listed base directory and reject '..' segments."
      }
    ]
  },
  quality: {
    version: 3,
    rules: [
      {
        id: "no-console",
        category: "quality",
        mode: "audit",
        severity: "info",
        pattern: "\\bconsole\\.(log|debug)\\(",
        paths: ["**/*.{ts,tsx,js,jsx}"],
        exclude: ["**/*.test.*", "**/scripts/**"],
        message: "console.log left in production code",
        why: "Use the structured logger so output is levelled and redacted."
      },
      {
        id: "no-explicit-any",
        category: "quality",
        mode: "audit",
        severity: "warning",
        pattern: ":\\s*any\\b",
        paths: ["**/*.{ts,tsx}"],
        message: "Explicit `any` disables type checking",
        why: "Prefer a precise type or `unknown` with narrowing."
      }
    ]
  }
};
var BUILTIN_REDACT = [
  { name: "aws-access-key", pattern: "AKIA[0-9A-Z]{16}" },
  { name: "github-token", pattern: "gh[pousr]_[A-Za-z0-9]{36,}" },
  { name: "slack-token", pattern: "xox[baprs]-[A-Za-z0-9-]{10,}" },
  { name: "stripe-live-key", pattern: "sk_live_[0-9a-zA-Z]{16,}" },
  { name: "private-key", pattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----" },
  {
    name: "generic-secret-assignment",
    pattern: `(?:api[_-]?key|secret|password|passwd|token)["']?\\s*[:=]\\s*["']([^"'\\s]{8,})["']`,
    flags: "i"
  }
];
var KINDS = ["deny", "pattern", "secrets", "dependencies", "requireTest"];
function validatePolicy(p) {
  const issues = [];
  if (p.version !== 3) issues.push({ message: `unsupported version ${p.version} (expected 3)` });
  const seen = /* @__PURE__ */ new Set();
  for (const r of p.rules ?? []) {
    if (!r.id) issues.push({ message: "rule without id" });
    if (seen.has(r.id)) issues.push({ ruleId: r.id, message: "duplicate rule id" });
    seen.add(r.id);
    const kinds = KINDS.filter((k) => r[k] !== void 0 && r[k] !== false);
    if (kinds.length !== 1) issues.push({ ruleId: r.id, message: `expected exactly one of ${KINDS.join(", ")}; got ${kinds.join(", ") || "none"}` });
    if (r.mode && !["audit", "enforce", "off"].includes(r.mode)) issues.push({ ruleId: r.id, message: `invalid mode "${r.mode}"` });
    if (r.deny && !/\s->\s/.test(r.deny)) issues.push({ ruleId: r.id, message: 'deny must look like "from/** -> to/**"' });
    if (r.pattern) {
      try {
        new RegExp(r.pattern, r.flags);
      } catch (e) {
        issues.push({ ruleId: r.id, message: `invalid pattern: ${e.message}` });
      }
    }
  }
  return issues;
}
function normalize(raw, origin) {
  if (!raw || typeof raw !== "object") throw new Error(`${origin}: policy must be a mapping`);
  const o = raw;
  const ext = o.extends;
  return {
    version: Number(o.version ?? 3),
    project: o.project,
    extends: ext === void 0 || ext === null ? [] : Array.isArray(ext) ? ext : [String(ext)],
    rules: (o.rules ?? []).map((r) => ({ ...r, paths: toArr(r.paths), exclude: toArr(r.exclude), sources: toArr(r.sources) })),
    redact: o.redact ?? [],
    environments: o.environments ?? {}
  };
}
function toArr(v) {
  if (v === void 0 || v === null) return void 0;
  return Array.isArray(v) ? v.map(String) : [String(v)];
}
function parsePolicy(text, origin = POLICY_FILE) {
  const trimmed = text.trim();
  const raw = trimmed.startsWith("{") ? JSON.parse(trimmed) : parseYaml(text);
  return normalize(raw, origin);
}
function mergePolicies(parent, child) {
  const byId = /* @__PURE__ */ new Map();
  for (const r of parent.rules) byId.set(r.id, r);
  for (const r of child.rules) byId.set(r.id, byId.has(r.id) ? { ...byId.get(r.id), ...stripUndef(r) } : r);
  const envs = { ...parent.environments };
  for (const [name, env] of Object.entries(child.environments ?? {})) {
    envs[name] = { rules: { ...envs[name]?.rules ?? {}, ...env?.rules ?? {} } };
  }
  return {
    version: child.version,
    project: child.project ?? parent.project,
    rules: [...byId.values()],
    redact: [...parent.redact ?? [], ...child.redact ?? []],
    environments: envs
  };
}
function stripUndef(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== void 0));
}
function resolvePolicy(p, baseDir = ".", loader, depth = 0) {
  if (depth > 8) throw new Error("policy extends chain too deep");
  let acc = { version: 3, rules: [], redact: [], environments: {} };
  for (const ref of p.extends ?? []) {
    let parent;
    if (ref.startsWith("builtin:")) {
      const pack = BUILTIN_PACKS[ref.slice(8)];
      if (!pack) throw new Error(`unknown built-in pack "${ref}"`);
      parent = pack;
    } else {
      if (!loader) throw new Error(`cannot resolve extends "${ref}": only builtin:* packs are available here`);
      const loaded = loader(ref, baseDir);
      parent = resolvePolicy(loaded.policy, loaded.baseDir, loader, depth + 1);
    }
    acc = mergePolicies(acc, parent);
  }
  return mergePolicies(acc, { ...p, extends: [] });
}
function effectiveRules(p, environment = "local") {
  const ov = p.environments?.[environment]?.rules ?? {};
  return p.rules.map((r) => ({ ...r, ...ov[r.id] ?? {}, mode: (ov[r.id]?.mode ?? r.mode) || "audit" })).filter((r) => r.mode !== "off");
}

// src/diff.ts
function parseUnifiedDiff(diff) {
  const files = [];
  let cur = null;
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
    } else if (line === "") newLine++;
  }
  return files.filter((f) => f.path);
}
function fileAsChange(path, content) {
  return {
    path,
    status: "added",
    content,
    addedLines: content.split(/\r?\n/).map((text, i) => ({ line: i + 1, text }))
  };
}

// src/posix.ts
function normalize2(p) {
  const abs = p.startsWith("/");
  const out = [];
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
function join(...parts) {
  return normalize2(parts.filter((x) => x !== "").join("/"));
}
function dirname(p) {
  const i = p.replace(/\/+$/, "").lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return p.slice(0, i);
}
function basename(p) {
  const s = p.replace(/\/+$/, "");
  return s.slice(s.lastIndexOf("/") + 1);
}

// src/engine.ts
var IMPORT_RX = [
  /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+[^'"]*?\s+from\s+["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g
];
var DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
var NON_DEP_KEYS = /* @__PURE__ */ new Set(["name", "version", "description", "main", "types", "module", "node", "npm", "license", "type", "private"]);
function evaluate(changes, policy, opts = {}) {
  const environment = opts.environment ?? "local";
  let rules = effectiveRules(policy, environment);
  if (opts.only?.length) rules = rules.filter((r) => opts.only.includes(r.id));
  const files = changes.filter((c2) => c2.status !== "deleted").map((c2) => ({ ...c2, path: normalizePath(c2.path) }));
  const findings = [];
  for (const rule of rules) {
    if (rule.requireTest) {
      findings.push(...checkRequireTest(rule, files));
      continue;
    }
    for (const file of files) {
      if (!inScope(file.path, rule.paths, rule.exclude)) continue;
      let found = [];
      if (rule.deny) found = checkBoundary(rule, file);
      else if (rule.pattern) found = checkPattern(rule, file);
      else if (rule.secrets) found = checkSecrets(rule, file, policy);
      else if (rule.dependencies) found = checkDependencies(rule, file);
      findings.push(...found.filter((f) => !isSuppressed(file, f)));
    }
  }
  findings.sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.file.localeCompare(b.file) || a.line - b.line);
  const byCategory = {};
  for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  const blocking = findings.filter((f) => f.blocking).length;
  return {
    environment,
    findings,
    blocking: blocking > 0,
    summary: { total: findings.length, blocking, audit: findings.length - blocking, byCategory },
    filesChecked: files.length,
    rulesEvaluated: rules.length
  };
}
function base(rule, file, line, message, cat, sev) {
  const mode = rule.mode ?? "audit";
  return {
    ruleId: rule.id,
    category: rule.category ?? cat,
    severity: rule.severity ?? sev,
    mode,
    blocking: mode === "enforce",
    file,
    line,
    message: rule.message ?? message,
    why: rule.why,
    sources: rule.sources
  };
}
function isSuppressed(file, f) {
  const lines = file.content ? file.content.split(/\r?\n/) : null;
  const get = (n) => (lines ? lines[n - 1] : file.addedLines.find((l) => l.line === n)?.text) ?? "";
  const rx = new RegExp(`copal-ignore[: ]\\s*(\\*|[\\w,-]*\\b${f.ruleId}\\b)`);
  return rx.test(get(f.line)) || rx.test(get(f.line - 1));
}
function parseDeny(deny) {
  const [l, r] = deny.split(/\s+->\s+/);
  const split = (s) => s.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
  return { from: split(l ?? ""), to: split(r ?? "") };
}
function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return spec;
  return normalize2(join(dirname(fromFile), spec));
}
function checkBoundary(rule, file) {
  const { from, to } = parseDeny(rule.deny);
  if (!matchGlob(file.path, from)) return [];
  const out = [];
  for (const { line, text } of file.addedLines) {
    for (const rx of IMPORT_RX) {
      rx.lastIndex = 0;
      let m;
      while (m = rx.exec(text)) {
        const target = resolveImport(file.path, m[1]);
        const candidates = [target, `${target}/index`, `${target}.ts`];
        if (candidates.some((c2) => matchGlob(c2, to))) {
          const f = base(rule, file.path, line, `Import of "${m[1]}" crosses a forbidden boundary (${rule.deny})`, "architecture", "error");
          f.column = text.indexOf(m[1]) + 1;
          f.endColumn = f.column + m[1].length;
          out.push(f);
        }
      }
    }
  }
  return out;
}
function checkPattern(rule, file) {
  const flags = (rule.flags ?? "").replace("g", "");
  const rx = new RegExp(rule.pattern, flags);
  const out = [];
  for (const { line, text } of file.addedLines) {
    const m = rx.exec(text);
    if (!m) continue;
    const f = base(rule, file.path, line, `Matches forbidden pattern of rule ${rule.id}`, "quality", "warning");
    f.column = m.index + 1;
    f.endColumn = m.index + m[0].length + 1;
    if (rule.fix) {
      const fixRx = new RegExp(rule.fix.replace ?? rule.pattern, flags);
      const replacement = text.replace(fixRx, rule.fix.with);
      if (replacement !== text) f.suggestion = { original: text, replacement };
    }
    out.push(f);
  }
  return out;
}
function mask(s) {
  return s.length <= 8 ? "****" : `${s.slice(0, 4)}\u2026${s.slice(-4)}`;
}
function checkSecrets(rule, file, policy) {
  const detectors = [...BUILTIN_REDACT, ...policy.redact ?? []];
  const out = [];
  for (const { line, text } of file.addedLines) {
    for (const d of detectors) {
      const m = new RegExp(d.pattern, (d.flags ?? "").replace("g", "")).exec(text);
      if (!m) continue;
      const secret = m[1] ?? m[0];
      if (/^(process\.env|<|\$\{|your[-_]|xxx|changeme|example)/i.test(secret)) continue;
      const f = base(rule, file.path, line, `Hard-coded credential detected (${d.name}: ${mask(secret)})`, "security", "error");
      f.column = m.index + 1;
      f.endColumn = m.index + m[0].length + 1;
      out.push(f);
      break;
    }
  }
  return out;
}
function depNames(file) {
  if (!file.content) return null;
  try {
    const pkg = JSON.parse(file.content);
    return new Set(DEP_SECTIONS.flatMap((s) => Object.keys(pkg[s] ?? {})));
  } catch {
    return null;
  }
}
function checkDependencies(rule, file) {
  if (basename(file.path) !== "package.json") return [];
  const known = depNames(file);
  const { allow, deny } = rule.dependencies;
  const out = [];
  for (const { line, text } of file.addedLines) {
    const m = /^\s*"([^"]+)"\s*:\s*"([^"]*)"/.exec(text);
    if (!m) continue;
    const [, name, version] = m;
    if (known ? !known.has(name) : NON_DEP_KEYS.has(name) || !/^[\^~><=*\dxvwl]|^(npm|git|file|workspace):/.test(version)) continue;
    const denied = deny?.some((g) => matchGlob(name, g));
    const notAllowed = allow && allow.length > 0 && !allow.some((g) => matchGlob(name, g));
    if (denied || notAllowed) {
      const f = base(
        rule,
        file.path,
        line,
        denied ? `Dependency "${name}" is on the deny list` : `Dependency "${name}" is not on the approved list`,
        "dependency",
        "error"
      );
      f.column = text.indexOf(`"${name}"`) + 1;
      f.endColumn = f.column + name.length + 2;
      out.push(f);
    }
  }
  return out;
}
function checkRequireTest(rule, files) {
  const out = [];
  const isTest = (p) => /\.(test|spec)\.[jt]sx?$/.test(p) || p.includes("/__tests__/");
  for (const file of files) {
    if (isTest(file.path) || !inScope(file.path, rule.paths, rule.exclude)) continue;
    const dir = dirname(file.path);
    const name = basename(file.path).replace(/\.[^.]+$/, "");
    const expected = rule.requireTest.test.replace(/\{dir\}/g, dir).replace(/\{name\}/g, name);
    if (!files.some((f) => matchGlob(f.path, expected))) {
      out.push(base(rule, file.path, file.addedLines[0]?.line ?? 1, `Change has no accompanying test (expected ${expected})`, "testing", "warning"));
    }
  }
  return out;
}
function redact(text, policy) {
  const counts = /* @__PURE__ */ new Map();
  let out = text;
  for (const d of [...BUILTIN_REDACT, ...policy?.redact ?? []]) {
    const flags = (d.flags ?? "").includes("g") ? d.flags : (d.flags ?? "") + "g";
    out = out.replace(new RegExp(d.pattern, flags), (whole, g1) => {
      counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
      const tag = `[REDACTED:${d.name}]`;
      return typeof g1 === "string" && g1 && whole.includes(g1) ? whole.replace(g1, tag) : tag;
    });
  }
  return { text: out, redactions: [...counts].map(([name, count]) => ({ name, count })) };
}
function applicableRules(policy, filePath, environment = "local") {
  const rules = effectiveRules(policy, environment);
  if (!filePath) return rules;
  const p = normalizePath(filePath);
  return rules.filter((r) => {
    if (r.deny) return matchGlob(p, parseDeny(r.deny).from) && inScope(p, r.paths, r.exclude);
    if (r.dependencies) return basename(p) === "package.json";
    return inScope(p, r.paths, r.exclude);
  });
}

// src/format.ts
var useColor = () => typeof process !== "undefined" && !!process.stdout?.isTTY && !process.env?.NO_COLOR;
var c = (code) => (s) => useColor() ? `\x1B[${code}m${s}\x1B[0m` : s;
var red = c(31);
var yellow = c(33);
var green = c(32);
var dim = c(2);
var bold = c(1);
var cyan = c(36);
function formatFinding(f) {
  const tag = f.blocking ? red("BLOCK") : yellow("AUDIT");
  const lines = [`${tag} ${bold(`${f.file}:${f.line}${f.column ? ":" + f.column : ""}`)}  ${f.message}  ${dim(`[${f.ruleId}]`)}`];
  if (f.why) lines.push(`      ${dim("why:")} ${f.why}`);
  if (f.suggestion) {
    lines.push(`      ${red("- " + f.suggestion.original.trim())}`);
    lines.push(`      ${green("+ " + f.suggestion.replacement.trim())}`);
  }
  if (f.sources?.length) lines.push(`      ${dim("sources: " + f.sources.join(" \xB7 "))}`);
  return lines.join("\n");
}
function formatReport(r) {
  if (!r.findings.length) return green(`\u2714 Copal: ${r.filesChecked} file(s), ${r.rulesEvaluated} rule(s), no findings (${r.environment}).`);
  const head = r.blocking ? red(bold(`\u2716 Copal: ${r.summary.blocking} blocking finding(s)`)) + `, ${r.summary.audit} audit-only` : yellow(bold(`\u26A0 Copal: ${r.summary.audit} audit finding(s)`)) + " (nothing blocking)";
  return [head + dim(` \u2014 env ${r.environment}, ${r.filesChecked} file(s), ${r.rulesEvaluated} rule(s)`), "", ...r.findings.map(formatFinding)].join("\n");
}
function reportToMarkdown(r, title = "Copal check") {
  const status = r.blocking ? "\u{1F534} **Changes requested**" : r.findings.length ? "\u{1F7E1} **Passed with audit findings**" : "\u{1F7E2} **Passed**";
  const out = [`### ${title}`, "", `${status} \u2014 ${r.summary.blocking} blocking \xB7 ${r.summary.audit} audit \xB7 env \`${r.environment}\``, ""];
  if (r.findings.length) {
    out.push("| | Rule | Location | Finding |", "|---|---|---|---|");
    for (const f of r.findings) out.push(`| ${f.blocking ? "\u26D4" : "\u26A0\uFE0F"} | \`${f.ruleId}\` | \`${f.file}:${f.line}\` | ${f.message.replace(/\|/g, "\\|")} |`);
  }
  out.push("", "<sub>Reply `/copal false-positive <rule-id>` or add `// copal-ignore <rule-id>` to suppress a finding.</sub>");
  return out.join("\n");
}
function findingToMarkdown(f) {
  const out = [`**${f.blocking ? "\u26D4 Copal (enforce)" : "\u26A0\uFE0F Copal (audit)"}** \xB7 \`${f.ruleId}\``, "", f.message];
  if (f.why) out.push("", `> ${f.why}`);
  if (f.suggestion) out.push("", "```suggestion", f.suggestion.replacement, "```");
  if (f.sources?.length) out.push("", `<sub>Sources: ${f.sources.join(" \xB7 ")}</sub>`);
  return out.join("\n");
}
function rulesToGuidance(rules, filePath) {
  if (!rules.length) return `No Copal rules apply${filePath ? ` to ${filePath}` : ""}.`;
  const out = [`Copal engineering policy${filePath ? ` for ${filePath}` : ""} \u2014 follow these rules when writing code:`, ""];
  for (const r of rules) {
    const what = r.deny ? `Do not import across: ${r.deny}` : r.dependencies ? `Dependencies \u2014 allowed: ${r.dependencies.allow?.join(", ") || "any"}; denied: ${r.dependencies.deny?.join(", ") || "none"}` : r.secrets ? "Never hard-code credentials; read them from configuration/secret manager." : r.requireTest ? `Add/update a test matching ${r.requireTest.test}` : r.message ?? `Avoid pattern /${r.pattern}/`;
    out.push(`- [${r.mode === "enforce" ? "ENFORCED" : "audit"}] ${r.id}: ${what}${r.why ? ` \u2014 ${r.why}` : ""}${r.fix ? ` (preferred: ${r.fix.with})` : ""}`);
  }
  return out.join("\n");
}
export {
  BUILTIN_PACKS,
  BUILTIN_REDACT,
  POLICY_FILE,
  YamlError,
  applicableRules,
  bold,
  cyan,
  dim,
  effectiveRules,
  evaluate,
  fileAsChange,
  findingToMarkdown,
  formatFinding,
  formatReport,
  globToRegExp,
  green,
  inScope,
  mask,
  matchGlob,
  mergePolicies,
  normalizePath,
  parseDeny,
  parsePolicy,
  parseUnifiedDiff,
  parseYaml,
  parseYamlSubset,
  red,
  redact,
  reportToMarkdown,
  resolvePolicy,
  rulesToGuidance,
  scalar,
  toYaml,
  validatePolicy,
  yellow
};
