/**
 * Offline subset of `@types/vscode` covering exactly the API used by this extension.
 * If you install `@types/vscode` (npm i -D @types/vscode), delete this folder and remove
 * "typings" from tsconfig.json — the real typings are a strict superset.
 */
declare module "vscode" {
  export interface Disposable {
    dispose(): any;
  }
  export interface Thenable<T> extends PromiseLike<T> {}
  export class Uri {
    readonly scheme: string;
    readonly fsPath: string;
    toString(): string;
  }
  export class Position {
    constructor(line: number, character: number);
    readonly line: number;
    readonly character: number;
  }
  export class Range {
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
    readonly start: Position;
    readonly end: Position;
  }
  export interface TextLine {
    readonly text: string;
    readonly range: Range;
  }
  export interface TextDocument {
    readonly uri: Uri;
    readonly fileName: string;
    readonly lineCount: number;
    getText(): string;
    lineAt(line: number): TextLine;
  }
  export interface TextEditor {
    readonly document: TextDocument;
  }
  export interface TextDocumentChangeEvent {
    readonly document: TextDocument;
  }
  export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
  }
  export class Diagnostic {
    constructor(range: Range, message: string, severity?: DiagnosticSeverity);
    range: Range;
    message: string;
    severity: DiagnosticSeverity;
    source?: string;
    code?: string | number;
  }
  export interface DiagnosticCollection extends Disposable {
    set(uri: Uri, diagnostics: readonly Diagnostic[] | undefined): void;
    delete(uri: Uri): void;
  }
  export class CodeActionKind {
    static readonly QuickFix: CodeActionKind;
  }
  export class WorkspaceEdit {
    replace(uri: Uri, range: Range, newText: string): void;
    insert(uri: Uri, position: Position, newText: string): void;
  }
  export class CodeAction {
    constructor(title: string, kind?: CodeActionKind);
    edit?: WorkspaceEdit;
    diagnostics?: Diagnostic[];
    isPreferred?: boolean;
  }
  export interface CodeActionContext {
    readonly diagnostics: readonly Diagnostic[];
  }
  export interface CodeActionProvider {
    provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token?: unknown): CodeAction[] | undefined;
  }
  export interface Event<T> {
    (listener: (e: T) => any): Disposable;
  }
  export interface WorkspaceConfiguration {
    get<T>(section: string, defaultValue: T): T;
  }
  export interface OutputChannel extends Disposable {
    append(value: string): void;
    appendLine(value: string): void;
    clear(): void;
    show(preserveFocus?: boolean): void;
  }
  export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
  }
  export interface StatusBarItem extends Disposable {
    text: string;
    tooltip: string | undefined;
    command: string | undefined;
    show(): void;
    hide(): void;
  }
  export interface SecretStorage {
    get(key: string): Thenable<string | undefined>;
    store(key: string, value: string): Thenable<void>;
  }
  export interface ExtensionContext {
    readonly subscriptions: { dispose(): any }[];
    readonly secrets: SecretStorage;
  }
  export interface InputBoxOptions {
    prompt?: string;
    password?: boolean;
    placeHolder?: string;
  }
  export namespace languages {
    function createDiagnosticCollection(name?: string): DiagnosticCollection;
    function registerCodeActionsProvider(selector: { scheme?: string; language?: string }, provider: CodeActionProvider, metadata?: { providedCodeActionKinds?: readonly CodeActionKind[] }): Disposable;
  }
  export namespace workspace {
    const textDocuments: readonly TextDocument[];
    function getConfiguration(section?: string): WorkspaceConfiguration;
    function findFiles(include: string, exclude?: string, maxResults?: number): Thenable<Uri[]>;
    function openTextDocument(uri: Uri): Thenable<TextDocument>;
    const onDidOpenTextDocument: Event<TextDocument>;
    const onDidSaveTextDocument: Event<TextDocument>;
    const onDidCloseTextDocument: Event<TextDocument>;
    const onDidChangeTextDocument: Event<TextDocumentChangeEvent>;
  }
  export namespace window {
    const activeTextEditor: TextEditor | undefined;
    function createOutputChannel(name: string): OutputChannel;
    function createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;
    function showInformationMessage(message: string): Thenable<string | undefined>;
    function showWarningMessage(message: string): Thenable<string | undefined>;
    function showInputBox(options?: InputBoxOptions): Thenable<string | undefined>;
  }
  export namespace commands {
    function registerCommand(command: string, callback: (...args: any[]) => any): Disposable;
  }
}
