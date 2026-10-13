/*! @copal/core 0.3.0 — Copal rule engine (isomorphic build). https://github.com/benoitrion/copal-sandbox */
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

// src/coach.ts
function containsCode(text) {
  return /```|`[^`]*[(){};=<>][^`]*`/.test(text) || /\b(import|export|const|let|var|function|class|return|def|public|private)\s+[\w{]/.test(text) || /[;{}]\s*$/m.test(text) || /\w+\([^)]*\)\s*(=>|\{)/.test(text) || /=>/.test(text);
}
var HINT_LEVELS = {
  0: "signal",
  1: "question",
  2: "reference",
  3: "worked-example",
  4: "fix"
};
function asksQuestion(f) {
  return f.blocking || !f.kind || ["Architecture", "Dependencies", "Security", "Change size"].includes(f.kind);
}
function hintCard(f) {
  const c2 = f.coach ?? {};
  const fix = f.suggestion ? f.suggestion.replacement.trim() : f.fixText;
  const card = {
    ruleId: f.ruleId,
    title: `${f.ruleId} \xB7 ${f.category}`,
    location: `${f.file}:${f.line}`,
    signal: f.detail ?? f.message,
    question: asksQuestion(f) ? c2.question : void 0,
    why: f.why,
    reference: c2.reference,
    example: c2.example,
    fix,
    kata: c2.kata,
    learningHour: c2.learningHour,
    blocking: f.blocking,
    maxLevel: c2.example ? 3 : c2.reference || f.why ? 2 : c2.question ? 1 : 0
  };
  return card;
}
function rulesWithoutCoaching(p) {
  return p.rules.filter((r) => !r.coach?.question).map((r) => r.id);
}
function kataSuggestions(policy, occurrences, now = Date.now(), windowDays = 14) {
  const since = now - windowDays * 864e5;
  const rules = new Map(policy.rules.map((r) => [r.id, r]));
  const recent = occurrences.filter((o) => new Date(o.at).getTime() >= since);
  const out = [];
  const byRuleDev = /* @__PURE__ */ new Map();
  for (const o of recent) {
    const k = `${o.ruleId}\0${o.developer ?? ""}`;
    byRuleDev.set(k, (byRuleDev.get(k) ?? 0) + 1);
  }
  const devsByRule = /* @__PURE__ */ new Map();
  for (const [k, count] of byRuleDev) {
    const [ruleId, developer] = k.split("\0");
    const rule = rules.get(ruleId);
    if (!rule?.coach) continue;
    const threshold = rule.coach.escalateAfter ?? 3;
    if (count >= threshold) {
      if (!devsByRule.has(ruleId)) devsByRule.set(ruleId, /* @__PURE__ */ new Set());
      devsByRule.get(ruleId).add(developer);
      out.push({
        ruleId,
        developer: developer || void 0,
        count,
        kata: rule.coach.kata,
        learningHour: rule.coach.learningHour,
        reason: `${ordinal(count)} ${ruleId} in ${windowDays} days`
      });
    }
  }
  for (const [ruleId, devs] of devsByRule) {
    const rule = rules.get(ruleId);
    if (devs.size >= 2 && rule.coach?.learningHour)
      out.push({ ruleId, count: devs.size, learningHour: rule.coach.learningHour, reason: `${devs.size} developers hit ${ruleId} this sprint \u2014 learning-hour topic` });
  }
  return out.sort((a, b) => b.count - a.count);
}
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
var SMALL_TASK = /^\s*(fix (a |the )?typo|rename|format|reformat|bump|update (the )?(readme|docs?|changelog)|lint|add (a )?comment|remove unused|sort imports)\b/i;
var FEATURE_HINT = /\b(add|build|create|implement|introduce|support|feature|endpoint|service|refactor|redesign|migrate|integrate|new)\b/i;
var OPT_OUT = /\b(just do it|no questions|skip (the )?(navigator|questions)|copal:\s*skip)\b/i;
function taskScope(task) {
  const t = task.trim();
  if (!t || SMALL_TASK.test(t)) return "small";
  if (FEATURE_HINT.test(t) || t.split(/\s+/).length >= 12) return "feature";
  return "small";
}
function navigatorQuestions(policy, task, opts = {}) {
  const nav = policy?.navigator ?? {};
  if (nav.enabled === false) return { engage: false, reason: "navigator disabled in .copalrules", questions: [] };
  if (OPT_OUT.test(task)) return { engage: false, reason: "developer opted out for this task", questions: [] };
  if (!opts.force && (nav.minScope ?? "feature") === "feature" && taskScope(task) === "small")
    return { engage: false, reason: "small task \u2014 no navigator needed", questions: [] };
  const kinds = (nav.questions?.length ? nav.questions : ["first-example", "placement", "risk"]).slice(0, Math.min(nav.maxQuestions ?? 3, 3));
  const subject = summarize(task);
  const boundaries = (policy?.rules ?? []).filter((r) => r.deny).map((r) => r.deny.split(/\s+->\s+/)[0]);
  const where = opts.files?.length ? ` You mentioned ${opts.files.slice(0, 2).join(", ")}.` : "";
  const text = {
    "first-example": `What is the first concrete example ${subject} must handle \u2014 input and expected result? That becomes the first failing test.`,
    placement: boundaries.length ? `Where does this belong, given the team's boundaries (${boundaries.slice(0, 3).join(", ")})? Which module owns the rule, and what stays outside it?${where}` : `Where does this belong \u2014 which module owns the rule, and what stays outside it?${where}`,
    risk: "What could go wrong \u2014 which edge case, invalid input or failure must it handle?"
  };
  const questions = kinds.map((kind, i) => ({ id: `q${i + 1}`, kind, text: text[kind] }));
  return { engage: questions.length > 0, reason: questions.length ? "feature-sized task" : "no questions configured", questions: questions.filter((q) => !containsCode(q.text)) };
}
function summarize(task) {
  const t = task.replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "");
  const short = t.length > 60 ? t.slice(0, 57).replace(/\s+\S*$/, "") + "\u2026" : t;
  return short ? `"${short}"` : "this change";
}
function buildBrief(policy, task, questions, answers, skipped = false, opts = {}) {
  const byKind = (k) => {
    const q = questions.find((x) => x.kind === k);
    const a = q && answers.find((x) => x.id === q.id)?.text?.trim();
    return a || void 0;
  };
  const risk = byKind("risk");
  const brief = {
    task,
    skipped,
    firstTest: byKind("first-example"),
    location: byKind("placement"),
    edgeCases: risk ? risk.split(/\s*(?:;|\n|,\s*(?=and\b)|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean) : [],
    examples: [],
    scope: {},
    rules: (policy?.rules ?? []).filter((r) => r.mode !== "off").slice(0, 12).map((r) => ({ id: r.id, what: ruleSummary(r) })),
    instructions: []
  };
  brief.examples = [brief.firstTest, ...brief.edgeCases].filter((x) => !!x).slice(0, 4);
  if (brief.location) brief.scope.in = brief.location;
  if (opts.outOfScope?.trim()) brief.scope.out = opts.outOfScope.trim();
  brief.instructions = [
    ...brief.examples.length ? [EXAMPLES_FIRST] : [],
    brief.firstTest ? `Start with one failing test for: ${brief.firstTest}. Make it pass with the simplest code, then refactor.` : "Start with one failing test for the simplest case, make it pass, then refactor.",
    brief.location ? `Put the logic where the developer said: ${brief.location}.` : "Ask the developer where the logic belongs before creating new modules.",
    ...brief.edgeCases.map((e) => `Add a test for: ${e}.`),
    "Work in small steps: one test at a time, run the tests after each step, stop and ask when a design choice is not covered.",
    "Respect the Copal rules listed in the brief; explain any rule you think should not apply instead of working around it.",
    REPORT_RULE
  ];
  return brief;
}
var EXAMPLES_FIRST = "Write the agreed examples as failing tests first, show them, and wait for the developer's OK before implementing. Then implement in small steps until they pass \u2014 nothing beyond the examples.";
var PLAN_CHECK = "Start with a short plan: the files you will touch and why, which rules above apply to each, and the first example you will write as a test. If a file is outside the agreed scope or a step would break a rule, ask the developer before writing any code.";
var REPORT_RULE = "End every task with two lists: Assumptions I made that you didn't state, and Things I added beyond the agreed examples.";
function briefToMarkdown(b) {
  const out = [`# Task: ${b.task}`, ""];
  out.push(`Scope in: ${b.scope.in ?? "(not stated \u2014 ask)"}`, `Scope out: ${b.scope.out ?? "(not stated \u2014 ask)"}`, "", "## Examples");
  out.push(...b.examples.length ? b.examples.map((e) => `- [ ] ${e}`) : ["- (none agreed yet \u2014 ask for the first example)"]);
  out.push("", "Done when: every example above passes as a test, existing tests stay green, nothing beyond the examples.");
  if (b.examples.length) out.push(`Next: make "${b.examples[0]}" pass`);
  out.push("", "## How to work", ...b.instructions.map((i) => `- ${i}`));
  if (b.rules.length) out.push("", "## Team rules", ...b.rules.map((r) => `- ${r.id}: ${r.what}`));
  return out.join("\n") + "\n";
}
function briefToText(b) {
  const out = [`Copal navigator brief \u2014 ${b.skipped ? "developer skipped the questions" : "agreed with the developer"}`, `Task: ${b.task}`];
  if (b.firstTest) out.push(`First failing test: ${b.firstTest}`);
  if (b.location) out.push(`Location: ${b.location}`);
  if (b.edgeCases.length) out.push(`Edge cases: ${b.edgeCases.join("; ")}`);
  if (b.scope.out) out.push(`Do not touch: ${b.scope.out}`);
  out.push("", "How to work:", ...b.instructions.map((i) => `- ${i}`));
  if (b.rules.length) out.push("", "Team rules:", ...b.rules.map((r) => `- ${r.id}: ${r.what}`));
  return out.join("\n");
}
function ruleSummary(r) {
  if (r.deny) return `no imports across ${r.deny}`;
  if (r.secrets) return "no hard-coded credentials";
  if (r.dependencies) return `dependencies allowed: ${r.dependencies.allow?.join(", ") || "any"}`;
  if (r.requireTest) return `changes need a test matching ${r.requireTest.test}`;
  if (r.changeSize) return `keep each change under ${r.changeSize.maxLines ?? "\u221E"} lines and ${r.changeSize.maxFiles ?? "\u221E"} files`;
  if (r.smell) return `avoid ${r.smell.kind.replace(/-/g, " ")}${r.smell.max ? ` (max ${r.smell.max})` : ""}`;
  return r.message ?? r.why ?? `avoid /${r.pattern}/`;
}
function draftRuleFromReview(input) {
  const text = input.text.replace(/^\s*\/copal\s+rule\b[:\s]*/i, "").replace(/\s+/g, " ").trim();
  const words2 = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const id = (words2.slice(0, 4).join("-") || "review-rule").slice(0, 48);
  const dir = input.path && input.path.includes("/") ? input.path.slice(0, input.path.lastIndexOf("/")) : void 0;
  const sentence = text.replace(/[.!]+$/, "");
  const question = /\?\s*$/.test(text) ? text : `Before you write this: ${sentence.charAt(0).toLowerCase() + sentence.slice(1)} \u2014 how does your change handle that?`;
  const rule = {
    id,
    category: "quality",
    mode: "audit",
    ...dir ? { paths: [`${dir}/**`] } : {},
    why: text,
    sources: [input.source ?? "review comment", ...input.author ? [`@${input.author}`] : []],
    coach: { question: containsCode(question) ? "What should the author check here before asking for review?" : question, ...input.source ? { reference: input.source } : {} }
  };
  const yaml = [
    "# Draft from a review comment \u2014 finish and add under `rules:` in .copalrules",
    "# Add ONE check if it can be detected (pattern / deny / smell / requireTest),",
    "# or keep it coaching-only: agents still receive it through `copal sync-context`.",
    `- id: ${rule.id}`,
    `  category: quality`,
    `  mode: audit`,
    ...dir ? [`  paths: ["${dir}/**"]`] : [],
    `  # pattern: "\u2026"            # e.g. a regex on added lines`,
    `  why: ${JSON.stringify(text)}`,
    `  sources: [${rule.sources.map((s) => JSON.stringify(s)).join(", ")}]`,
    `  coach:`,
    `    question: ${JSON.stringify(rule.coach.question)}`,
    ...input.source ? [`    reference: ${input.source}`] : [`    # reference: docs/rules/${rule.id}.md`],
    `    # kata: https://sammancoaching.org/kata_descriptions/\u2026`
  ].join("\n");
  return { rule, yaml };
}
var STOP = /* @__PURE__ */ new Set(["the", "and", "for", "you", "this", "that", "with", "should", "please", "don", "dont", "not", "are", "use", "here", "have", "from", "into", "our", "we", "always", "never", "must", "avoid", "instead", "copal", "rule"]);
var AGENT_CONTEXT_TARGETS = {
  claude: { file: "CLAUDE.md" },
  agents: { file: "AGENTS.md" },
  cursor: { file: ".cursor/rules/copal.mdc", header: "---\ndescription: Team engineering rules from .copalrules (managed by Copal)\nalwaysApply: true\n---\n" },
  copilot: { file: ".github/copilot-instructions.md" }
};
var CONTEXT_BEGIN = "<!-- copal:begin (generated from .copalrules \u2014 edit the rules, not this block) -->";
var CONTEXT_END = "<!-- copal:end -->";
function agentContextBlock(policy, project) {
  const rules = policy.rules.filter((r) => r.mode !== "off");
  const lines = [CONTEXT_BEGIN, `## Team engineering rules${project ? ` (${project})` : ""}`, ""];
  lines.push("Follow these rules when writing code in this repository. ENFORCED rules block the commit and the PR check.", "");
  for (const r of rules) {
    lines.push(`- **${r.id}**${r.mode === "enforce" ? " (ENFORCED)" : ""}: ${ruleSummary(r)}.${r.why && r.why !== ruleSummary(r) ? ` ${r.why}` : ""}${r.coach?.reference ? ` See ${r.coach.reference}.` : ""}`);
  }
  const qs = rules.filter((r) => r.coach?.question);
  if (qs.length) {
    lines.push("", "### Ask the developer first", "When your change touches one of these rules, ask the question instead of silently deciding:");
    for (const r of qs) lines.push(`- ${r.id}: ${r.coach.question}`);
  }
  lines.push(
    "",
    "### Before you write code",
    `- ${PLAN_CHECK}`,
    "",
    "### How to work",
    "- For a feature-sized task, first ask: the first concrete example (it becomes the first failing test), where the code belongs, and what could go wrong.",
    `- ${EXAMPLES_FIRST}`,
    `- ${REPORT_RULE}`,
    "- If `.copal/brief.md` exists, it holds the agreed task, scope and examples.",
    "- When the copal CLI or the copal_check_staged MCP tool is available, run it on your change before committing.",
    CONTEXT_END
  );
  return lines.join("\n");
}
function mergeManagedBlock(current, block, header) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`${esc(CONTEXT_BEGIN)}[\\s\\S]*?${esc(CONTEXT_END)}`);
  if (rx.test(current)) return current.replace(rx, block);
  if (!current) return `${header ?? ""}${block}
`;
  return `${current}${current.endsWith("\n") ? "" : "\n"}
${block}
`;
}

// src/policy.ts
var POLICY_FILE = ".copalrules";
var SUPPORTED_VERSIONS = [3, 4];
var SAMMAN = "https://sammancoaching.org/kata_descriptions";
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
        why: "Credentials in source end up in git history, prompts and logs. Load them from the secret manager.",
        fix: "Remove the literal, read it from configuration (e.g. config.require('PAYMENTS_KEY') backed by the secret manager), and rotate the exposed credential.",
        coach: {
          question: "Where should this value live so it never reaches git, a prompt or a log?",
          example: { bad: 'const key = "AKIA\u2026"', good: "const key = config.require('PAYMENTS_KEY')" }
        }
      },
      {
        id: "sql-injection",
        category: "security",
        mode: "enforce",
        severity: "error",
        pattern: `\\.(query|execute|raw)\\(\\s*(\`[^\`]*\\$\\{|["'][^"']*["']\\s*\\+)`,
        message: "SQL built by string concatenation/interpolation",
        why: "Use parameterised queries so user input can never change the statement.",
        coach: {
          question: "What happens to this statement if the input contains a quote?",
          example: { bad: "db.query(`SELECT * FROM t WHERE id = ${id}`)", good: "db.query('SELECT * FROM t WHERE id = $1', [id])" }
        }
      },
      {
        id: "path-traversal",
        category: "security",
        mode: "audit",
        severity: "warning",
        pattern: "(readFile|readFileSync|createReadStream|sendFile)\\([^)]*req\\.(params|query|body)",
        message: "File path built from request input",
        why: "Resolve against an allow-listed base directory and reject '..' segments.",
        coach: { question: "Which files should a caller be able to reach through this endpoint \u2014 and which must they never reach?" }
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
        why: "Use the structured logger so output is levelled and redacted.",
        coach: { question: "Who will read this output in production, and how will they filter or redact it?" }
      },
      {
        id: "no-explicit-any",
        category: "quality",
        mode: "audit",
        severity: "warning",
        pattern: ":\\s*any\\b",
        paths: ["**/*.{ts,tsx}"],
        message: "Explicit `any` disables type checking",
        why: "Prefer a precise type or `unknown` with narrowing.",
        coach: {
          question: "What do you actually know about this value's shape here?",
          example: { bad: "function parse(x: any)", good: "function parse(x: unknown) { if (typeof x === 'string') \u2026 }" }
        }
      }
    ]
  },
  testing: {
    version: 4,
    rules: [
      {
        id: "focused-test",
        category: "testing",
        mode: "enforce",
        severity: "error",
        pattern: "\\b(it|test|describe)\\.only\\(|\\bf(it|describe)\\(",
        paths: ["**/*.{test,spec}.{ts,tsx,js,jsx}"],
        message: "Focused test (.only) silently disables the rest of the suite",
        why: "A focused test makes CI green while skipping everything else.",
        coach: { question: "Which other tests stop running while this one is focused?" }
      },
      {
        id: "skipped-test",
        category: "testing",
        mode: "audit",
        severity: "warning",
        pattern: "\\b(it|test|describe)\\.skip\\(|\\bx(it|describe)\\(",
        paths: ["**/*.{test,spec}.{ts,tsx,js,jsx}"],
        message: "Skipped test",
        why: "Skipped tests rot. Fix it, delete it, or track it with a ticket.",
        coach: {
          question: "What would have to be true for this test to run again \u2014 and who will make it true?",
          kata: `${SAMMAN}/string_calculator.html`,
          learningHour: "test-first-small-steps"
        }
      },
      {
        id: "change-size",
        category: "quality",
        mode: "audit",
        severity: "info",
        changeSize: { maxLines: 400, maxFiles: 12 },
        exclude: ["**/*.lock", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock", "**/*.snap", "**/generated/**", "**/dist/**"],
        why: "Small changes are easier to test, review and undo, and keep an AI assistant from drifting.",
        coach: {
          question: "What is the smallest step you could verify on its own?",
          reference: "https://martinfowler.com/articles/branching-patterns.html#healthy-branch",
          kata: `${SAMMAN}/string_calculator.html`,
          learningHour: "test-first-small-steps"
        },
        fix: "Split the change: one behaviour (with its test) per change, then the wiring, then the UI."
      }
    ]
  },
  hexagonal: {
    version: 4,
    rules: [
      {
        id: "domain-no-infra",
        category: "architecture",
        mode: "audit",
        severity: "warning",
        deny: "**/domain/** -> **/infra/**, **/infrastructure/**, **/adapters/**",
        why: "The domain must not depend on technical details; adapters depend on the domain through ports.",
        coach: {
          question: "Who should own this dependency \u2014 the domain, or an adapter behind a port?",
          example: { bad: "import { http } from '../infra/http'", good: "constructor(private readonly payments: PaymentPort) {}" },
          kata: `${SAMMAN}/birthday_greetings.html`,
          learningHour: "ports-and-adapters"
        },
        fix: "Declare a port (interface) in the domain, implement it in an adapter, and inject it."
      },
      {
        id: "domain-no-framework",
        category: "architecture",
        mode: "audit",
        severity: "warning",
        pattern: `from\\s+["'](express|fastify|@nestjs/[\\w-]+|pg|mysql2|mongoose|axios|typeorm|prisma)["']`,
        paths: ["**/domain/**"],
        message: "Framework or driver imported into the domain",
        why: "Framework code in the domain makes business rules hard to test and to move.",
        coach: {
          question: "Could you test this business rule without starting a server or a database?",
          kata: `${SAMMAN}/tire_pressure.html`,
          learningHour: "ports-and-adapters"
        }
      }
    ]
  },
  smells: {
    version: 4,
    rules: [
      {
        id: "long-function",
        category: "quality",
        mode: "audit",
        severity: "info",
        smell: { kind: "long-function", max: 40 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        exclude: ["**/*.test.*", "**/*.spec.*", "**/test/**"],
        why: "Long functions hide several responsibilities; each extra one is a reason to change and a place for bugs.",
        coach: {
          question: "How would you name the steps this code goes through \u2014 could each step stand on its own?",
          reference: "https://refactoring.guru/smells/long-method",
          kata: `${SAMMAN}/gilded_rose.html`,
          learningHour: "extract-function"
        },
        fix: "Extract the steps into well-named functions; keep this one as the readable summary."
      },
      {
        id: "deep-nesting",
        category: "quality",
        mode: "audit",
        severity: "info",
        smell: { kind: "deep-nesting", max: 3 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        why: "Every nested level is a condition the reader must hold in their head.",
        coach: {
          question: "Which condition could exit first, so the main path reads straight down?",
          reference: "https://refactoring.guru/replace-nested-conditional-with-guard-clauses",
          kata: `${SAMMAN}/gilded_rose.html`,
          learningHour: "guard-clauses"
        },
        fix: "Invert the outer conditions into guard clauses, or extract the inner block into a function."
      },
      {
        id: "too-many-params",
        category: "quality",
        mode: "audit",
        severity: "info",
        smell: { kind: "too-many-params", max: 4 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        why: "Many parameters usually mean a missing concept, and make call sites easy to get wrong.",
        coach: {
          question: "Which of these parameters always travel together \u2014 what would you call that thing?",
          reference: "https://refactoring.guru/smells/long-parameter-list",
          kata: `${SAMMAN}/theatrical_players.html`,
          learningHour: "naming-domain-concepts"
        },
        fix: "Introduce a parameter object (or value object) for the values that travel together."
      },
      {
        id: "large-file",
        category: "quality",
        mode: "audit",
        severity: "info",
        smell: { kind: "large-file", max: 400 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        exclude: ["**/*.test.*", "**/*.spec.*", "**/generated/**"],
        why: "Large files tend to collect unrelated responsibilities and attract merge conflicts.",
        coach: { question: "If you had to split this file in two, where would the seam be?", reference: "https://refactoring.guru/smells/large-class" }
      },
      {
        id: "duplicated-literal",
        category: "quality",
        mode: "audit",
        severity: "info",
        smell: { kind: "duplicated-literal", max: 3 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        exclude: ["**/*.test.*", "**/*.spec.*"],
        why: "The same text in several places drifts apart the day one copy changes.",
        coach: { question: "What does this value mean in the domain, and where should it live once?", reference: "https://refactoring.guru/replace-magic-number-with-symbolic-constant" }
      },
      {
        id: "complexity",
        category: "quality",
        mode: "audit",
        severity: "warning",
        smell: { kind: "complexity", max: 10 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        exclude: ["**/*.test.*", "**/*.spec.*", "**/test/**"],
        why: "Every decision path is a case to test and a place for a bug; past ten, nobody tests them all.",
        coach: {
          question: "Which decision is this code really making \u2014 could a lookup table or a small helper per case say it more simply?",
          reference: "https://refactoring.guru/replace-conditional-with-polymorphism",
          kata: `${SAMMAN}/gilded_rose.html`
        }
      },
      {
        id: "duplicate-block",
        category: "quality",
        mode: "audit",
        severity: "warning",
        smell: { kind: "duplicate-block", max: 3 },
        paths: ["**/*.{ts,tsx,js,jsx,java,kt,cs,go,py}"],
        exclude: ["**/*.test.*", "**/*.spec.*", "**/generated/**"],
        why: "Copy-pasted code, common in generated code: the next fix must be made in every copy, and one is always missed.",
        coach: { question: "What differs between these copies \u2014 could it be a parameter of one function?", reference: "https://refactoring.guru/smells/duplicate-code" }
      }
    ]
  },
  "clean-code": {
    version: 4,
    rules: [
      {
        id: "magic-number-money",
        category: "quality",
        mode: "audit",
        severity: "info",
        pattern: "\\*\\s*0?\\.\\d{2,}\\b",
        paths: ["**/*.{ts,tsx,js,jsx}"],
        exclude: ["**/*.test.*", "**/*.spec.*"],
        message: "Unnamed rate or ratio in arithmetic",
        why: "A named constant or domain concept says what the number means and where it may change.",
        coach: {
          question: "What is this number called in the business, and where else does it appear?",
          kata: `${SAMMAN}/supermarket_receipt.html`,
          learningHour: "naming-domain-concepts"
        }
      },
      {
        id: "todo-without-ticket",
        category: "quality",
        mode: "audit",
        severity: "info",
        pattern: "\\b(TODO|FIXME)\\b(?!.*[A-Z]+-\\d+)",
        message: "TODO without a ticket reference",
        why: "Untracked TODOs become permanent.",
        coach: { question: "Is this a decision for now, or a task someone needs to pick up \u2014 and where is it tracked?" }
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
var KINDS = ["deny", "pattern", "secrets", "dependencies", "requireTest", "smell", "changeSize"];
var SMELL_KINDS = ["long-function", "deep-nesting", "too-many-params", "large-file", "duplicated-literal", "complexity", "duplicate-block"];
function validatePolicy(p) {
  const issues = [];
  if (!SUPPORTED_VERSIONS.includes(p.version)) issues.push({ message: `unsupported version ${p.version} (expected ${SUPPORTED_VERSIONS.join(" or ")})` });
  if (p.mode && !["coach", "audit", "enforce"].includes(p.mode)) issues.push({ message: `invalid policy mode "${p.mode}" (coach | audit | enforce)` });
  if (p.navigator) {
    const n = p.navigator;
    if (n.maxQuestions !== void 0 && !(n.maxQuestions >= 0 && n.maxQuestions <= 3)) issues.push({ message: "navigator.maxQuestions must be between 0 and 3" });
    for (const q of n.questions ?? []) if (!["first-example", "placement", "risk"].includes(q)) issues.push({ message: `unknown navigator question "${q}"` });
    if (n.minScope && !["feature", "any"].includes(n.minScope)) issues.push({ message: `navigator.minScope must be feature or any` });
  }
  const seen = /* @__PURE__ */ new Set();
  for (const r of p.rules ?? []) {
    if (!r.id) issues.push({ message: "rule without id" });
    if (seen.has(r.id)) issues.push({ ruleId: r.id, message: "duplicate rule id" });
    seen.add(r.id);
    const kinds = KINDS.filter((k) => r[k] !== void 0 && r[k] !== false);
    if (kinds.length !== 1) issues.push({ ruleId: r.id, message: `expected exactly one of ${KINDS.join(", ")}; got ${kinds.join(", ") || "none"}` });
    if (r.risk && !["high", "medium", "low"].includes(r.risk)) issues.push({ ruleId: r.id, message: `invalid risk "${r.risk}" (high | medium | low)` });
    if (r.kind && !["Security", "Error prone", "Complexity", "Duplication", "Tests", "Architecture", "Dependencies", "Best practice"].includes(r.kind)) issues.push({ ruleId: r.id, message: `invalid kind "${r.kind}"` });
    if (r.mode && !["audit", "enforce", "off"].includes(r.mode)) issues.push({ ruleId: r.id, message: `invalid mode "${r.mode}"` });
    if (r.deny && !/\s->\s/.test(r.deny)) issues.push({ ruleId: r.id, message: 'deny must look like "from/** -> to/**"' });
    if (r.smell && !SMELL_KINDS.includes(r.smell.kind)) issues.push({ ruleId: r.id, message: `unknown smell "${r.smell.kind}" (${SMELL_KINDS.join(", ")})` });
    if (r.changeSize && !(Number(r.changeSize.maxLines ?? 1) >= 1 && Number(r.changeSize.maxFiles ?? 1) >= 1)) issues.push({ ruleId: r.id, message: "changeSize.maxLines and maxFiles must be \u2265 1" });
    if (r.smell?.max !== void 0 && !(Number(r.smell.max) >= 1)) issues.push({ ruleId: r.id, message: "smell.max must be \u2265 1" });
    if (r.coach?.question && containsCode(r.coach.question)) issues.push({ ruleId: r.id, message: "coach.question must not contain code \u2014 ask, don't answer" });
    if (r.coach?.escalateAfter !== void 0 && !(r.coach.escalateAfter >= 1)) issues.push({ ruleId: r.id, message: "coach.escalateAfter must be \u2265 1" });
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
    mode: o.mode,
    navigator: o.navigator ?? void 0,
    risk: toArr(o.risk),
    ...o.gate && typeof o.gate === "object" ? { gate: o.gate } : {},
    extends: ext === void 0 || ext === null ? [] : Array.isArray(ext) ? ext : [String(ext)],
    rules: (o.rules ?? []).map((r) => normalizeRule({ ...r, paths: toArr(r.paths), exclude: toArr(r.exclude), sources: toArr(r.sources) })),
    redact: o.redact ?? [],
    environments: o.environments ?? {}
  };
}
function normalizeRule(r) {
  const sev = r.severity;
  if (sev === "block") return { ...r, mode: r.mode ?? "enforce", severity: "error" };
  if (sev === "audit") return { ...r, mode: r.mode ?? "audit", severity: "warning" };
  return r;
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
    version: Math.max(child.version, parent.version),
    project: child.project ?? parent.project,
    mode: child.mode ?? parent.mode,
    navigator: child.navigator ?? parent.navigator,
    risk: [.../* @__PURE__ */ new Set([...parent.risk ?? [], ...child.risk ?? []])],
    rules: [...byId.values()],
    ...child.gate ?? parent.gate ? { gate: child.gate ?? parent.gate } : {},
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
  const merged = mergePolicies(acc, { ...p, extends: [] });
  return { ...merged, version: p.version };
}
function effectiveRules(p, environment = "local") {
  const ov = p.environments?.[environment]?.rules ?? {};
  const fallback = p.mode === "enforce" ? "enforce" : "audit";
  return p.rules.map((r) => ({ ...r, ...ov[r.id] ?? {}, mode: (ov[r.id]?.mode ?? r.mode) || fallback })).filter((r) => r.mode !== "off");
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

// src/detail.ts
function anyDetail(lineText, content) {
  const m = /(\w+)\s*\??:\s*any\b/.exec(lineText);
  const fnReturn = !m && /\)\s*:\s*any\b/.test(lineText);
  if (fnReturn) return { detail: "This function returns `any`: callers lose type checking", fix: "Return a named type, or `unknown` if callers must check it." };
  if (!m) return void 0;
  const name = m[1];
  const fields = content ? [...new Set([...content.matchAll(new RegExp(`\\b${name}\\??\\.(\\w+)`, "g"))].map((x) => x[1]))].filter((f) => !/^(length|map|forEach|filter|push|then)$/.test(f)).slice(0, 5) : [];
  if (!fields.length) return { detail: `\`${name}\` is \`any\`: nothing checks how it is used`, fix: `Type \`${name}\`, or use \`unknown\` and check it before use.` };
  const shape = `{ ${fields.map((f) => `${f}: \u2026`).join("; ")} }`;
  return { detail: `\`${name}\` is \`any\` but the code reads ${fields.map((f) => `.${f}`).join(", ")}`, fix: `Type it: \`${name}: ${shape}\`` };
}
function exportedFunctions(content) {
  const lines = content.split(/\r?\n/);
  const out = [];
  lines.forEach((l, i) => {
    const m = /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/.exec(l);
    if (!m) return;
    let depth = 0, started = false, branches = 0;
    for (let j = i; j < lines.length; j++) {
      const t = lines[j].replace(/(["'`]).*?\1/g, "");
      branches += (t.match(/\bif\s*\(|\bcase\b|\?[^.?:]|&&|\|\|/g) ?? []).length;
      for (const ch of t) {
        if (ch === "{") depth++, started = true;
        if (ch === "}") depth--;
      }
      if (started && depth <= 0) break;
    }
    out.push({ name: m[1] ?? m[2], branches });
  });
  return out;
}
function testDetail(fileName, content) {
  if (!content) return void 0;
  const fns = exportedFunctions(content);
  if (!fns.length) return void 0;
  const top = [...fns].sort((a, b) => b.branches - a.branches);
  const cases = (n) => n ? `${n + 1} cases` : "1 case";
  if (fns.length === 1) return `\`${fns[0].name}\` has ${cases(fns[0].branches)} and no test`;
  return `${fns.length} functions in ${fileName} and no test; start with \`${top[0].name}\` (${cases(top[0].branches)})`;
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

// src/smells.ts
var SMELL_DEFAULTS = {
  "long-function": 40,
  "deep-nesting": 3,
  "too-many-params": 4,
  "large-file": 400,
  "duplicated-literal": 3,
  complexity: 10,
  "duplicate-block": 3
};
var KEYWORDS = new Set("if else for while do switch case break continue return function const let var new typeof instanceof in of true false null undefined this async await try catch finally throw class extends import export default from yield void delete def elif and or not is None True False self pass lambda with as public private protected static final".split(" "));
function functionSpans(lines, isPython) {
  const out = [];
  if (isPython) {
    lines.forEach((l, i) => {
      const m = /^(\s*)(?:async\s+)?def\s+(\w+)/.exec(l);
      if (!m) return;
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        if (lines[j].length - lines[j].trimStart().length <= m[1].length) break;
        end = j;
      }
      out.push({ start: i, open: i, end, name: m[2] });
    });
    return out;
  }
  for (let i = 0; i < lines.length; i++) {
    if (!FN_START.some((rx) => rx.test(lines[i]))) continue;
    let open = -1;
    for (let j = i; j < Math.min(lines.length, i + 3); j++) if (lines[j].includes("{")) {
      open = j;
      break;
    }
    if (open < 0) continue;
    let depth = 0, end = -1;
    for (let j = open; j < lines.length && end < 0; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) continue;
    const name = /([\w$]+)\s*(?:=\s*(?:async\s*)?)?\(/.exec(lines[i])?.[1] ?? "function";
    out.push({ start: i, open, end, name });
  }
  return out;
}
function longFunctionAdvice(body, name) {
  const heads = /* @__PURE__ */ new Map();
  for (const l of body) {
    const m = /^\s*(?:await\s+)?([\w$]+(?:\.[\w$]+)*)\s*\(/.exec(l);
    if (m && !KEYWORDS.has(m[1])) heads.set(m[1], (heads.get(m[1]) ?? 0) + 1);
  }
  const top = [...heads].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 5) return `${name} calls ${top[0]}(\u2026) ${top[1]} times: group those calls into smaller functions (one per area), or drive them from a table.`;
  const blocks = body.join("\n").split(/\n\s*\n/).filter((b) => b.trim()).length;
  if (blocks >= 3) return `${name} has ${blocks} blocks separated by blank lines: give each block a name and extract it as its own function.`;
  return `Extract the steps of ${name} into well-named functions, and keep ${name} as their readable summary.`;
}
function complexityOf(body) {
  let score = 1;
  const vars = /* @__PURE__ */ new Map();
  for (const l of body) {
    const decisions = (l.match(/\b(if|elif|for|while|case|catch|except)\b|&&|\|\||\?(?![.?:])/g) ?? []).length;
    score += decisions;
    const m = /\b(if|elif|while|switch)\b\s*\((.*)\)/.exec(l) ?? /\b(if|elif|while)\b\s+(.*):\s*$/.exec(l);
    if (m) for (const w of m[2].match(/[A-Za-z_$][\w$]*(?:\.[\w$]+)*/g) ?? []) {
      const last = w.split(".").pop();
      if (!KEYWORDS.has(last) && last.length > 1) vars.set(last, (vars.get(last) ?? 0) + (m[1] === "switch" ? body.filter((x) => /\bcase\b/.test(x)).length : 1));
    }
  }
  return { score, drivers: [...vars].sort((a, b) => b[1] - a[1]).slice(0, 2).filter(([, n]) => n >= 2).map(([v]) => v) };
}
function blankCode(src) {
  const out = [];
  let inBlock = false;
  for (const raw of src.split(/\r?\n/)) {
    let line = "";
    let i = 0;
    let quote = null;
    while (i < raw.length) {
      const c2 = raw[i];
      const n = raw[i + 1];
      if (inBlock) {
        if (c2 === "*" && n === "/") {
          inBlock = false;
          line += "  ";
          i += 2;
        } else {
          line += " ";
          i++;
        }
        continue;
      }
      if (quote) {
        if (c2 === "\\") {
          line += "  ";
          i += 2;
          continue;
        }
        if (c2 === quote) quote = null;
        line += c2 === quote || quote === null ? c2 : " ";
        i++;
        continue;
      }
      if (c2 === "/" && n === "/") break;
      if (c2 === "#" && /^\s*$/.test(line)) break;
      if (c2 === "/" && n === "*") {
        inBlock = true;
        line += "  ";
        i += 2;
        continue;
      }
      if (c2 === '"' || c2 === "'" || c2 === "`") quote = c2;
      line += c2;
      i++;
    }
    out.push(line);
  }
  return out;
}
var FN_START = [
  /\bfunction\b[\s\w$]*\(([^)]*)\)/,
  // function foo(a, b)
  /(?:^|[=:,(]\s*)(?:async\s+)?\(([^)]*)\)\s*(?::\s*[^=]+)?=>/,
  // (a, b) => / const f = (a) =>
  /^\s*(?:(?:public|private|protected|static|final|async|override|abstract|synchronized|export|default|readonly)\s+)*[\w$<>[\],.?]+\s+[\w$]+\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\{?\s*$/,
  // Java/C#/TS method: Type name(a, b) {
  /^\s*(?:(?:public|private|protected|static|async|override|get|set)\s+)*(?!if\b|for\b|while\b|switch\b|catch\b|return\b)[\w$]+\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\{\s*$/,
  // TS/JS method: name(a, b) {
  /^\s*(?:async\s+)?def\s+\w+\s*\(([^)]*)\)/,
  // python
  /^\s*fun\s+[\w.<>]+\s*\(([^)]*)\)/,
  // kotlin
  /^\s*func\s+(?:\([^)]*\)\s*)?\w+\s*\(([^)]*)\)/
  // go
];
var CONTROL = /\b(if|else|for|foreach|while|do|switch|case|try|catch|finally|when|with)\b/;
function paramCount(list) {
  const cleaned = list.replace(/<[^<>]*>/g, "").replace(/\{[^{}]*\}/g, "x").replace(/\[[^[\]]*\]/g, "x").trim();
  if (!cleaned) return 0;
  return cleaned.split(",").filter((p) => p.trim() && !/^(self|cls|this)\b/.test(p.trim())).length;
}
function detectSmell(kind, content, max = SMELL_DEFAULTS[kind]) {
  const lines = blankCode(content);
  const isPython = /^\s*(?:async\s+)?def\s+\w+\s*\(/m.test(content) && !/[{}]/.test(lines.join(""));
  const hits = [];
  if (kind === "large-file") {
    const n = content.split(/\r?\n/).filter((l) => l.trim()).length;
    if (n > max) hits.push({ line: 1, message: `File has ${n} non-empty lines (more than ${max})` });
    return hits;
  }
  if (kind === "duplicated-literal") {
    const raw = content.split(/\r?\n/);
    const seen = /* @__PURE__ */ new Map();
    raw.forEach((l, i) => {
      if (/^\s*(import|export\s+.*from|from\s+\S+\s+import|package|#include|\/\/|\*|#)/.test(l)) return;
      for (const m of l.matchAll(/(["'])((?:(?!\1)[^\\]|\\.){8,})\1/g)) {
        const v = m[2];
        if (/^[\w./@-]+$/.test(v) && /[/.@]/.test(v) && !/\s/.test(v) && v.split("/").length > 2) continue;
        seen.set(v, [...seen.get(v) ?? [], i + 1]);
      }
    });
    for (const [v, at] of seen) if (at.length >= max) hits.push({ line: at[max - 1], message: `String "${v.length > 30 ? v.slice(0, 27) + "\u2026" : v}" repeated ${at.length} times` });
    return hits;
  }
  if (kind === "complexity") {
    for (const f of functionSpans(lines, isPython)) {
      const { score, drivers } = complexityOf(lines.slice(f.open + 1, f.end));
      if (score > max) {
        hits.push({
          line: f.start + 1,
          message: `Function ${f.name} has ${score} decision paths (more than ${max})`,
          advice: drivers.length ? `Most branches test ${drivers.map((d) => `\`${d}\``).join(" and ")}: a lookup table or one small function per case would replace them.` : `Return early for the simple cases, and extract each remaining branch into a named function.`
        });
      }
    }
    return hits;
  }
  if (kind === "duplicate-block") {
    const spans = functionSpans(lines, isPython);
    const fnAt = (i) => spans.filter((f) => i >= f.start && i <= f.end).sort((a, b) => b.start - a.start)[0]?.name;
    const norm = lines.map((l) => l.trim().replace(/(["'`])\s*\1/g, "S").replace(/\s+/g, " ").replace(/\b\d+(\.\d+)?\b/g, "N").replace(/[A-Za-z_$][\w$]*/g, (w) => KEYWORDS.has(w) ? w : "I"));
    const seen = /* @__PURE__ */ new Map();
    for (let i = 0; i + 6 <= norm.length; i++) {
      const win = norm.slice(i, i + 6);
      if (win.filter((x) => x.length > 3 && !/^[{}()\];,]*$/.test(x)).length < 5) continue;
      const k = win.join("\n");
      seen.set(k, [...seen.get(k) ?? [], i]);
    }
    const groups = [...seen.values()].filter((at) => at.length >= max).sort((a, b) => b.length - a.length);
    const reported = /* @__PURE__ */ new Set();
    for (const at of groups) {
      if (at.some((i) => reported.has(i))) continue;
      at.forEach((i) => {
        for (let d = -5; d <= 5; d++) reported.add(i + d);
      });
      const names = [...new Set(at.map(fnAt).filter(Boolean))];
      hits.push({
        line: at[1] + 1,
        message: `The same block appears ${at.length} times in this file`,
        advice: names.length > 1 ? `It is repeated in ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}: keep one function, and pass what differs as a parameter.` : `Keep one copy in a named function and call it from each place.`
      });
    }
    return hits;
  }
  if (kind === "too-many-params") {
    lines.forEach((l, i) => {
      for (const rx of FN_START) {
        const m = rx.exec(l);
        if (!m) continue;
        const n = paramCount(m[1] ?? "");
        const names = (m[1] ?? "").split(",").map((p) => p.trim().split(/[\s:=?]/)[0]).filter(Boolean);
        if (n > max) hits.push({ line: i + 1, message: `Function takes ${n} parameters (more than ${max})`, advice: `Parameters ${names.join(", ")}: group the ones that always travel together into one object with a name.` });
        break;
      }
    });
    return hits;
  }
  if (kind === "long-function") {
    if (isPython) {
      lines.forEach((l, i) => {
        const m = /^(\s*)(?:async\s+)?def\s+(\w+)/.exec(l);
        if (!m) return;
        const indent = m[1].length;
        let end = i;
        for (let j = i + 1; j < lines.length; j++) {
          if (!lines[j].trim()) continue;
          if (lines[j].length - lines[j].trimStart().length <= indent) break;
          end = j;
        }
        const len = lines.slice(i + 1, end + 1).filter((x) => x.trim()).length;
        if (len > max) hits.push({ line: i + 1, message: `Function ${m[2]} is ${len} lines long (more than ${max})`, advice: longFunctionAdvice(lines.slice(i + 1, end + 1), m[2]) });
      });
      return hits;
    }
    for (let i = 0; i < lines.length; i++) {
      if (!FN_START.some((rx) => rx.test(lines[i]))) continue;
      let open = -1;
      for (let j = i; j < Math.min(lines.length, i + 3); j++) if (lines[j].includes("{")) {
        open = j;
        break;
      }
      if (open < 0) continue;
      let depth = 0;
      let end = -1;
      for (let j = open; j < lines.length && end < 0; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") depth++;
          else if (ch === "}" && --depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end < 0) continue;
      const body = lines.slice(open + 1, end).filter((x) => x.trim()).length;
      if (body > max) {
        const name = /([\w$]+)\s*(?:=\s*(?:async\s*)?)?\(/.exec(lines[i])?.[1] ?? "function";
        hits.push({ line: i + 1, message: `Function ${name} is ${body} lines long (more than ${max})`, advice: longFunctionAdvice(lines.slice(open + 1, end), name) });
        i = open;
      }
    }
    return hits;
  }
  if (isPython) {
    const stack2 = [];
    lines.forEach((l, i) => {
      if (!l.trim()) return;
      const indent = l.length - l.trimStart().length;
      while (stack2.length && indent <= stack2[stack2.length - 1]) stack2.pop();
      if (/^\s*(if|elif|else|for|while|try|except|finally|with)\b.*:\s*$/.test(l)) {
        stack2.push(indent);
        if (stack2.length === max + 1) hits.push({ line: i + 1, message: `Control flow nested ${stack2.length} levels deep (more than ${max})` });
      }
    });
    return hits;
  }
  const stack = [];
  let pendingControl = false;
  lines.forEach((l, i) => {
    const control = CONTROL.test(l) || pendingControl;
    pendingControl = control && !l.includes("{") && /\)\s*$|\belse\s*$|\btry\s*$|\bdo\s*$/.test(l);
    let reported = false;
    for (const ch of l) {
      if (ch === "{") {
        stack.push(control);
        const depth = stack.filter(Boolean).length;
        if (control && depth === max + 1 && !reported) {
          hits.push({ line: i + 1, message: `Control flow nested ${depth} levels deep (more than ${max})` });
          reported = true;
        }
      } else if (ch === "}") stack.pop();
    }
  });
  return hits;
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
    if (rule.changeSize) {
      findings.push(...checkChangeSize(rule, files));
      continue;
    }
    for (const file of files) {
      if (!inScope(file.path, rule.paths, rule.exclude)) continue;
      let found = [];
      if (rule.deny) found = checkBoundary(rule, file);
      else if (rule.pattern) found = checkPattern(rule, file);
      else if (rule.secrets) found = checkSecrets(rule, file, policy);
      else if (rule.dependencies) found = checkDependencies(rule, file);
      else if (rule.smell) found = checkSmell(rule, file);
      findings.push(...found.filter((f) => !isSuppressed(file, f)));
    }
  }
  findings.sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.file.localeCompare(b.file) || a.line - b.line);
  const byCategory = {};
  for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  const blocking = findings.filter((f) => f.blocking).length;
  return {
    environment,
    policyMode: policy.mode ?? (policy.version >= 4 ? "coach" : "audit"),
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
    sources: rule.sources,
    ...rule.coach ? { coach: rule.coach } : {},
    ...classify(rule, rule.category ?? cat, rule.severity ?? sev, mode === "enforce"),
    ...typeof rule.fix === "string" ? { fixText: rule.fix } : {}
  };
}
function classify(rule, category, severity, blocking) {
  const smell = rule.smell?.kind;
  let kind, risk;
  if (category === "security") [kind, risk] = ["Security", "high"];
  else if (category === "architecture") [kind, risk] = ["Architecture", "medium"];
  else if (category === "dependency") [kind, risk] = ["Dependencies", "medium"];
  else if (rule.id === "focused-test") [kind, risk] = ["Error prone", "high"];
  else if (rule.changeSize) [kind, risk] = ["Change size", "low"];
  else if (category === "testing") [kind, risk] = ["Tests", rule.id === "skipped-test" ? "low" : "medium"];
  else if (smell === "duplicate-block" || smell === "duplicated-literal") [kind, risk] = ["Duplication", smell === "duplicate-block" ? "medium" : "low"];
  else if (smell) [kind, risk] = ["Complexity", smell === "complexity" ? "medium" : "low"];
  else [kind, risk] = ["Best practice", severity === "error" ? "medium" : "low"];
  if (blocking || severity === "error") risk = "high";
  return { risk: rule.risk ?? risk, kind: rule.kind ?? kind };
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
    if (/\bany\b/.test(rule.pattern)) {
      const d = anyDetail(text, file.content ?? file.addedLines.map((l) => l.text).join("\n"));
      if (d) Object.assign(f, { detail: d.detail }, d.fix && !f.fixText ? { fixText: d.fix } : {});
    }
    if (rule.fix && typeof rule.fix === "object") {
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
function checkSmell(rule, file) {
  if (!file.content) return [];
  const added = new Set(file.addedLines.map((l) => l.line));
  const whole = file.status === "added" || added.size >= file.content.split(/\r?\n/).length;
  return detectSmell(rule.smell.kind, file.content, rule.smell.max).filter((h) => whole || added.has(h.line)).map((h) => ({ ...base(rule, file.path, h.line, h.message, "quality", "info"), ...h.advice ? { fixText: h.advice } : {} }));
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
      const f = base(rule, file.path, file.addedLines[0]?.line ?? 1, `No test changed for ${basename(file.path)} (for example ${concreteTestPath(expected, file.path)})`, "testing", "warning");
      const d = testDetail(basename(file.path), file.content ?? file.addedLines.map((l) => l.text).join("\n"));
      if (d) f.detail = `${d}: ${concreteTestPath(expected, file.path)}`;
      out.push(f);
    }
  }
  return out;
}
function changeSizeOf(rule, files) {
  const own = files.filter((f) => inScope(normalizePath(f.path), rule.paths, rule.exclude));
  return { lines: own.reduce((n, f) => n + f.addedLines.length, 0), files: own.length };
}
function checkChangeSize(rule, files) {
  const { maxLines, maxFiles } = rule.changeSize;
  const size = changeSizeOf(rule, files);
  const over = [];
  if (maxLines && size.lines > maxLines) over.push(`${size.lines} lines (budget ${maxLines})`);
  if (maxFiles && size.files > maxFiles) over.push(`${size.files} files (budget ${maxFiles})`);
  if (!over.length) return [];
  const first = files.find((f) => inScope(normalizePath(f.path), rule.paths, rule.exclude));
  return [base(rule, first.path, first.addedLines[0]?.line ?? 1, `This change is ${over.join(" and ")}: too big to verify in one step`, "quality", "info")];
}
function concreteTestPath(expected, file) {
  const i = expected.indexOf("**");
  if (i < 0) return expected;
  const prefix = expected.slice(0, i);
  const dirSegs = dirname(file).split("/");
  const preSegs = prefix.split("/").filter(Boolean);
  let at = -1;
  for (let k = preSegs.length - 1; k >= 0 && at < 0; k--) at = dirSegs.lastIndexOf(preSegs[k]);
  const rest = (at >= 0 ? dirSegs.slice(at + 1) : dirSegs.slice(1)).join("/");
  return (prefix + rest + "/" + expected.slice(i + 2).replace(/^\/+/, "")).replace(/\/+/g, "/");
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
function testOrderFindings(policy, commits, environment = "ci") {
  const first = /* @__PURE__ */ new Map();
  commits.forEach((c2, i) => c2.files.map(normalizePath).forEach((p) => first.has(p) || first.set(p, i)));
  const paths = [...first.keys()];
  const out = [];
  for (const rule of effectiveRules(policy, environment).filter((r) => r.requireTest)) {
    for (const p of paths) {
      if (/\.(test|spec)\.[jt]sx?$/.test(p) || p.includes("/__tests__/") || !inScope(p, rule.paths, rule.exclude)) continue;
      const expected = rule.requireTest.test.replace(/\{dir\}/g, dirname(p)).replace(/\{name\}/g, basename(p).replace(/\.[^.]+$/, ""));
      const testPath = paths.find((t) => matchGlob(t, expected));
      if (!testPath) continue;
      const code = first.get(p);
      const tst = first.get(testPath);
      if (code >= tst) continue;
      const question = `Was the test for ${basename(p)} written after the code? It came in ${commits[tst].sha.slice(0, 7)}, the code in ${commits[code].sha.slice(0, 7)}. Next time, which example could you write as a failing test first?`;
      out.push({
        ...base(rule, p, 1, question, "testing", "info"),
        message: question,
        mode: "audit",
        blocking: false,
        coach: { ...rule.coach ?? {}, question: rule.coach?.question ?? "Which example would you write as a failing test before the code?" }
      });
    }
  }
  return out;
}
function changedLineSet(head, current) {
  if (head === void 0) return null;
  const before = /* @__PURE__ */ new Map();
  for (const l of head.split(/\r?\n/)) before.set(l, (before.get(l) ?? 0) + 1);
  const out = /* @__PURE__ */ new Set();
  current.split(/\r?\n/).forEach((l, i) => {
    const n = before.get(l) ?? 0;
    if (n > 0) before.set(l, n - 1);
    else out.add(i + 1);
  });
  return out;
}
function onChangedLines(findings, policy, file, changed) {
  if (!changed) return findings.filter((f) => f.file === file);
  const fileLevel = new Set(policy.rules.filter((r) => r.requireTest || r.changeSize).map((r) => r.id));
  return findings.filter((f) => f.file === file && (changed.has(f.line) || fileLevel.has(f.ruleId) && changed.size > 0));
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
var coaching = (r) => r.policyMode === "coach";
function formatFinding(f, opts = {}) {
  const showMe = opts.showMe ?? !f.coach;
  const explain = opts.explain ?? true;
  const card = hintCard(f);
  const tag = f.blocking ? red("BLOCK") : f.coach ? cyan("COACH") : yellow("AUDIT");
  const lines = [`${tag} ${bold(`${f.file}:${f.line}${f.column ? ":" + f.column : ""}`)}  ${f.message}  ${dim(`[${f.ruleId}]`)}`];
  if (card.question) lines.push(`      ${cyan("?")} ${card.question}`);
  if (explain) {
    if (f.why) lines.push(`      ${dim("why:")} ${f.why}`);
    if (card.reference) lines.push(`      ${dim("explain:")} ${card.reference}`);
    if (card.example?.bad) lines.push(`      ${dim("instead of:")} ${card.example.bad}`);
    if (card.example?.good) lines.push(`      ${dim("prefer:")}     ${card.example.good}`);
  }
  if (showMe) {
    if (f.suggestion) {
      lines.push(`      ${red("- " + f.suggestion.original.trim())}`);
      lines.push(`      ${green("+ " + f.suggestion.replacement.trim())}`);
    } else if (f.fixText) lines.push(`      ${dim("fix:")} ${f.fixText}`);
  } else if (card.fix) lines.push(`      ${dim("show me: copal check --show-me")}`);
  if (card.kata) lines.push(`      ${dim("practice:")} ${card.kata}`);
  if (f.sources?.length) lines.push(`      ${dim("sources: " + f.sources.join(" \xB7 "))}`);
  return lines.join("\n");
}
function formatReport(r, opts = {}) {
  if (!r.findings.length) return green(`\u2714 Copal: ${r.filesChecked} file(s), ${r.rulesEvaluated} rule(s), no findings (${r.environment}).`);
  const head = r.blocking ? red(bold(`\u2716 Copal: ${r.summary.blocking} blocking finding(s)`)) + `, ${r.summary.audit} audit-only` : coaching(r) ? cyan(bold(`\u25C7 Copal: ${r.summary.audit} hint(s) to think about`)) + " (nothing blocking)" : yellow(bold(`\u26A0 Copal: ${r.summary.audit} audit finding(s)`)) + " (nothing blocking)";
  const fopts = { ...opts, showMe: opts.showMe ?? (coaching(r) ? false : void 0) };
  return [head + dim(` \u2014 env ${r.environment}, ${r.filesChecked} file(s), ${r.rulesEvaluated} rule(s)`), "", ...r.findings.map((f) => formatFinding(f, fopts))].join("\n");
}
function groupFindings(findings) {
  const groups = /* @__PURE__ */ new Map();
  for (const f of findings) {
    const k = `${f.ruleId}\0${f.file}\0${f.blocking}`;
    (groups.get(k) ?? groups.set(k, []).get(k)).push(f);
  }
  return [...groups.values()];
}
function reportToMarkdown(r, title = "Copal check") {
  const order = { high: 0, medium: 1, low: 2 };
  const rank = (f) => f.blocking ? -1 : order[f.risk ?? "low"] ?? 3;
  const byRule = /* @__PURE__ */ new Map();
  for (const f of r.findings) (byRule.get(f.ruleId) ?? byRule.set(f.ruleId, []).get(f.ruleId)).push(f);
  const groups = [...byRule.values()].map((g) => g.sort((a, b) => rank(a) - rank(b))).sort((a, b) => rank(a[0]) - rank(b[0]) || b.length - a.length);
  const status = r.blocking ? "\u{1F534} **Changes requested**" : r.findings.length ? `\u{1F7E1} **${groups.length} thing${groups.length > 1 ? "s" : ""} to look at**` : "\u{1F7E2} **Passed**";
  const out = [`### ${title}`, "", `${status}${r.blocking ? ` \u2014 ${r.summary.blocking} blocking` : ""}`, ""];
  const TOP = 5;
  groups.slice(0, TOP).forEach((g, i) => {
    const f = g[0];
    const risk = f.blocking ? "\u26D4 Blocking" : f.risk === "high" ? "\u{1F534} High" : f.risk === "medium" ? "\u{1F7E0} Medium" : "\u26AA Low";
    const files = [...new Set(g.map((x) => x.file))];
    const where = `\`${f.file}:${f.line}\`${files.length > 1 ? ` and ${files.length - 1} other file${files.length > 2 ? "s" : ""}` : ""}${g.length > 1 ? ` \xB7 ${g.length}\xD7` : ""}`;
    out.push(`${i + 1}. ${risk}${f.kind ? ` \xB7 ${f.kind}` : ""} \u2014 **${f.message}**`, `   ${where}`);
    if (f.fixText && (f.kind === "Complexity" || f.kind === "Duplication")) out.push(`   Suggestion: ${f.fixText}`);
    else if (hintCard(f).question) out.push(`   _${hintCard(f).question}_`);
    else if (g.length === 1 && f.detail) out.push(`   ${f.detail}`);
  });
  if (groups.length > TOP) out.push("", `<sub>+${groups.length - TOP} lower-risk rule${groups.length - TOP > 1 ? "s" : ""} (${groups.slice(TOP).reduce((n, g) => n + g.length, 0)} findings) in the inline comments.</sub>`);
  out.push("", "<sub>Not relevant? Reply `/copal false-positive <rule-id>`.</sub>");
  return out.join("\n");
}
function findingToMarkdown(f, opts = {}) {
  const card = hintCard(f);
  const risk = f.blocking ? "\u26D4 Blocking" : f.risk ? `${f.risk[0].toUpperCase()}${f.risk.slice(1)} risk` : "";
  const out = [`**${card.question ?? card.signal}**`, "", card.question ? `${card.signal}${f.why ? ` \xB7 _${f.why}_` : ""}` : f.why ? `_${f.why}_` : ""];
  if (f.suggestion && !f.coach) out.push("", "```suggestion", f.suggestion.replacement, "```");
  else if (card.fix) out.push("", `<details><summary>Show me</summary>

\`\`\`
${card.fix}
\`\`\`

</details>`);
  const ref = card.reference ? ` \xB7 ${referenceLink(card.reference, opts.referenceBase)}` : "";
  const kata = card.kata ? ` \xB7 [practice](${card.kata})` : "";
  out.push("", `<sub>${[risk, f.kind, `Copal \xB7 \`${f.ruleId}\``].filter(Boolean).join(" \xB7 ")}${ref}${kata}</sub>`);
  return out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
function referenceLink(ref, base2) {
  if (/^https?:\/\//.test(ref)) return `[${ref.replace(/^https?:\/\//, "")}](${ref})`;
  if (!base2) return `\`${ref}\``;
  return `[${ref}](${base2.replace(/\/?$/, "/")}${ref.replace(/^\.?\//, "").split("/").map(encodeURIComponent).join("/")})`;
}
function rulesToGuidance(rules, filePath) {
  if (!rules.length) return `No Copal rules apply${filePath ? ` to ${filePath}` : ""}.`;
  const out = [`Copal engineering policy${filePath ? ` for ${filePath}` : ""} \u2014 follow these rules when writing code:`, ""];
  for (const r of rules) {
    const what = r.deny ? `Do not import across: ${r.deny}` : r.dependencies ? `Dependencies \u2014 allowed: ${r.dependencies.allow?.join(", ") || "any"}; denied: ${r.dependencies.deny?.join(", ") || "none"}` : r.secrets ? "Never hard-code credentials; read them from configuration/secret manager." : r.requireTest ? `Add/update a test matching ${r.requireTest.test}` : r.changeSize ? `Keep each change small: under ${r.changeSize.maxLines ?? "any number of"} lines and ${r.changeSize.maxFiles ?? "any number of"} files \u2014 split larger work into verified steps` : r.smell ? `Avoid ${r.smell.kind.replace(/-/g, " ")}${r.smell.max ? ` (max ${r.smell.max})` : ""}` : r.message ?? `Avoid pattern /${r.pattern}/`;
    const fix = typeof r.fix === "string" ? r.fix : r.fix?.with;
    out.push(`- [${r.mode === "enforce" ? "ENFORCED" : "audit"}] ${r.id}: ${what}${r.why ? ` \u2014 ${r.why}` : ""}${fix ? ` (preferred: ${fix})` : ""}`);
    if (r.coach?.question) out.push(`  Ask the developer before writing this kind of code: "${r.coach.question}"`);
  }
  return out.join("\n");
}

// src/baseline.ts
var BASELINE_FILE = ".copal/baseline.json";
function baselineKey(f, lineText) {
  return `${f.ruleId}|${f.file}|${lineText.trim().replace(/\s+/g, " ")}`;
}
function createBaseline(findings, lineText, now = /* @__PURE__ */ new Date()) {
  return { version: 1, createdAt: now.toISOString().slice(0, 10), entries: [...new Set(findings.map((f) => baselineKey(f, lineText(f))))].sort() };
}
function parseBaseline(text) {
  if (!text) return void 0;
  try {
    const b = JSON.parse(text);
    return Array.isArray(b.entries) ? b : void 0;
  } catch {
    return void 0;
  }
}
function withoutBaseline(findings, baseline, lineText) {
  if (!baseline) return findings;
  const known = new Set(baseline.entries);
  return findings.filter((f) => !known.has(baselineKey(f, lineText(f))));
}
function lineTextFrom(files) {
  const cache2 = /* @__PURE__ */ new Map();
  return (f) => {
    const file = files.find((x) => x.path === f.file);
    if (!file) return "";
    if (!cache2.has(f.file)) cache2.set(f.file, file.content ? file.content.split(/\r?\n/) : null);
    const lines = cache2.get(f.file);
    return (lines ? lines[f.line - 1] : file.addedLines.find((l) => l.line === f.line)?.text) ?? "";
  };
}
function evaluateGate(findings, gate) {
  if (!gate) return void 0;
  const reasons = [];
  const count = (risk) => findings.filter((f) => !f.blocking && f.risk === risk).length;
  const blocking = findings.filter((f) => f.blocking).length;
  if (blocking) reasons.push(`${blocking} finding${blocking > 1 ? "s" : ""} the team set to block`);
  for (const risk of ["high", "medium", "low"]) {
    const max = gate.maxNew?.[risk];
    const n = count(risk);
    if (max !== void 0 && n > max) reasons.push(`${n} new ${risk}-risk issue${n > 1 ? "s" : ""} (max ${max})`);
  }
  if (gate.requireTests && findings.some((f) => f.kind === "Tests" && /No test/.test(f.message))) reasons.push("code changed without a test");
  return { passed: reasons.length === 0, reasons };
}
function gateLine(g) {
  if (!g) return void 0;
  return g.passed ? "\u2705 **Gate passed**" : `\u274C **Gate failed:** ${g.reasons.join(" \xB7 ")}`;
}

// src/analytics.ts
var LATE_SOURCES = ["pr", "ci"];
function ruleHealth(input) {
  const { policy, project } = input;
  const days = input.days ?? 30;
  const now = input.now ?? Date.now();
  const from = now - days * 864e5;
  const mid = now - days / 2 * 864e5;
  const mine = input.analyses.filter((a) => !project || a.project === project);
  const rows = /* @__PURE__ */ new Map();
  const row = (id) => rows.get(id) ?? rows.set(id, { hits: 0, recent: 0, earlier: 0, late: 0, fp: 0 }).get(id);
  for (const a of mine) {
    const t = Date.parse(a.createdAt);
    if (t < from) continue;
    for (const f of a.findings) {
      const r = row(f.ruleId);
      r.hits++;
      t >= mid ? r.recent++ : r.earlier++;
      if (LATE_SOURCES.includes(a.source)) r.late++;
      if (!r.lastSeen || a.createdAt > r.lastSeen) r.lastSeen = a.createdAt;
    }
    for (const fb of a.feedback ?? []) if (fb.verdict === "false-positive") row(fb.ruleId).fp++;
  }
  for (const e of input.events ?? []) if (e.action === "false_positive" && (!project || e.project === project) && Date.parse(e.at) >= from) row(e.ruleId).fp++;
  const since90 = now - 90 * 864e5;
  const seen90 = new Set(mine.filter((a) => Date.parse(a.createdAt) >= since90).flatMap((a) => a.findings.map((f) => f.ruleId)));
  const out = (policy?.rules ?? []).map((rule) => {
    const r = rows.get(rule.id) ?? { hits: 0, recent: 0, earlier: 0, late: 0, fp: 0 };
    const caughtLate = r.hits ? r.late / r.hits : null;
    const falsePositiveRate = r.hits ? Math.min(1, r.fp / r.hits) : null;
    const trend2 = r.recent > r.earlier ? "up" : r.recent < r.earlier ? "down" : "flat";
    const status = [];
    if ((falsePositiveRate ?? 0) >= 0.2 && r.hits >= 3) status.push("noisy");
    if (r.hits >= 3 && trend2 !== "down") status.push("recurring");
    if ((caughtLate ?? 0) >= 0.5 && r.hits >= 2) status.push("caught-late");
    if (!seen90.has(rule.id)) status.push("silent");
    if (!rule.coach?.question) status.push("uncoached");
    return { ruleId: rule.id, mode: rule.mode ?? "audit", hits: r.hits, trend: trend2, caughtLate, falsePositiveRate, lastSeen: r.lastSeen ?? null, status, kata: rule.coach?.kata ?? null };
  });
  return { project: project ?? null, days, rules: out.sort((a, b) => b.status.length - a.status.length || b.hits - a.hits) };
}
function reach(input) {
  var _a;
  const { project } = input;
  const last = (src) => input.analyses.filter((a) => (!project || a.project === project) && src.includes(a.source)).map((a) => a.createdAt).sort().pop() ?? null;
  const agents = {};
  for (const s of (input.sessions ?? []).filter((x) => !project || x.project === project)) {
    const a = agents[_a = s.agent] ?? (agents[_a] = { sessions: 0, lastSeen: s.at });
    a.sessions++;
    if (s.at > a.lastSeen) a.lastSeen = s.at;
  }
  const nav = (input.navigator ?? []).filter((n) => !project || n.project === project);
  return {
    project: project ?? null,
    precommit: { lastSeen: last(["precommit"]) },
    prCheck: { lastSeen: last(LATE_SOURCES) },
    agentSelfCheck: { lastSeen: last(["mcp"]) },
    ide: { heartbeats: input.heartbeats ?? 0 },
    agents,
    navigator: { sessions: nav.length, answered: nav.filter((n) => n.answeredAt && !n.skipped).length, skipped: nav.filter((n) => n.skipped).length }
  };
}

// src/ladder.ts
var TRACKS = {
  "new-products": { name: "New products", summary: "Build with AI from day one, without losing structure.", emphasis: ["examples", "steps", "scope"] },
  legacy: { name: "Legacy code", summary: "Change existing systems safely: pin down behaviour first, then change in small steps.", emphasis: ["examples", "scope", "steps"] },
  agents: { name: "AI agents", summary: "Keep agents inside a clear brief, one slice of the system, and reviewed steps.", emphasis: ["scope", "steps", "examples"] }
};
var PRACTICES = [
  {
    id: "examples-1",
    where: "learning hour",
    discipline: "examples",
    rung: 1,
    minutes: 45,
    title: "Test first on a small kata",
    goal: "Feel the loop: example, failing test, code, green.",
    steps: ["Pick the first requirement of the kata.", "Write it as a failing test.", "Make it pass with the simplest code.", "Repeat for the next requirement, without the AI."],
    doneWhen: "Every requirement has a test written before its code.",
    kata: { name: "String Calculator", url: "https://sammancoaching.org/kata_descriptions/string_calculator.html", credit: "Roy Osherove \xB7 Samman Coaching" }
  },
  {
    id: "examples-2",
    where: "your code",
    discipline: "examples",
    rung: 2,
    minutes: 60,
    title: "Tests first, AI implements",
    goal: "Use examples as the AI's specification.",
    steps: ["Take your next real task.", "Write the examples for its business rule as tests.", "Ask your AI assistant to make them pass, and nothing else.", "Reject any code no test asked for."],
    doneWhen: "A real change lands where the AI's code passes your tests and adds no untested behaviour."
  },
  {
    id: "examples-3",
    where: "your code",
    discipline: "examples",
    rung: 3,
    minutes: 90,
    title: "Pin down legacy behaviour",
    goal: "Write characterisation tests before letting AI change old code.",
    steps: ["Choose a module your team is afraid to touch.", "Record what it does today as tests, including odd cases.", "Only then ask the AI for the change.", "Keep the tests in the change."],
    doneWhen: "A real change to legacy code lands with the tests that protected it.",
    kata: { name: "Gilded Rose", url: "https://github.com/emilybache/GildedRose-Refactoring-Kata", credit: "Emily Bache" }
  },
  {
    id: "scope-2",
    where: "your code",
    discipline: "scope",
    rung: 2,
    minutes: 30,
    title: "One-line brief",
    goal: "Agree the scope before the first prompt.",
    steps: ["Before your next task, write: goal, in scope, out of scope.", "Give the brief to the AI with the task.", "Run Copal's scope check before review."],
    doneWhen: "Three changes in a row with no out-of-scope question."
  },
  {
    id: "scope-1",
    where: "learning hour",
    discipline: "scope",
    rung: 1,
    minutes: 60,
    title: "Give the AI only one slice",
    goal: "Limit the context to the part of the code the change belongs to.",
    steps: ["Pick one change in the kata.", "Give the AI only the code that change belongs to, and its tests.", "If it asks for more, stop and discuss whether that is a separate change."],
    doneWhen: "The change touches one part of the code and its tests.",
    kata: { name: "Theatrical Players", url: "https://github.com/emilybache/Theatrical-Players-Refactoring-Kata", credit: "Emily Bache" }
  },
  {
    id: "scope-3",
    where: "your code",
    discipline: "scope",
    rung: 3,
    minutes: 90,
    title: "Draw a boundary as a team rule",
    goal: "Turn an architecture decision into a rule Copal checks.",
    steps: ["Pick one dependency that should never happen (for example, UI to database).", "Write it as a deny rule in .copalrules, with the question to ask.", "Fix or justify the existing violations."],
    doneWhen: "The rule runs on every change and the team agrees with its question."
  },
  {
    id: "steps-2",
    where: "your code",
    discipline: "steps",
    rung: 2,
    minutes: 45,
    title: "Split a change in three",
    goal: "See that a feature can land as several small, safe changes.",
    steps: ["Take your next feature.", "Plan it as: rule and its test, then the wiring, then the screen.", "Submit each part as its own change."],
    doneWhen: "Each part is under 400 lines and was reviewed on its own."
  },
  {
    id: "steps-1",
    where: "learning hour",
    discipline: "steps",
    rung: 1,
    minutes: 60,
    title: "Commit on every green",
    goal: "Work in steps small enough to undo without thinking.",
    steps: ["Run the tests after each small edit, by you or the AI.", "Commit every time they pass.", "Revert instead of debugging when a step goes red."],
    doneWhen: "A session with a commit every few minutes and no long red phase.",
    kata: { name: "Gilded Rose", url: "https://github.com/emilybache/GildedRose-Refactoring-Kata", credit: "Emily Bache" }
  },
  {
    id: "steps-3",
    where: "your code",
    discipline: "steps",
    rung: 3,
    minutes: 90,
    title: "Ship behind a flag",
    goal: "Merge unfinished work safely instead of growing a big branch.",
    steps: ["Put the new behaviour behind a flag that is off.", "Merge small steps daily.", "Turn it on when the last step is verified."],
    doneWhen: "A feature reached production as several merged steps."
  }
];
var VARIANTS = [
  {
    id: "legacy-examples-2",
    tracks: ["legacy"],
    where: "your code",
    discipline: "examples",
    rung: 2,
    minutes: 60,
    title: "Pin down behaviour before any change",
    goal: "Never let the AI change old code that no test describes.",
    steps: ["Before your next change to old code, write tests for what it does today.", "Include the odd cases you find, even if they look wrong.", "Only then ask the AI for the change, and keep the tests."],
    doneWhen: "A real change to old code lands with the tests that protected it."
  },
  {
    id: "legacy-steps-2",
    tracks: ["legacy"],
    where: "your code",
    discipline: "steps",
    rung: 2,
    minutes: 60,
    title: "Refactor in tiny steps",
    goal: "Change old code one safe move at a time.",
    steps: ["With the tests green, make one small refactoring (rename, extract, move).", "Run the tests and commit.", "Ask the AI for one move at a time, never a rewrite."],
    doneWhen: "A messy function was improved through several green commits.",
    kata: { name: "Gilded Rose", url: "https://github.com/emilybache/GildedRose-Refactoring-Kata", credit: "Emily Bache" }
  },
  {
    id: "agents-scope-2",
    tracks: ["agents"],
    where: "your code",
    discipline: "scope",
    rung: 2,
    minutes: 30,
    title: "Brief every agent task",
    goal: "An agent gets a goal, a scope and a definition of done before it starts.",
    steps: ["Write the brief: goal, in scope, out of scope, done when.", "Ask the agent for a plan and review it before any code.", "Run Copal's scope check on the result."],
    doneWhen: "Three agent tasks in a row stayed inside their brief."
  },
  {
    id: "agents-steps-2",
    tracks: ["agents"],
    where: "your code",
    discipline: "steps",
    rung: 2,
    minutes: 45,
    title: "Agents work in reviewed steps",
    goal: "Stop the agent after each verified step instead of reviewing one big result.",
    steps: ["Ask the agent to stop when one test passes.", "Read that diff and commit it.", "Only then let it continue with the next step."],
    doneWhen: "An agent task landed as several small, reviewed commits."
  },
  {
    id: "agents-examples-2",
    tracks: ["agents"],
    where: "your code",
    discipline: "examples",
    rung: 2,
    minutes: 45,
    title: "Tests are the agent's contract",
    goal: "The agent implements your examples and may not change them.",
    steps: ["Write the tests yourself first.", "Tell the agent it must not edit test files.", "Reject any change that touches them."],
    doneWhen: "An agent change passed tests it did not write or modify."
  }
];
var ORDER = ["examples", "scope", "steps"];
var LADDER = [...PRACTICES].sort((a, b) => ORDER.indexOf(a.discipline) - ORDER.indexOf(b.discipline) || a.rung - b.rung);
function practice(id) {
  return LADDER.find((p) => p.id === id) ?? VARIANTS.find((p) => p.id === id);
}
function practiceAt(discipline, rung, track) {
  return track && VARIANTS.find((p) => p.discipline === discipline && p.rung === rung && p.tracks.includes(track)) || LADDER.find((p) => p.discipline === discipline && p.rung === rung);
}
function ladderFor(track) {
  return LADDER.map((p) => practiceAt(p.discipline, p.rung, track));
}
function startingPractice(discipline, status, track) {
  const rung = status === "strong" ? 3 : status === "fair" ? 2 : 1;
  return practiceAt(discipline, rung, track);
}
function nextPractice(id, track) {
  const p = practice(id);
  return p && p.rung < 3 ? practiceAt(p.discipline, p.rung + 1, track ?? p.tracks?.[0]) : void 0;
}
function trackRank(track, discipline) {
  return track ? TRACKS[track].emphasis.indexOf(discipline) : 0;
}

// src/weekly.ts
var TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|testing)\/|[._-](test|spec)s?\.[a-z0-9]+$|Tests?\.(java|kt|cs|scala|swift)$|_test\.(go|py|rb|exs?)$|(^|\/)test_[^/]+\.py$/i;
var IGNORED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock|Gemfile\.lock)$|\.(min\.js|map|snap|svg|png|jpe?g|gif|ico|pdf)$|(^|\/)(dist|build|vendor|node_modules|generated)\//i;
var DOC = /\.(md|mdx|rst|txt|adoc)$/i;
var H = 36e5;
var isTestPath = (p) => TEST_PATH.test(p);
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function disciplineMetrics(pulls) {
  let code = 0, withTests = 0, unreviewed = 0, big = 0, scoped = 0, outOfScope = 0;
  const sizes = [], files = [], firstReview = [];
  for (const p of pulls) {
    const fs = p.files.filter((f) => !IGNORED.test(f.filename));
    const size = fs.reduce((n2, f) => n2 + f.additions + f.deletions, 0);
    sizes.push(size);
    files.push(fs.length);
    if (size > 400) big++;
    if (fs.some((f) => !isTestPath(f.filename) && !DOC.test(f.filename))) {
      code++;
      if (fs.some((f) => isTestPath(f.filename))) withTests++;
    }
    const others = (p.reviews ?? []).filter((r) => r.author && r.author !== p.author && !/\[bot\]$|^github-actions$/i.test(r.author) && r.submittedAt).map((r) => Date.parse(r.submittedAt)).sort((a, b) => a - b);
    if (others.length) firstReview.push(Math.max(0, (others[0] - Date.parse(p.createdAt)) / H));
    else unreviewed++;
    if (p.outOfScope !== void 0) {
      scoped++;
      if (p.outOfScope > 0) outOfScope++;
    }
  }
  const n = pulls.length;
  return {
    changes: n,
    testsWithCode: code ? withTests / code : null,
    medianFiles: median(files),
    outOfScopeShare: scoped ? outOfScope / scoped : null,
    medianSize: median(sizes),
    bigShare: n ? big / n : null,
    medianFirstReviewH: median(firstReview),
    unreviewedShare: n ? unreviewed / n : null
  };
}
function level(v, good, bad, higherIsBetter) {
  if (v == null) return "unknown";
  if (higherIsBetter) return v >= good ? "strong" : v < bad ? "needs practice" : "fair";
  return v <= good ? "strong" : v > bad ? "needs practice" : "fair";
}
function trend(v, prev, higherIsBetter, tolerance) {
  if (v == null || prev == null) return null;
  const d = v - prev;
  if (Math.abs(d) <= tolerance) return "stable";
  return d > 0 === higherIsBetter ? "better" : "worse";
}
var NEXT_ACTIONS = {
  examples: { action: 'Before asking the AI for code, write the examples as tests. Reviewers ask "which test shows this?" on changes without one.', practice: "examples-1" },
  scope: { action: "Write a one-line task brief (in scope / out of scope) before each change, and split out anything outside it.", practice: "scope-1" },
  steps: { action: "Keep each change to one behaviour and its test. Split anything over 400 lines before review.", practice: "steps-1" },
  review: { action: "Agree a review slot twice a day, and no merge without a second pair of eyes.", practice: "steps-1" }
};
function weeklyReport(input) {
  const now = input.now ?? Date.now();
  const days = input.days ?? 7;
  const from = now - days * 864e5;
  const inWindow = (t) => {
    const x = Date.parse(t);
    return x >= from && x <= now;
  };
  const pulls = input.pulls.filter((p2) => inWindow(p2.mergedAt));
  const m = disciplineMetrics(pulls);
  const p = input.previous ? disciplineMetrics(input.previous) : null;
  const steps = level(m.medianSize, 200, 400, false);
  const review = (m.unreviewedShare ?? 0) > 0.3 ? "needs practice" : level(m.medianFirstReviewH, 8, 48, false);
  const scopeValue = m.outOfScopeShare ?? m.medianFiles;
  const disciplines = [
    { id: "examples", name: "Examples first", metric: "Code changes with tests", value: m.testsWithCode, previous: p?.testsWithCode ?? null, trend: trend(m.testsWithCode, p?.testsWithCode ?? null, true, 0.05), status: level(m.testsWithCode, 0.75, 0.5, true) },
    m.outOfScopeShare != null ? { id: "scope", name: "Controlled scope", metric: "Changes going beyond their brief", value: scopeValue, previous: p?.outOfScopeShare ?? null, trend: trend(scopeValue, p?.outOfScopeShare ?? null, false, 0.05), status: level(scopeValue, 0.1, 0.3, false) } : { id: "scope", name: "Controlled scope", metric: "Files per change (median)", value: scopeValue, previous: p?.medianFiles ?? null, trend: trend(scopeValue, p?.medianFiles ?? null, false, 1), status: level(scopeValue, 5, 12, false) },
    { id: "steps", name: "Small, verified steps", metric: "Lines per change (median)", value: m.medianSize, previous: p?.medianSize ?? null, trend: trend(m.medianSize, p?.medianSize ?? null, false, 25), status: steps !== "needs practice" && (m.bigShare ?? 0) > 0.3 ? "fair" : steps },
    { id: "review", name: "Review flow", metric: "Hours to first review (median)", value: m.medianFirstReviewH, previous: p?.medianFirstReviewH ?? null, trend: trend(m.medianFirstReviewH, p?.medianFirstReviewH ?? null, false, 2), status: review }
  ];
  const deploys = (input.deployments ?? []).filter((d) => inWindow(d.at)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const lead = pulls.map((pr) => {
    const start = Date.parse(pr.firstCommitAt ?? pr.createdAt);
    const merged = Date.parse(pr.mergedAt);
    const next = deploys.find((d) => Date.parse(d.at) >= merged);
    return ((next ? Date.parse(next.at) : merged) - start) / H;
  });
  const delivery = [
    { name: "Change lead time", value: median(lead), unit: "hours (median)", note: deploys.length ? "First commit to deployment" : "First commit to merge: no deployment data, so time to production is not included" }
  ];
  if (deploys.length) {
    delivery.push({ name: "Deployment frequency", value: deploys.length / days, unit: "per day" });
    delivery.push({ name: "Change fail rate", value: deploys.filter((d) => d.failed).length / deploys.length, unit: "share of deployments" });
  } else {
    delivery.push({ name: "Deployment frequency", value: null, unit: "per day", note: "Not measured: publish deployments or releases to include it" });
    delivery.push({ name: "Change fail rate", value: null, unit: "share of deployments", note: "Not measured: needs deployment data" });
  }
  const recovery = [];
  deploys.forEach((d, k) => {
    if (!d.failed || k > 0 && deploys[k - 1].failed) return;
    const ok = deploys.slice(k + 1).find((x) => !x.failed);
    if (ok) recovery.push((Date.parse(ok.at) - Date.parse(d.at)) / H);
  });
  delivery.splice(2, 0, deploys.length ? { name: "Failed deployment recovery time", value: median(recovery), unit: "hours (median)", note: recovery.length ? void 0 : "No failed deployment this week" } : { name: "Failed deployment recovery time", value: null, unit: "hours (median)", note: "Not measured: needs deployment data" });
  const incidents = input.incidents ?? [];
  const unplanned = (d) => d.unplanned ?? incidents.some((i) => Date.parse(d.at) >= Date.parse(i.openedAt) && (!i.resolvedAt || Date.parse(d.at) <= Date.parse(i.resolvedAt)));
  delivery.push(deploys.length && (input.incidents || deploys.some((d) => d.unplanned !== void 0)) ? { name: "Deployment rework rate", value: deploys.filter(unplanned).length / deploys.length, unit: "share of deployments" } : { name: "Deployment rework rate", value: null, unit: "share of deployments", note: "Not measured: needs deployments and labelled incidents" });
  const rank = { "needs practice": 0, fair: 1, strong: 2, unknown: 3 };
  const pick = [...disciplines].sort((a, b) => rank[a.status] - rank[b.status] || Number(b.trend === "worse") - Number(a.trend === "worse") || (a.id === "review" || b.id === "review" ? 0 : trackRank(input.track, a.id) - trackRank(input.track, b.id)))[0];
  const focus = pick && pick.status !== "strong" && pick.status !== "unknown" ? { discipline: pick.id, name: pick.name, action: NEXT_ACTIONS[pick.id].action, practice: pick.id === "review" ? NEXT_ACTIONS.review.practice : startingPractice(pick.id, pick.status, input.track).id } : null;
  const counts = /* @__PURE__ */ new Map();
  for (const d of input.dismissals ?? []) if (inWindow(d.at)) counts.set(d.ruleId, (counts.get(d.ruleId) ?? 0) + 1);
  const rulesToTune = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([ruleId, dismissed]) => ({ ruleId, dismissed }));
  return { from: new Date(from).toISOString(), to: new Date(now).toISOString(), changes: pulls.length, disciplines, delivery, focus, rulesToTune };
}
function fmt(v, metric) {
  if (v == null) return "\u2014";
  if (/with tests|beyond|share/i.test(metric)) return `${Math.round(v * 100)}%`;
  return String(Math.round(v * 10) / 10);
}
function weeklyReportToMarkdown(r, practiceTitle) {
  const arrow = { better: "\u2197 better", worse: "\u2198 worse", stable: "\u2192 stable" };
  const out = [`## Copal team report \xB7 ${r.from.slice(0, 10)} \u2192 ${r.to.slice(0, 10)}`, "", `${r.changes} changes merged. Team level only.`, ""];
  const weekly = Date.parse(r.to) - Date.parse(r.from) <= 7.5 * 864e5;
  if (!r.changes) {
    out.push("No pull request was merged in this period. Copal reads the disciplines from merged pull requests, so work pushed straight to the main branch is not measured. Delivery metrics are below when your data allows.", "");
  } else {
    out.push(`| Discipline | Measure | ${weekly ? "This week" : "Value"} | Trend | Status |`, "|---|---|---|---|---|");
    for (const d of r.disciplines) out.push(`| ${d.name} | ${d.metric} | ${fmt(d.value, d.metric)} | ${d.trend ? arrow[d.trend] : "\u2014"} | ${d.status} |`);
    out.push("");
  }
  if (r.focus) {
    const t = practiceTitle?.(r.focus.practice);
    out.push(`### ${weekly ? "This week" : "Start with"}: ${r.focus.name}`, "", r.focus.action, ...t ? ["", `Practice: **${t}**`] : [], "");
  }
  if (r.rulesToTune.length) {
    out.push("### Rules to tune", "", "Developers dismissed these hints as wrong. Fix the rule, narrow its paths, or remove it: noisy hints get ignored.", "");
    for (const t of r.rulesToTune) out.push(`- \`${t.ruleId}\`: dismissed ${t.dismissed} times`);
    out.push("");
  }
  out.push("### Delivery", "", "| Metric | Value | Note |", "|---|---|---|");
  for (const d of r.delivery) out.push(`| ${d.name} | ${d.value == null ? "\u2014" : d.unit.startsWith("share") ? `${Math.round(d.value * 100)}%` : `${Math.round(d.value * 100) / 100} ${d.unit}`} | ${d.note ?? ""} |`);
  out.push("", "_Delivery metrics follow DORA's five software delivery metrics where the data allows: trends to discuss, not targets._");
  return out.join("\n");
}

// src/reviewguide.ts
var LOW = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock)$|\.(md|mdx|rst|txt|snap|svg|png|jpe?g|gif)$|(^|\/)(dist|build|vendor|generated)\//i;
function reviewerGuide(input) {
  const large = input.largeFile ?? 200;
  const riskGlobs = input.policy?.risk ?? [];
  const guide = { tests: [], briefUsed: !!input.briefUsed, risky: [], rest: [], lowRisk: [] };
  for (const f of input.files.filter((x) => x.status !== "deleted")) {
    const p = normalizePath(f.path);
    if (isTestPath(p)) {
      guide.tests.push(p);
      continue;
    }
    if (LOW.test(p)) {
      guide.lowRisk.push(p);
      continue;
    }
    const reasons = [];
    const glob = riskGlobs.find((g) => matchGlob(p, g));
    if (glob) reasons.push(`risk path (${glob})`);
    const rules = [...new Set((input.findings ?? []).filter((x) => normalizePath(x.file) === p).map((x) => x.ruleId))];
    if (rules.length) reasons.push(`team rule: ${rules.join(", ")}`);
    if (input.outOfScope?.some((o) => normalizePath(o) === p)) reasons.push("outside the brief");
    if (f.addedLines.length > large) reasons.push(`${f.addedLines.length} lines added`);
    if (reasons.length) guide.risky.push({ path: p, reasons });
    else guide.rest.push(p);
  }
  return guide;
}
function reviewerGuideToMarkdown(g) {
  const out = ["### Reviewer guide", ""];
  const first = [];
  if (g.briefUsed) first.push("the task brief (`.copal/brief.md`): is this the right change?");
  first.push(g.tests.length ? `the tests (${g.tests.map((t) => `\`${t}\``).join(", ")}): do they state the business rule?` : "**no test changed**: ask which example proves this change is right");
  out.push("**1. Read first:** " + first.join("; "), "");
  out.push(g.risky.length ? "**2. Then the risky files:**" : "**2. Risky files:** none flagged", "");
  for (const r of g.risky) out.push(`- \`${r.path}\`: ${r.reasons.join(", ")}`);
  if (g.risky.length) out.push("");
  if (g.rest.length) out.push(`**3. The rest** (${g.rest.length} file${g.rest.length > 1 ? "s" : ""}): a quick read is usually enough when the tests above are convincing.`, "");
  if (g.lowRisk.length) out.push(`_Low risk, skim or skip: ${g.lowRisk.length} file${g.lowRisk.length > 1 ? "s" : ""} (docs, lockfiles, generated)._`);
  return out.join("\n").trim();
}

// src/request.ts
var SMALL = /^\s*(fix (a |the )?typo|rename|format|reformat|bump|lint|sort imports|remove unused|add (a )?comment)\b/i;
var QUESTION = /^\s*(what|why|how|where|when|which|who|is|are|can|could|does|do|explain|show me|tell me)\b|\?\s*$/i;
var BYPASS = /\b(just do it|no questions)\b|(^|[\s.,;:!])skip\s*[.!]?\s*$/i;
var CONTINUE = /^\s*(please\s+)?(continue|go on|keep going|proceed|carry on|next|do it|go ahead|finish( it)?)\b[\w\s.,!]*$/i;
var SCOPE = /\b(only|don'?t (touch|change|modify)|do not (touch|change|modify)|without (changing|touching)|leave .* (untouched|as is)|scope|limited to|nothing else|just (the|this))\b/i;
var DONE = /\b(should|must|expect(ed)?|returns?|so that|done when|until|passes?|pass)\b|→|->|=>/i;
function requestGaps(prompt) {
  const p = prompt.trim();
  if (!p || SMALL.test(p) || QUESTION.test(p)) return [];
  if (CONTINUE.test(p)) return ["goal"];
  const gaps = [];
  if (!SCOPE.test(p)) gaps.push("scope");
  if (!DONE.test(p)) gaps.push("done");
  return gaps;
}
function briefNextStep(brief) {
  return brief?.match(/^\s*Next:\s*(.+?)\s*$/im)?.[1];
}
var QUESTIONS = {
  goal: "What exactly should happen next?",
  scope: "What should this change not touch?",
  done: "How will we know it's done \u2014 which example or test should pass?"
};
function requestCheckContext(prompt, brief) {
  if (BYPASS.test(prompt)) return null;
  const gaps = requestGaps(prompt);
  if (!gaps.length) return null;
  const gap = gaps[0];
  const next = gap === "goal" ? briefNextStep(brief) : void 0;
  const lines = [
    "Copal request check: before doing anything, ask the developer exactly one short question and wait for the answer. Do not assume the answer and do not start coding.",
    `Question: ${QUESTIONS[gap]}`
  ];
  if (next) lines.push("Offer these options:", `1. ${next}`, "2. Something else (they describe it)");
  lines.push(`Then: ${EXAMPLES_FIRST}`, REPORT_RULE);
  lines.push('If the developer says "just do it" or "skip", proceed without asking.');
  return lines.join("\n");
}
function requestCheckEvent(prompt) {
  if (BYPASS.test(prompt)) return null;
  const gap = requestGaps(prompt)[0];
  return gap ? { ruleId: `request-${gap}`, category: "requests", levelReached: 1, action: "shown" } : null;
}

// src/scope.ts
var NOT_STATED = /^\(not stated/i;
function parseBriefMarkdown(raw) {
  const md = raw.replace(/\*\*([^*]+?)\*\*/g, "$1").replace(/^[-*]\s+(?=\w[\w ]*:)/gm, "");
  const line = (rx) => md.match(rx)?.[1]?.trim();
  const keep = (s) => s && !NOT_STATED.test(s) ? s : void 0;
  const examples = [...md.matchAll(/^\s*-\s*\[([ xX])\]\s+(.+?)\s*$/gm)].map((m) => ({ text: m[2], done: m[1] !== " " }));
  const scope = {};
  const sin = keep(line(/^(?:Scope in|In scope):\s*(.+)$/im));
  const sout = keep(line(/^(?:Scope out|Out of scope|Not in scope):\s*(.+)$/im));
  const done = keep(line(/^(?:Done when|Definition of done):\s*(.+)$/im));
  if (done && !examples.length) examples.push({ text: done, done: false });
  if (sin) scope.in = sin;
  if (sout) scope.out = sout;
  const task = line(/^#\s*Task:\s*(.+)$/im) ?? line(/^(?:Goal|Task):\s*(.+)$/im) ?? line(/^#\s*(?:Brief:\s*)?(.+)$/m) ?? "";
  return { task, scope, examples, next: line(/^Next:\s*(.+)$/im) };
}
var STOP2 = new Set(
  "the and for with from into onto that this then than when what which should must only not don dont touch change changes add adds added new make pass passes error errors test tests spec specs src lib main app index java kotlin ts tsx js jsx mjs cjs kt py go rb cs".split(" ")
);
function words(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).map((w) => w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w).filter((w) => w.length >= 3 && !STOP2.has(w) && !/^\d+$/.test(w));
}
var EXPORT = /^\s*(?:export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)|(?:public\s+)?(?:fun|class|object|interface)\s+([A-Za-z_][\w]*))/;
var ENDPOINT = /\b(?:router|app|server|route[rs]?)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]|@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:value\s*=\s*)?["']([^"']+)["']/i;
function newSymbols(c2) {
  const exports = [];
  const endpoints = [];
  for (const { text } of c2.addedLines) {
    const e = text.match(EXPORT);
    if (e) exports.push(e[1] ?? e[2]);
    const p = text.match(ENDPOINT);
    if (p) endpoints.push(`${(p[1] ?? p[3]).toUpperCase()} ${p[2] ?? p[4]}`);
  }
  return { exports, endpoints };
}
function scopeCheck(briefMd, changes) {
  const b = parseBriefMarkdown(briefMd);
  const vocab = new Set(words([b.task, b.scope.in ?? "", ...b.examples.map((e) => e.text)].join(" ")));
  const outWords = new Set(words(b.scope.out ?? ""));
  const hits = (ws, set) => ws.some((w) => set.has(w));
  const items = [];
  for (const c2 of changes) {
    if (c2.status === "deleted" || c2.path.startsWith(".copal/")) continue;
    const pathWords = words(c2.path);
    const { exports, endpoints } = newSymbols(c2);
    const details = [...exports.map((e) => `new export ${e}`), ...endpoints.map((e) => `new endpoint ${e}`)];
    if (b.scope.out && hits(pathWords, outWords)) {
      items.push({ file: c2.path, question: `${c2.path}: the brief says not to touch "${b.scope.out}" \u2014 is this change needed?`, details });
      continue;
    }
    if (!hits(pathWords, vocab)) {
      items.push({ file: c2.path, question: `Not in the brief: ${c2.path} \u2014 keep it?`, details });
      continue;
    }
    const extra = [...exports.filter((e) => !hits(words(e), vocab)).map((e) => `new export ${e}`), ...endpoints.filter((e) => !hits(words(e), vocab)).map((e) => `new endpoint ${e}`)];
    if (extra.length) items.push({ file: c2.path, question: `Not in the brief: ${extra.join(", ")} in ${c2.path} \u2014 keep it?`, details: extra });
  }
  return items;
}

// src/review.ts
function reviewActions(c2) {
  const out = [];
  if (c2.question) out.push("Ask me");
  if (c2.why || c2.reference || c2.example) out.push("Explain");
  if (c2.fix) out.push("Show me");
  return out;
}
function reviewChange(changes, policy, opts = {}) {
  const report = evaluate(changes, policy, { environment: opts.environment ?? "local" });
  const cards = report.findings.map((f) => {
    const card = hintCard(f);
    return { ...card, file: f.file, line: f.line, actions: reviewActions(card), markdown: findingToMarkdown(f, { referenceBase: opts.referenceBase }), finding: f };
  });
  return { cards, scope: opts.brief ? scopeCheck(opts.brief, changes) : [], blocking: report.blocking };
}
export {
  AGENT_CONTEXT_TARGETS,
  BASELINE_FILE,
  BUILTIN_PACKS,
  BUILTIN_REDACT,
  CONTEXT_BEGIN,
  CONTEXT_END,
  EXAMPLES_FIRST,
  HINT_LEVELS,
  LADDER,
  LATE_SOURCES,
  NEXT_ACTIONS,
  PLAN_CHECK,
  POLICY_FILE,
  REPORT_RULE,
  SMELL_DEFAULTS,
  SUPPORTED_VERSIONS,
  TRACKS,
  YamlError,
  agentContextBlock,
  anyDetail,
  applicableRules,
  asksQuestion,
  baselineKey,
  blankCode,
  bold,
  briefNextStep,
  briefToMarkdown,
  briefToText,
  buildBrief,
  changeSizeOf,
  changedLineSet,
  classify,
  concreteTestPath,
  containsCode,
  createBaseline,
  cyan,
  detectSmell,
  dim,
  disciplineMetrics,
  draftRuleFromReview,
  effectiveRules,
  evaluate,
  evaluateGate,
  exportedFunctions,
  fileAsChange,
  findingToMarkdown,
  formatFinding,
  formatReport,
  gateLine,
  globToRegExp,
  green,
  groupFindings,
  hintCard,
  inScope,
  isTestPath,
  kataSuggestions,
  ladderFor,
  lineTextFrom,
  mask,
  matchGlob,
  median,
  mergeManagedBlock,
  mergePolicies,
  navigatorQuestions,
  nextPractice,
  normalizePath,
  onChangedLines,
  parseBaseline,
  parseBriefMarkdown,
  parseDeny,
  parsePolicy,
  parseUnifiedDiff,
  parseYaml,
  parseYamlSubset,
  practice,
  practiceAt,
  reach,
  red,
  redact,
  referenceLink,
  reportToMarkdown,
  requestCheckContext,
  requestCheckEvent,
  requestGaps,
  resolvePolicy,
  reviewActions,
  reviewChange,
  reviewerGuide,
  reviewerGuideToMarkdown,
  ruleHealth,
  ruleSummary,
  rulesToGuidance,
  rulesWithoutCoaching,
  scalar,
  scopeCheck,
  startingPractice,
  taskScope,
  testDetail,
  testOrderFindings,
  toYaml,
  trackRank,
  validatePolicy,
  weeklyReport,
  weeklyReportToMarkdown,
  withoutBaseline,
  yellow
};
