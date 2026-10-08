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
  constructor(public title: string, public kind: unknown) {}
}
const listeners: Record<string, ((x: any) => void)[]> = {};
const ev = (name: string) => (fn: (x: any) => void) => ((listeners[name] ??= []).push(fn), { dispose() {} });
const diags = new Map<string, Diagnostic[]>();
let provider: any;
const statusBar = { text: "", tooltip: "", command: "", show() {}, hide() {}, dispose() {} };

const fakeVscode = {
  Position,
  Range,
  Diagnostic,
  WorkspaceEdit,
  CodeAction,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  CodeActionKind: { QuickFix: "quickfix" },
  StatusBarAlignment: { Left: 1, Right: 2 },
  languages: {
    createDiagnosticCollection: () => ({ set: (u: any, d: Diagnostic[]) => diags.set(u.toString(), d), delete: (u: any) => diags.delete(u.toString()), dispose() {} }),
    registerCodeActionsProvider: (_s: unknown, p: unknown) => ((provider = p), { dispose() {} }),
  },
  workspace: {
    textDocuments: [] as unknown[],
    getConfiguration: () => ({ get: (k: string, d: unknown) => (k === "serverUrl" ? "" : k === "environment" ? "local" : d) }),
    findFiles: async () => [],
    openTextDocument: async () => undefined,
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
  },
  commands: { registerCommand: () => ({ dispose() {} }) },
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

test("extension reports findings and offers quick fixes", async () => {
  const ext = require("../src/extension");
  const ctx = { subscriptions: [] as { dispose(): void }[], secrets: { get: async () => undefined, store: async () => undefined } };
  ext.activate(ctx);
  const d = doc(path.join(tmp, "src/invoice/total.ts"));
  listeners.open.forEach((fn) => fn(d));

  const found = diags.get(d.uri.toString())!;
  assert.deepEqual(found.map((x) => x.code).sort(), ["hardcoded-credentials", "invoice-contract-test", "ledger-rounding"]);
  const rounding = found.find((x) => x.code === "ledger-rounding")!;
  assert.equal(rounding.severity, 0, "enforce rules are errors");
  assert.equal(rounding.range.start.line, 7);
  assert.match(statusBar.text, /Copal 2/);

  const actions = provider.provideCodeActions(d, rounding.range, { diagnostics: [rounding] });
  assert.equal(actions.length, 2);
  assert.equal(actions[0].edit.ops[0].text, "  const total = LedgerPort.round(sum, Currency.EUR);");
  assert.equal(actions[1].edit.ops[0].text, "  // copal-ignore ledger-rounding\n");

  // clean file → no diagnostics
  const clean = doc(path.join(tmp, "src/service/invoice-service.ts"));
  listeners.open.forEach((fn) => fn(clean));
  assert.deepEqual(diags.get(clean.uri.toString()), []);
  ctx.subscriptions.forEach((s) => s.dispose());
});
