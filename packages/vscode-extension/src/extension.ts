import * as path from "node:path";
import * as vscode from "vscode";
import * as fs from "node:fs";
import {
  agentContextBlock,
  AGENT_CONTEXT_TARGETS,
  mergeManagedBlock,
  applicableRules,
  briefToText,
  buildBrief,
  evaluate,
  fileAsChange,
  Finding,
  HintLevel,
  hintCard,
  loadPolicy,
  navigatorQuestions,
  Policy,
  rulesToGuidance,
  parseUnifiedDiff,
  reviewChange,
  ReviewCard,
  ScopeItem,
} from "@copal/core";

/**
 * Copal for VS Code — the technical coach in the editor. Evaluates the open file against the nearest `.copalrules`
 * (same engine as pre-commit and PR checks) and shows each finding as a hint card: the question first, then
 * Ask me · Explain · Show me. The fix is level 4 of the hint ladder: only on request, and recorded.
 * "Copal: Pair on a task" runs the navigator before an AI assistant builds a feature.
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
    f.coach?.question ? `${f.message} — ${f.coach.question}` : `${f.message}${f.why ? ` — ${f.why}` : ""}`,
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
  rootOf.set(doc.uri.toString(), p.root);
  projectOf.set(doc.uri.toString(), p.policy.project);
  diagnostics.set(doc.uri, report.findings.map((f) => toDiagnostic(doc, f)));
  status.text = report.blocking
    ? `$(error) Copal ${report.summary.blocking}`
    : report.findings.length
      ? `${report.policyMode === "coach" ? "$(comment-discussion)" : "$(warning)"} Copal ${report.findings.length}`
      : "$(check) Copal";
  status.tooltip = `${report.summary.blocking} blocking · ${report.summary.audit} audit (${report.environment})`;
  status.show();
  heartbeats.push({ file: rel, ts: Date.now(), editor: "vscode" });
}

// ---------------------------------------------------------------- coaching
interface FindingRef {
  uri: string;
  ruleId: string;
  line: number;
}
let extCtx: vscode.ExtensionContext | undefined;
const projectOf = new Map<string, string | undefined>();

function findingFor(ref: FindingRef): Finding | undefined {
  return findingsByUri.get(ref.uri)?.find((f) => f.ruleId === ref.ruleId && f.line === ref.line);
}

const authors = new Map<string, string | undefined>();
/** The developer behind growth events: `git config user.name` of the repo, like the CLI. Cached per folder. */
export function gitAuthor(dir: string): string | undefined {
  if (!authors.has(dir)) {
    let name: string | undefined;
    try {
      name = require("node:child_process").execFileSync("git", ["config", "user.name"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
    } catch {
      /* not a repo or git missing */
    }
    authors.set(dir, name);
  }
  return authors.get(dir);
}

/** Growth metric: the ladder level a finding reached (best effort, never blocks the developer). */
async function coachEvent(f: Finding, levelReached: HintLevel, action: string, uri?: string) {
  const { serverUrl } = cfg();
  if (!serverUrl || !extCtx) return;
  const key = await extCtx.secrets.get("copal.apiKey");
  try {
    await fetch(serverUrl.replace(/\/$/, "") + "/v1/coach/events", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
      body: JSON.stringify({ project: uri ? projectOf.get(uri) : undefined, developer: uri && rootOf.get(uri) ? gitAuthor(rootOf.get(uri)!) : undefined, ruleId: f.ruleId, category: f.category, levelReached, action, source: "ide", at: new Date().toISOString() }),
    });
  } catch {
    /* offline */
  }
}

const cmdLink = (label: string, command: string, ref: FindingRef) => `[${label}](command:${command}?${encodeURIComponent(JSON.stringify([ref]))})`;

/** The hint card shown on hover: signal + question, then the ladder as links. */
export function hintCardMarkdown(f: Finding, uri: string): string {
  const c = hintCard(f);
  const ref: FindingRef = { uri, ruleId: f.ruleId, line: f.line };
  const out = [`**${f.blocking ? "$(error)" : "$(comment-discussion)"} ${c.title}**`, "", c.signal];
  if (c.question) out.push("", `**${c.question}**`);
  const links = [c.question ? cmdLink("Ask me", "copal.ask", ref) : "", cmdLink("Explain", "copal.explain", ref), c.fix ? cmdLink("Show me", "copal.showMe", ref) : ""].filter(Boolean);
  out.push("", links.join(" · "));
  if (c.kata) out.push("", `Practice: [kata](${c.kata})${c.learningHour ? ` · learning hour *${c.learningHour}*` : ""}`);
  return out.join("\n");
}

class Hovers implements vscode.HoverProvider {
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const f = (findingsByUri.get(doc.uri.toString()) ?? []).find((x) => x.line - 1 === pos.line);
    if (!f) return undefined;
    const md = new vscode.MarkdownString(hintCardMarkdown(f, doc.uri.toString()), true);
    md.isTrusted = { enabledCommands: ["copal.ask", "copal.explain", "copal.showMe"] };
    void coachEvent(f, f.coach?.question ? 1 : 0, "shown", doc.uri.toString());
    return new vscode.Hover(md);
  }
}

async function ask(ref: FindingRef) {
  const f = findingFor(ref);
  if (!f) return;
  const q = f.coach?.question ?? `What would you change about ${f.ruleId} here, and why?`;
  const answer = await vscode.window.showInputBox({ title: `Copal · ${f.ruleId}`, prompt: q, placeHolder: "Think aloud — your answer stays local", ignoreFocusOut: true });
  if (answer === undefined) return;
  void coachEvent(f, 1, answer.trim() ? "answered" : "skipped", ref.uri);
  const next = await vscode.window.showInformationMessage(
    answer.trim() ? "Nice — want to compare with the team's reasoning?" : "No worries. Want a nudge?",
    "Explain",
    ...(hintCard(f).fix ? ["Show me"] : []),
  );
  if (next === "Explain") await explain(ref);
  if (next === "Show me") await showMe(ref);
}

async function explain(ref: FindingRef) {
  const f = findingFor(ref);
  if (!f) return;
  const c = hintCard(f);
  output.clear();
  output.appendLine(`Copal · ${c.title} · ${c.location}`);
  output.appendLine(c.signal);
  if (c.question) output.appendLine(`\n? ${c.question}`);
  if (c.why) output.appendLine(`\nWhy: ${c.why}`);
  if (c.example?.bad) output.appendLine(`\nInstead of: ${c.example.bad}`);
  if (c.example?.good) output.appendLine(`Prefer:     ${c.example.good}`);
  if (c.kata) output.appendLine(`\nPractice: ${c.kata}`);
  output.show(true);
  void coachEvent(f, c.example ? 3 : 2, "explain", ref.uri);
  if (c.reference && !/^https?:/.test(c.reference)) {
    const root = rootOf.get(ref.uri);
    const file = root ? path.join(root, c.reference) : undefined;
    if (file && fs.existsSync(file)) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
  } else if (c.reference) output.appendLine(`Reference: ${c.reference}`);
  if (c.kata) void offerKata(c.kata, f.ruleId, ref.uri);
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; json(): Promise<any> }>;

/** Record a finished kata (adds a kata URL to the team library when it is new). Best effort. */
export async function kataDoneRequest(serverUrl: string, key: string | undefined, kataUrl: string, developer: string | undefined, ruleId: string | undefined, f: FetchLike = fetch as unknown as FetchLike): Promise<boolean> {
  const base = serverUrl.replace(/\/$/, "");
  const headers = { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) };
  try {
    const list = await (await f(`${base}/v1/katas`, { headers })).json();
    let kata = (list?.katas ?? []).find((k: { id: string; url: string }) => k.url === kataUrl);
    if (!kata) {
      const title = decodeURIComponent(kataUrl.split("/").pop() ?? kataUrl).replace(/\.html?$/, "").replace(/[_-]+/g, " ");
      kata = await (await f(`${base}/v1/katas`, { method: "POST", headers, body: JSON.stringify({ title, url: kataUrl, ruleId }) })).json();
    }
    if (!kata?.id) return false;
    return (await f(`${base}/v1/katas/${kata.id}/complete`, { method: "POST", headers, body: JSON.stringify({ developer }) })).ok;
  } catch {
    return false;
  }
}

/** After an explanation with a kata: open it, or mark it done (feeds the Katas page). */
async function offerKata(kata: string, ruleId: string, uri: string) {
  const pick = await vscode.window.showInformationMessage?.(`Practice for ${ruleId}: a short kata.`, "Open kata", "Mark kata done");
  if (pick === "Open kata") await vscode.env?.openExternal?.(vscode.Uri.parse(kata));
  if (pick === "Mark kata done") {
    const { serverUrl } = cfg();
    if (!serverUrl || !extCtx) return void vscode.window.showWarningMessage("Copal: set copal.serverUrl to record katas.");
    const root = rootOf.get(uri);
    const ok = await kataDoneRequest(serverUrl, await extCtx.secrets.get("copal.apiKey"), kata, root ? gitAuthor(root) : undefined, ruleId);
    void vscode.window.showInformationMessage(ok ? "Copal: kata recorded. Nice work." : "Copal: could not record the kata (server unreachable).");
  }
}

// ---------------------------------------------------------------- review my change
function gitOut(args: string[], cwd: string): string | undefined {
  try {
    return require("node:child_process").execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

/** The developer's change right now: branch + uncommitted + new files, against origin/main, main or master. */
function workingTreeChanges(root: string, base?: string) {
  const ref = base ?? ["origin/main", "main", "master"].find((b) => gitOut(["rev-parse", "--verify", "--quiet", b], root)) ?? "HEAD";
  const mb = (gitOut(["merge-base", ref, "HEAD"], root) ?? ref).trim();
  const changes = parseUnifiedDiff(gitOut(["diff", "--no-color", "--no-ext-diff", "-U0", "--diff-filter=ACMR", mb], root) ?? "");
  for (const p of (gitOut(["ls-files", "--others", "--exclude-standard"], root) ?? "").split("\n").filter(Boolean)) {
    try {
      changes.push(fileAsChange(p, fs.readFileSync(path.join(root, p), "utf8")));
    } catch {
      /* unreadable */
    }
  }
  // full contents help the engine (imports, smells)
  return {
    base: ref,
    changes: changes.map((c) => {
      try {
        return { ...c, content: c.content ?? fs.readFileSync(path.join(root, c.path), "utf8") };
      } catch {
        return c;
      }
    }),
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ACTION_COMMAND: Record<string, string> = { "Ask me": "copal.ask", Explain: "copal.explain", "Show me": "copal.showMe" };

/** Hint cards as HTML — the same content and order as the PR comment: signal, question, then the ladder. */
export function reviewHtml(cards: ReviewCard[], scope: ScopeItem[], base: string): string {
  const card = (c: ReviewCard) =>
    `<section class="card ${c.blocking ? "blocking" : ""}"><h3>${esc(c.title)}</h3><div class="loc">${esc(c.location)}</div><p>${esc(c.signal)}</p>${
      c.question ? `<p class="q">${esc(c.question)}</p>` : ""
    }<div class="actions">${c.actions
      .map((a) => `<button data-command="${ACTION_COMMAND[a]}" data-rule="${esc(c.ruleId)}" data-file="${esc(c.file)}" data-line="${c.line}">${a}</button>`)
      .join("")}</div></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:8px 16px}
.card{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:10px 14px;margin:10px 0}
.card.blocking{border-left:3px solid var(--vscode-errorForeground)}
h3{margin:0;font-size:13px}.loc{opacity:.7;font-size:12px}.q{font-weight:600}
button{margin-right:6px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:0;padding:4px 10px;border-radius:3px;cursor:pointer}
</style></head><body>
<h2>Review my change <small>vs ${esc(base)}</small></h2>
${cards.length ? cards.map(card).join("\n") : "<p>Nothing to discuss in this change.</p>"}
${scope.length ? `<h2>Beyond the brief</h2><ul>${scope.map((i) => `<li>${esc(i.question)}</li>`).join("")}</ul>` : ""}
<script>const vscode=acquireVsCodeApi();document.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>vscode.postMessage({command:b.dataset.command,ruleId:b.dataset.rule,file:b.dataset.file,line:Number(b.dataset.line)})));</script>
</body></html>`;
}

let reviewPanel: vscode.WebviewPanel | undefined;

/** "Copal: Review my change" — engine + scope check on the working tree, shown as hint cards. No server call. */
async function reviewMyChange(rootArg?: string) {
  const start = rootArg ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!start) return void vscode.window.showWarningMessage("Copal: open a folder to review your change.");
  let loaded;
  try {
    loaded = loadPolicy(start);
  } catch {
    return void vscode.window.showWarningMessage("Copal: no .copalrules found in this workspace.");
  }
  const root = (gitOut(["rev-parse", "--show-toplevel"], loaded.root) ?? loaded.root).trim();
  const { base, changes } = workingTreeChanges(root);
  const briefFile = path.join(root, ".copal", "brief.md");
  const brief = fs.existsSync(briefFile) ? fs.readFileSync(briefFile, "utf8") : undefined;
  const r = reviewChange(changes, loaded.policy, { brief, environment: cfg().environment });
  // make the ladder commands work on files that are not open
  const byUri = new Map<string, Finding[]>();
  for (const c of r.cards) {
    const uri = vscode.Uri.file(path.join(root, c.file)).toString();
    byUri.set(uri, [...(byUri.get(uri) ?? []), c.finding]);
    rootOf.set(uri, root);
    projectOf.set(uri, loaded.policy.project);
  }
  byUri.forEach((list, uri) => findingsByUri.set(uri, list));
  if (!reviewPanel) {
    reviewPanel = vscode.window.createWebviewPanel("copalReview", "Copal · Review my change", vscode.ViewColumn.Beside, { enableScripts: true });
    reviewPanel.onDidDispose(() => (reviewPanel = undefined));
    reviewPanel.webview.onDidReceiveMessage((m: { command: string; ruleId: string; file: string; line: number }) => {
      if (!Object.values(ACTION_COMMAND).includes(m.command)) return;
      void vscode.commands.executeCommand(m.command, { uri: vscode.Uri.file(path.join(root, m.file)).toString(), ruleId: m.ruleId, line: m.line });
    });
  } else reviewPanel.reveal(vscode.ViewColumn.Beside);
  reviewPanel.webview.html = reviewHtml(r.cards, r.scope, base);
  for (const c of r.cards) void coachEvent(c.finding, c.question ? 1 : 0, "shown", vscode.Uri.file(path.join(root, c.file)).toString());
}

/** Level 4: apply the pattern correction if there is one, otherwise show the fix in words. Recorded. */
async function showMe(ref: FindingRef) {
  const f = findingFor(ref);
  if (!f) return;
  void coachEvent(f, 4, "show_me", ref.uri);
  const d = vscode.workspace.textDocuments.find((x) => x.uri.toString() === ref.uri);
  if (f.suggestion && d) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(d.uri, d.lineAt(f.line - 1).range, f.suggestion.replacement);
    await vscode.workspace.applyEdit(edit);
    return;
  }
  output.clear();
  output.appendLine(`Copal · Show me · ${f.ruleId}`);
  output.appendLine(hintCard(f).fix ?? "No fix is defined for this rule — ask your lead to add one.");
  output.show(true);
}

/** Navigator: up to 3 questions before the AI builds a feature; the brief goes to the clipboard for the assistant. */
async function pair() {
  const d = vscode.window.activeTextEditor?.document;
  const p = d ? policyFor(d) : null;
  const task = await vscode.window.showInputBox({ title: "Copal · Pair on a task", prompt: "What are you about to ask the AI to build?", ignoreFocusOut: true });
  if (!task) return;
  const s = navigatorQuestions(p?.policy, task, { force: true });
  const answers: { id: string; text: string }[] = [];
  for (const [i, q] of s.questions.entries()) {
    const a = await vscode.window.showInputBox({ title: `Copal navigator ${i + 1}/${s.questions.length}`, prompt: q.text, placeHolder: "Empty = skip", ignoreFocusOut: true });
    if (a === undefined) break;
    if (a.trim()) answers.push({ id: q.id, text: a.trim() });
  }
  const brief = briefToText(buildBrief(p?.policy, task, s.questions, answers, answers.length === 0));
  output.clear();
  output.appendLine(brief);
  output.show(true);
  await vscode.env.clipboard.writeText(brief);
  vscode.window.showInformationMessage("Copal: brief copied — paste it into your AI assistant.");
}

const rootOf = new Map<string, string>();

/** Write the team's rules into CLAUDE.md, AGENTS.md, Cursor and Copilot instruction files (managed block). */
async function syncAgentFiles() {
  const d = vscode.window.activeTextEditor?.document ?? vscode.workspace.textDocuments.find((x) => policyFor(x));
  const p = d ? policyFor(d) : null;
  if (!p) return vscode.window.showWarningMessage("Copal: open a file under a .copalrules first.");
  const block = agentContextBlock(p.policy, p.policy.project);
  const changed: string[] = [];
  for (const t of Object.values(AGENT_CONTEXT_TARGETS)) {
    const file = path.join(p.root, t.file);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const next = mergeManagedBlock(current, block, t.header);
    if (next === current) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next);
    changed.push(t.file);
  }
  vscode.window.showInformationMessage(changed.length ? `Copal: updated ${changed.join(", ")} — commit them so every AI assistant gets your rules.` : "Copal: agent instruction files are up to date.");
}

class QuickFixes implements vscode.CodeActionProvider {
  static kinds = [vscode.CodeActionKind.QuickFix];
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const findings = findingsByUri.get(doc.uri.toString()) ?? [];
    const actions: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics.filter((x) => x.source === SOURCE)) {
      const f = findings.find((x) => x.ruleId === d.code && x.line - 1 === d.range.start.line);
      if (!f) continue;
      const ref: FindingRef = { uri: doc.uri.toString(), ruleId: f.ruleId, line: f.line };
      const coached = !!f.coach;
      if (f.coach?.question) {
        const a = new vscode.CodeAction(`Copal: Ask me (${f.ruleId})`, vscode.CodeActionKind.QuickFix);
        a.command = { title: "Ask me", command: "copal.ask", arguments: [ref] };
        a.diagnostics = [d];
        actions.push(a);
      }
      if (coached) {
        const a = new vscode.CodeAction(`Copal: Explain (${f.ruleId})`, vscode.CodeActionKind.QuickFix);
        a.command = { title: "Explain", command: "copal.explain", arguments: [ref] };
        a.diagnostics = [d];
        actions.push(a);
      }
      if (f.suggestion) {
        // Level 4. Without coaching it stays the preferred one-click correction; with coaching it is "Show me".
        const a = new vscode.CodeAction(coached ? `Copal: Show me (${f.ruleId})` : `Copal: apply correction (${f.ruleId})`, vscode.CodeActionKind.QuickFix);
        a.edit = new vscode.WorkspaceEdit();
        a.edit.replace(doc.uri, doc.lineAt(f.line - 1).range, f.suggestion.replacement);
        a.command = coached ? { title: "record", command: "copal.recordShowMe", arguments: [ref] } : undefined;
        a.diagnostics = [d];
        a.isPreferred = !coached;
        actions.push(a);
      } else if (f.fixText) {
        const a = new vscode.CodeAction(`Copal: Show me (${f.ruleId})`, vscode.CodeActionKind.QuickFix);
        a.command = { title: "Show me", command: "copal.showMe", arguments: [ref] };
        a.diagnostics = [d];
        actions.push(a);
      }
      const ignore = new vscode.CodeAction(`Copal: mark as false positive (${f.ruleId})`, vscode.CodeActionKind.QuickFix);
      ignore.edit = new vscode.WorkspaceEdit();
      const lineText = doc.lineAt(f.line - 1).text;
      const indent = lineText.slice(0, lineText.length - lineText.trimStart().length);
      const comment = /\.(py|ya?ml|sh)$/.test(doc.fileName) ? "#" : "//";
      ignore.edit.insert(doc.uri, new vscode.Position(f.line - 1, 0), `${indent}${comment} copal-ignore ${f.ruleId}\n`);
      ignore.command = { title: "record", command: "copal.recordFalsePositive", arguments: [ref] };
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
  extCtx = ctx;
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
    vscode.languages.registerHoverProvider({ scheme: "file" }, new Hovers()),
    vscode.commands.registerCommand("copal.ask", ask),
    vscode.commands.registerCommand("copal.explain", explain),
    vscode.commands.registerCommand("copal.showMe", showMe),
    vscode.commands.registerCommand("copal.recordShowMe", (ref: FindingRef) => {
      const f = findingFor(ref);
      if (f) void coachEvent(f, 4, "show_me", ref.uri);
    }),
    vscode.commands.registerCommand("copal.pair", pair),
    vscode.commands.registerCommand("copal.reviewChange", reviewMyChange),
    vscode.commands.registerCommand("copal.syncAgentFiles", syncAgentFiles),
    vscode.commands.registerCommand("copal.recordFalsePositive", (ref: FindingRef) => {
      const f = findingFor(ref);
      if (f) void coachEvent(f, 0, "false_positive", ref.uri);
    }),
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
