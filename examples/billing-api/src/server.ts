/**
 * Composition root: wires persistence → service → web and serves the routes over node:http.
 * Run with `npm start` (PORT, default 3000).
 */
import * as http from "node:http";
import { Db, InvoiceRepo } from "./persistence/invoice-repo";
import { InvoiceService } from "./service/invoice-service";
import { invoiceRoutes } from "./web/invoice-controller";

type Handler = (req: { params: Record<string, string>; body: unknown }) => unknown;
interface Route {
  method: string;
  rx: RegExp;
  keys: string[];
  handler: Handler;
}

class App {
  routes: Route[] = [];
  private add(method: string, pattern: string, handler: Handler) {
    const keys: string[] = [];
    const rx = new RegExp("^" + pattern.replace(/:(\w+)/g, (_m: string, k: string) => (keys.push(k), "([^/]+)")) + "$");
    this.routes.push({ method, rx, keys, handler });
  }
  get = (pattern: string, handler: Handler) => this.add("GET", pattern, handler);
  post = (pattern: string, handler: Handler) => this.add("POST", pattern, handler);
}

/** In-memory database with a few seeded invoices. */
const rows = [
  { id: "inv-1001", customer_id: "c-42", total: 120.5, status: "paid" },
  { id: "inv-1002", customer_id: "c-42", total: 89.99, status: "open" },
  { id: "inv-2001", customer_id: "c-7", total: 15, status: "open" },
];
const db: Db = {
  async query(_sql: string, params?: unknown[]) {
    return rows.filter((r) => r.customer_id === params?.[0]);
  },
};

const app = new App();
app.get("/health", () => ({ ok: true, service: "billing-api" }));
invoiceRoutes(app, new InvoiceService(new InvoiceRepo(db)));

function send(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = app.routes.find((r) => r.method === req.method && r.rx.test(url.pathname));
  if (!route) return send(res, 404, { error: "not found" });
  const m = route.rx.exec(url.pathname)!;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: unknown = undefined;
  try {
    body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
  } catch {
    return send(res, 400, { error: "invalid JSON" });
  }
  try {
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    send(res, 200, await route.handler({ params, body }));
  } catch (e) {
    send(res, 500, { error: (e as Error).message });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => process.stdout.write(`billing-api listening on http://localhost:${port}\n`));
