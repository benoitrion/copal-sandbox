/**
 * Minimal MCP (Model Context Protocol) server over stdio — JSON-RPC 2.0, newline-delimited.
 * Implements: initialize, ping, tools/list, tools/call, resources/list, resources/read, prompts/list, prompts/get.
 * Dependency-free so it runs anywhere; swap for @modelcontextprotocol/sdk if you prefer.
 */
import * as readline from "node:readline";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  handler: (args: Record<string, any>) => Promise<ToolResult> | ToolResult;
}
export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}
export interface ResourceDef {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  read: () => Promise<string> | string;
}
export interface PromptDef {
  name: string;
  description: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
  get: (args: Record<string, string>) => { role: "user" | "assistant"; content: { type: "text"; text: string } }[];
}

type Json = Record<string, any>;

export class McpServer {
  private tools = new Map<string, ToolDef>();
  private resources = new Map<string, ResourceDef>();
  private prompts = new Map<string, PromptDef>();
  clientInfo?: { name: string; version?: string };

  constructor(private info: { name: string; version: string }, private instructions?: string) {}

  tool(t: ToolDef) {
    this.tools.set(t.name, t);
  }
  resource(r: ResourceDef) {
    this.resources.set(r.uri, r);
  }
  prompt(p: PromptDef) {
    this.prompts.set(p.name, p);
  }

  async handle(msg: Json): Promise<Json | null> {
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;
    try {
      const result = await this.dispatch(method, params ?? {});
      return isNotification ? null : { jsonrpc: "2.0", id, result };
    } catch (e) {
      if (isNotification) return null;
      const code = (e as { code?: number }).code ?? -32603;
      return { jsonrpc: "2.0", id, error: { code, message: (e as Error).message } };
    }
  }

  private async dispatch(method: string, p: Json): Promise<unknown> {
    switch (method) {
      case "initialize": {
        this.clientInfo = p.clientInfo;
        const requested = p.protocolVersion as string;
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: this.info,
          instructions: this.instructions,
        };
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return {};
      case "ping":
        return {};
      case "tools/list":
        return { tools: [...this.tools.values()].map(({ handler, ...t }) => t) };
      case "tools/call": {
        const t = this.tools.get(p.name);
        if (!t) throw Object.assign(new Error(`unknown tool ${p.name}`), { code: -32602 });
        try {
          return await t.handler(p.arguments ?? {});
        } catch (e) {
          return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
        }
      }
      case "resources/list":
        return { resources: [...this.resources.values()].map(({ read, ...r }) => r) };
      case "resources/read": {
        const r = this.resources.get(p.uri);
        if (!r) throw Object.assign(new Error(`unknown resource ${p.uri}`), { code: -32002 });
        return { contents: [{ uri: r.uri, mimeType: r.mimeType ?? "text/plain", text: await r.read() }] };
      }
      case "prompts/list":
        return { prompts: [...this.prompts.values()].map(({ get, ...x }) => x) };
      case "prompts/get": {
        const pr = this.prompts.get(p.name);
        if (!pr) throw Object.assign(new Error(`unknown prompt ${p.name}`), { code: -32602 });
        return { description: pr.description, messages: pr.get(p.arguments ?? {}) };
      }
      default:
        throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
    }
  }

  /** Serve over stdin/stdout. All logs must go to stderr. */
  listen() {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", async (line) => {
      if (!line.trim()) return;
      let msg: Json;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n");
        return;
      }
      const batch = Array.isArray(msg) ? msg : [msg];
      const out = (await Promise.all(batch.map((m) => this.handle(m)))).filter(Boolean);
      if (out.length) process.stdout.write(JSON.stringify(Array.isArray(msg) ? out : out[0]) + "\n");
    });
    rl.on("close", () => process.exit(0));
  }
}

export const text = (t: string, structured?: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(structured !== undefined ? { structuredContent: structured } : {}),
  ...(isError ? { isError } : {}),
});
