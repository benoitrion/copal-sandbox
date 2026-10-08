import * as http from "node:http";

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  rawBody: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Route {
  method: string;
  rx: RegExp;
  keys: string[];
  handler: Handler;
}

/** Minimal router: "/v1/projects/:name/policy", "*" wildcards capture the rest as params.rest. */
export class Router {
  private routes: Route[] = [];
  add(method: string, pattern: string, handler: Handler) {
    const keys: string[] = [];
    const rx = new RegExp(
      "^" +
        pattern.replace(/[.]/g, "\\.").replace(/:(\w+)|\*/g, (m, k) => {
          keys.push(k ?? "rest");
          return k ? "([^/]+)" : "(.*)";
        }) +
        "/?$",
    );
    this.routes.push({ method, rx, keys, handler });
    return this;
  }
  get = (p: string, h: Handler) => this.add("GET", p, h);
  post = (p: string, h: Handler) => this.add("POST", p, h);
  put = (p: string, h: Handler) => this.add("PUT", p, h);

  async handle(req: http.IncomingMessage, res: http.ServerResponse, before?: (ctx: Ctx) => void) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    try {
      for (const r of this.routes) {
        if (r.method !== req.method) continue;
        const m = r.rx.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        let body: any = undefined;
        if (rawBody && (req.headers["content-type"] ?? "").includes("json")) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            throw new HttpError(400, "invalid JSON body");
          }
        }
        const ctx: Ctx = { req, res, params, query: url.searchParams, body, rawBody };
        before?.(ctx);
        const out = await r.handler(ctx);
        if (res.writableEnded) return;
        if (typeof out === "string") {
          res.writeHead(200, { "content-type": out.startsWith("<!doctype") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" });
          res.end(out);
        } else send(res, res.statusCode || 200, out ?? { ok: true });
        return;
      }
      throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: (e as Error).message });
    }
  }
}

export function send(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(data, null, 2));
}
