/**
 * Runs the extension against a fake `vscode` module (no editor needed) and checks
 * diagnostics, the status bar and both quick fixes on the billing-api scenarios.
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require("node:module");

class Position {
  constructor(public line: number, public character: number) {}
}
class Range {
  start: Position;
  end: Position;
  constructor(a: number, b: number, c: number, d: number) {
    this.start = new Position(a, b);
    this.end = new Position(c, d);
  }
}
class Diagnostic {
  source?: string;
  code?: string;
  constructor(public range: Range, public message: string, public severity: number) {}
}
class WorkspaceEdit {
  ops: { kind: string; line: number; text: string }[] = [];
  replace(_u: unknown, r: Range, text: string) {
    this.ops.push({ kind: "replace", line: r.start.line, text });
  }
  insert(_u: unknown, p: Position, text: string) {
    this.ops.push({ kind: "insert", line: p.line, text });
  }
}
class CodeAction {
  edit?: WorkspaceEdit;
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  command?: { command: string; arguments?: unknown[] };
  constructor(public title: string, public kind: unknown) {}
}
class MarkdownString {
  isTrusted?: unknown;
  constructor(public value = "") {}
  appendMarkdown(v: string) {
    this.value += v;
    return this;
  }
}
class Hover {
  constructor(public contents: MarkdownString) {}
}
let hoverProvider: any;
const commands: Record<string, (...a: any[]) => any> = {};
const listeners: Record<string, ((x: any) => void)[]> = {};
const ev = (name: string) => (fn: (x: any) => void) => ((listeners[name] ??= []).push(fn), { dispose() {} });
const diags = new Map<string, Diagnostic[]>();
let provider: any;
const executed: { name: string; args: unknown[] }[] = [];
const panels: any[] = [];
const statusBar = { text: "", tooltip: "", command: "", show() {}, hide() {}, dispose() {} };

const fakeVscode = {
  Position,
  Range,
  Diagnostic,
  WorkspaceEdit,
  CodeAction,
  MarkdownString,
  Hover,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  CodeActionKind: { QuickFix: "quickfix" },
  StatusBarAlignment: { Left: 1, Right: 2 },
  languages: {
    createDiagnosticCollection: () => ({ set: (u: any, d: Diagnostic[]) => diags.set(u.toString(), d), delete: (u: any) => diags.delete(u.toString()), dispose() {} }),
    registerCodeActionsProvider: (_s: unknown, p: unknown) => ((provider = p), { dispose() {} }),
    registerHoverProvider: (_s: unknown, p: unknown) => ((hoverProvider = p), { dispose() {} }),
  },
  workspace: {
    textDocuments: [] as unknown[],
    getConfiguration: () => ({ get: (k: string, d: unknown) => (k === "serverUrl" ? "" : k === "environment" ? "local" : d) }),
    findFiles: async () => [],
    openTextDocument: async () => undefined,
    applyEdit: async () => true,
    onDidOpenTextDocument: ev("open"),
    onDidSaveTextDocument: ev("save"),
    onDidCloseTextDocument: ev("close"),
    onDidChangeTextDocument: ev("change"),
  },
  window: {
    activeTextEditor: undefined,
    createOutputChannel: () => ({ append() {}, appendLine() {}, clear() {}, show() {}, dispose() {} }),
    createStatusBarItem: () => statusBar,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showInputBox: async () => undefined,
    showTextDocument: async () => undefined,
    createWebviewPanel: (_id: string, title: string) => {
      const panel = {
        title,
        webview: { html: "", options: {}, onDidReceiveMessage: (fn: (m: any) => void) => ((panel.onMessage = fn), { dispose() {} }) },
        onMessage: undefined as undefined | ((m: any) => void),
        reveal() {},
        onDidDispose: () => ({ dispose() {} }),
        dispose() {},
      };
      panels.push(panel);
      return panel;
    },
  },
  env: { clipboard: { writeText: async () => undefined } },
  Uri: { file: (p: string) => ({ scheme: "file", fsPath: p, toString: () => "file://" + p }), parse: (v: string) => ({ toString: () => v }) },
  ViewColumn: { Beside: -2 },
  commands: {
    registerCommand: (name: string, fn: (...a: any[]) => any) => ((commands[name] = fn), { dispose() {} }),
    executeCommand: async (name: string, ...args: unknown[]) => (executed.push({ name, args }), commands[name]?.(...args)),
  },
};

const origLoad = Module._load;
Module._load = function (req: string, ...rest: unknown[]) {
  return req === "vscode" ? fakeVscode : origLoad.call(this, req, ...rest);
};

function doc(file: string) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  return {
    uri: { scheme: "file", fsPath: file, toString: () => "file://" + file },
    fileName: file,
    lineCount: lines.length,
    getText: () => text,
    lineAt: (i: number) => ({ text: lines[i], range: new Range(i, 0, i, lines[i].length) }),
  };
}

const APP = path.resolve(__dirname, "../../../../examples/billing-api");
// Mirror the app into a temp dir with scenario 01 applied (policy discovery walks up to .copalrules).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "copal-vscode-"));
fs.cpSync(APP, tmp, { recursive: true, filter: (s) => !s.includes(`${path.sep}scenarios`) });
fs.cpSync(path.join(APP, "scenarios/01-invoice-rounding"), tmp, { recursive: true });

test("extension reports findings and offers quick fixes", async (t) => {
  const ext = require("../src/extension");
  const ctx = { subscriptions: [] as { dispose(): void }[], secrets: { get: async () => undefined, store: async () => undefined } };
  ext.activate(ctx);
  t.after(() => ctx.subscriptions.forEach((s) => s.dispose()));
  const d = doc(path.join(tmp, "src/invoice/total.ts"));
  listeners.open.forEach((fn) => fn(d));

  const found = diags.get(d.uri.toString())!;
  assert.deepEqual(found.map((x) => x.code).sort(), ["hardcoded-credentials", "invoice-contract-test", "ledger-rounding"]);
  const rounding = found.find((x) => x.code === "ledger-rounding")!;
  assert.equal(rounding.severity, 0, "enforce rules are errors");
  assert.equal(rounding.range.start.line, 7);
  assert.match(statusBar.text, /Copal 2/);

  const actions = provider.provideCodeActions(d, rounding.range, { diagnostics: [rounding] });
  // billing-api rules are coached (v4): Ask me · Explain · Show me (the correction) · false positive
  assert.deepEqual(actions.map((a: CodeAction) => a.title.replace(/ \(.*$/, "")), ["Copal: Ask me", "Copal: Explain", "Copal: Show me", "Copal: mark as false positive"]);
  const showMe = actions.find((a: CodeAction) => a.title.startsWith("Copal: Show me"));
  assert.equal(showMe.edit.ops[0].text, "  const total = LedgerPort.round(sum, Currency.EUR);");
  assert.equal(showMe.isPreferred, false, "the fix is never the preferred one-click action for coached rules");
  assert.equal(actions.at(-1).edit.ops[0].text, "  // copal-ignore ledger-rounding\n");

  // clean file → no diagnostics
  const clean = doc(path.join(tmp, "src/service/invoice-service.ts"));
  listeners.open.forEach((fn) => fn(clean));
  assert.deepEqual(diags.get(clean.uri.toString()), []);
  ctx.subscriptions.forEach((s) => s.dispose());
});

test("coached findings lead with the question; the fix is behind Show me", async (t) => {
  // Same app with a v4 coaching block on ledger-rounding.
  const rules = fs.readFileSync(path.join(tmp, ".copalrules"), "utf8");
  if (!/coach:/.test(rules)) {
    fs.writeFileSync(
      path.join(tmp, ".copalrules"),
      rules.replace(/version: 3/, "version: 4").replace(/(\n  - id: ledger-rounding\n)/, "$1    coach:\n      question: Who owns rounding in this codebase?\n"),
    );
  }
  const ext = require("../src/extension");
  const ctx = { subscriptions: [] as { dispose(): void }[], secrets: { get: async () => undefined, store: async () => undefined } };
  ext.activate(ctx);
  t.after(() => ctx.subscriptions.forEach((s) => s.dispose()));
  const d = doc(path.join(tmp, "src/invoice/total.ts"));
  listeners.open.forEach((fn) => fn(d));
  const found = diags.get(d.uri.toString())!;
  const rounding = found.find((x) => x.code === "ledger-rounding")!;
  assert.match(rounding.message, /Who owns rounding/);
  const titles = provider.provideCodeActions(d, rounding.range, { diagnostics: [rounding] }).map((a: CodeAction) => a.title);
  assert.deepEqual(titles.slice(0, 3), ["Copal: Ask me (ledger-rounding)", "Copal: Explain (ledger-rounding)", "Copal: Show me (ledger-rounding)"]);
  const hover = hoverProvider.provideHover(d, new Position(7, 4));
  assert.match(hover.contents.value, /\*\*Who owns rounding in this codebase\?\*\*/);
  assert.match(hover.contents.value, /command:copal\.ask/);
  assert.match(hover.contents.value, /command:copal\.showMe/);
  assert.ok(commands["copal.pair"], "navigator command registered");
  ctx.subscriptions.forEach((s) => s.dispose());
});

test("growth events name the developer from git config user.name (cached per folder)", () => {
  const { execFileSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copal-author-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "ana"], { cwd: dir });
  const ext = require("../src/extension");
  assert.equal(ext.gitAuthor(dir), "ana");
  execFileSync("git", ["config", "user.name", "bob"], { cwd: dir });
  assert.equal(ext.gitAuthor(dir), "ana", "cached");
  assert.equal(ext.gitAuthor(path.join(dir, "missing")), undefined);
});

test("Mark kata done: finds the kata by URL (or adds it), then records the completion for the developer", async () => {
  const ext = require("../src/extension");
  const calls: { method: string; url: string; body?: any }[] = [];
  const fake = async (url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? "GET", url, body });
    if (url.endsWith("/v1/katas") && !init.method) return { ok: true, json: async () => ({ katas: [] }) };
    if (url.endsWith("/v1/katas")) return { ok: true, json: async () => ({ id: "k_1", url: body.url }) };
    return { ok: true, json: async () => ({}) };
  };
  const ok = await ext.kataDoneRequest("http://s", "key", "https://sammancoaching.org/kata_descriptions/string_calculator.html", "ana", "invoice-contract-test", fake);
  assert.equal(ok, true);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace("http://s", "")}`), ["GET /v1/katas", "POST /v1/katas", "POST /v1/katas/k_1/complete"]);
  assert.equal(calls[1].body.ruleId, "invoice-contract-test");
  assert.equal(calls[2].body.developer, "ana");
});

test("Review my change: scenario 01 in a git repo → panel with three hint cards and Ask me / Explain / Show me", async (t) => {
  const { execFileSync } = require("node:child_process");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "copal-review-"));
  fs.cpSync(APP, repo, { recursive: true, filter: (s) => !s.includes(`${path.sep}scenarios`) });
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "ana");
  g("config", "user.email", "ana@example.com");
  g("add", "-A");
  g("commit", "-qm", "base");
  fs.cpSync(path.join(APP, "scenarios/01-invoice-rounding/src"), path.join(repo, "src"), { recursive: true });

  const ext = require("../src/extension");
  const ctx = { subscriptions: [] as { dispose(): void }[], secrets: { get: async () => undefined, store: async () => undefined } };
  ext.activate(ctx);
  t.after(() => ctx.subscriptions.forEach((s) => s.dispose()));
  await commands["copal.reviewChange"](repo);
  const panel = panels.at(-1);
  assert.ok(panel, "a panel opens");
  const html: string = panel.webview.html;
  for (const id of ["ledger-rounding", "invoice-contract-test", "hardcoded-credentials"]) assert.ok(html.includes(id), id);
  for (const label of ["Ask me", "Explain", "Show me"]) assert.equal(html.split(`>${label}</button>`).length - 1, 3, label);

  panel.onMessage({ command: "copal.explain", ruleId: "ledger-rounding", file: "src/invoice/total.ts", line: 8 });
  const call = executed.find((e) => e.name === "copal.explain")!;
  assert.ok(call, "buttons run the existing ladder commands");
  assert.match((call.args[0] as { uri: string }).uri, /src\/invoice\/total\.ts$/);
});
