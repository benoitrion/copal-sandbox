import * as path from "node:path";
import * as vscode from "vscode";
import { applicableRules, evaluate, fileAsChange, Finding, loadPolicy, Policy, rulesToGuidance } from "@copal/core";

/**
 * Copal for VS Code: evaluates the open file against the nearest `.copalrules` (same engine as
 * pre-commit and PR checks), shows findings as diagnostics, and offers the suggested corrections as quick fixes.
 */

const SOURCE = "copal";
let diagnostics: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;
let status: vscode.StatusBarItem;
const findingsByUri = new Map<string, Finding[]>();
const heartbeats: { file: string; ts: number; editor: string }[] = [];

function cfg() {
  const c = vscode.workspace.getConfiguration("copal");
  return { serverUrl: c.get<string>("serverUrl", ""), environment: c.get<string>("environment", "local"), checkOnSave: c.get<boolean>("checkOnSave", true) };
}

function policyFor(doc: vscode.TextDocument): { policy: Policy; root: string } | null {
  if (doc.uri.scheme !== "file") return null;
  try {
    const { policy, root } = loadPolicy(path.dirname(doc.uri.fsPath));
    return { policy, root };
  } catch {
    return null;
  }
}

function toDiagnostic(doc: vscode.TextDocument, f: Finding): vscode.Diagnostic {
  const line = Math.min(Math.max(f.line - 1, 0), doc.lineCount - 1);
  const text = doc.lineAt(line).text;
  const start = f.column ? f.column - 1 : text.length - text.trimStart().length;
  const end = f.endColumn ? f.endColumn - 1 : text.length;
  const d = new vscode.Diagnostic(
    new vscode.Range(line, start, line, Math.max(end, start + 1)),
    `${f.message}${f.why ? ` — ${f.why}` : ""}`,
    f.blocking ? vscode.DiagnosticSeverity.Error : f.severity === "info" ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Warning,
  );
  d.source = SOURCE;
  d.code = f.ruleId;
  return d;
}

function check(doc: vscode.TextDocument) {
  const p = policyFor(doc);
  if (!p) {
    diagnostics.delete(doc.uri);
    return;
  }
  const rel = path.relative(p.root, doc.uri.fsPath).split(path.sep).join("/");
  if (rel.startsWith("..")) return;
  const report = evaluate([fileAsChange(rel, doc.getText())], p.policy, { environment: cfg().environment });
  findingsByUri.set(doc.uri.toString(), report.findings);
  diagnostics.set(doc.uri, report.findings.map((f) => toDiagnostic(doc, f)));
  status.text = report.blocking ? `$(error) Copal ${report.summary.blocking}` : report.findings.length ? `$(warning) Copal ${report.findings.length}` : "$(check) Copal";
  status.tooltip = `${report.summary.blocking} blocking · ${report.summary.audit} audit (${report.environment})`;
  status.show();
  heartbeats.push({ file: rel, ts: Date.now(), editor: "vscode" });
}

class QuickFixes implements vscode.CodeActionProvider {
  static kinds = [vscode.CodeActionKind.QuickFix];
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const findings = findingsByUri.get(doc.uri.toString()) ?? [];
    const actions: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics.filter((x) => x.source === SOURCE)) {
      const f = findings.find((x) => x.ruleId === d.code && x.line - 1 === d.range.start.line);
      if (!f) continue;
      if (f.suggestion) {
        const a = new vscode.CodeAction(`Copal: apply correction (${f.ruleId})`, vscode.CodeActionKind.QuickFix);
        a.edit = new vscode.WorkspaceEdit();
        a.edit.replace(doc.uri, doc.lineAt(f.line - 1).range, f.suggestion.replacement);
        a.diagnostics = [d];
        a.isPreferred = true;
        actions.push(a);
      }
      const ignore = new vscode.CodeAction(`Copal: mark as false positive (${f.ruleId})`, vscode.CodeActionKind.QuickFix);
      ignore.edit = new vscode.WorkspaceEdit();
      const lineText = doc.lineAt(f.line - 1).text;
      const indent = lineText.slice(0, lineText.length - lineText.trimStart().length);
      const comment = /\.(py|ya?ml|sh)$/.test(doc.fileName) ? "#" : "//";
      ignore.edit.insert(doc.uri, new vscode.Position(f.line - 1, 0), `${indent}${comment} copal-ignore ${f.ruleId}\n`);
      ignore.diagnostics = [d];
      actions.push(ignore);
    }
    return actions;
  }
}

async function flushHeartbeats(ctx: vscode.ExtensionContext) {
  const { serverUrl } = cfg();
  if (!serverUrl || !heartbeats.length) return;
  const key = await ctx.secrets.get("copal.apiKey");
  const batch = heartbeats.splice(0, heartbeats.length);
  try {
    await fetch(serverUrl.replace(/\/$/, "") + "/v1/heartbeats", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
      body: JSON.stringify({ heartbeats: batch }),
    });
  } catch {
    /* offline: drop */
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection(SOURCE);
  output = vscode.window.createOutputChannel("Copal");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "copal.showRules";

  let timer: ReturnType<typeof setTimeout> | undefined;
  ctx.subscriptions.push(
    diagnostics,
    output,
    status,
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new QuickFixes(), { providedCodeActionKinds: QuickFixes.kinds }),
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (path.basename(d.fileName) === ".copalrules") vscode.workspace.textDocuments.forEach(check);
      else if (cfg().checkOnSave) check(d);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      clearTimeout(timer);
      timer = setTimeout(() => check(e.document), 400);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      diagnostics.delete(d.uri);
      findingsByUri.delete(d.uri.toString());
    }),
    vscode.commands.registerCommand("copal.checkFile", () => {
      const d = vscode.window.activeTextEditor?.document;
      if (d) check(d);
    }),
    vscode.commands.registerCommand("copal.checkWorkspace", async () => {
      const uris = await vscode.workspace.findFiles("**/*.{ts,tsx,js,jsx,json}", "**/{node_modules,dist}/**", 2000);
      for (const u of uris) check(await vscode.workspace.openTextDocument(u));
      vscode.window.showInformationMessage(`Copal: checked ${uris.length} file(s).`);
    }),
    vscode.commands.registerCommand("copal.setApiKey", async () => {
      const key = await vscode.window.showInputBox({ prompt: "Copal device key", password: true, placeHolder: "copal_…" });
      if (key) {
        await ctx.secrets.store("copal.apiKey", key);
        vscode.window.showInformationMessage("Copal: API key saved.");
      }
    }),
    vscode.commands.registerCommand("copal.showRules", () => {
      const d = vscode.window.activeTextEditor?.document;
      const p = d && policyFor(d);
      if (!d || !p) return vscode.window.showWarningMessage("Copal: no .copalrules found for this file.");
      const rel = path.relative(p.root, d.uri.fsPath).split(path.sep).join("/");
      output.clear();
      output.appendLine(rulesToGuidance(applicableRules(p.policy, rel, cfg().environment), rel));
      output.show(true);
    }),
  );

  const hb = setInterval(() => flushHeartbeats(ctx), 60_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(hb) });
  vscode.workspace.textDocuments.forEach(check);
}

export function deactivate() {}
