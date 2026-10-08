#!/usr/bin/env node
/**
 * Builds the isomorphic entry (src/isomorphic.ts) into:
 *   esm/copal-core.mjs   single ES module, no Node built-ins (Deno / Supabase Edge, browsers, Bun, Node)
 *   esm/copal-core.d.ts  single self-contained declaration file (+ identical .d.mts)
 * Usage: node scripts/build-esm.mjs [--check]   (--check fails if the committed files are stale)
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const outDir = path.join(root, "esm");
const check = process.argv.includes("--check");
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const banner = `/*! @copal/core ${pkg.version} — Copal rule engine (isomorphic build). https://github.com/benoitrion/copal-sandbox */`;

// ---- JS bundle
const js = esbuild.buildSync({
  entryPoints: [path.join(root, "src/isomorphic.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2020",
  external: ["yaml"],
  write: false,
  banner: { js: banner },
  logLevel: "error",
}).outputFiles[0].text;
if (/from\s*["']node:|require\(["']node:/.test(js)) throw new Error("isomorphic bundle must not import Node built-ins");

// ---- single declaration file: emit per-module .d.ts, then merge into one module
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "copal-dts-"));
const tsc = require.resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "--declaration", "--emitDeclarationOnly", "--strict", "--skipLibCheck",
  "--target", "es2020", "--module", "esnext", "--moduleResolution", "bundler", "--types", "node",
  "--typeRoots", path.join(root, "../../node_modules/@types"), "--outDir", tmp,
  path.join(root, "src/isomorphic.ts")], { stdio: "inherit", cwd: tmp }); // cwd: no tsconfig around (TS 6 refuses CLI files next to one)
const order = ["types", "yaml", "glob", "posix", "policy", "diff", "engine", "format"];
const parts = order
  .filter((m) => fs.existsSync(path.join(tmp, `${m}.d.ts`)))
  .map((m) => {
    const body = fs
      .readFileSync(path.join(tmp, `${m}.d.ts`), "utf8")
      .replace(/^import .* from "\.\/[\w-]+";\s*$/gm, "") // local imports: everything lives in one file now
      .replace(/^export \* from "\.\/[\w-]+";\s*$/gm, "")
      .replace(/^import \* as (\w+) from "\.\/[\w-]+";\s*$/gm, "")
      .trim();
    return `// ---- ${m}\n${body}`;
  });
fs.rmSync(tmp, { recursive: true, force: true });
const dts = `${banner}\n${parts.join("\n\n")}\nexport {};\n`;

// ---- write or compare
// .d.mts too, so `import "./copal-core.mjs"` picks up types without a mapping
const files = { "copal-core.mjs": js, "copal-core.d.ts": dts, "copal-core.d.mts": dts };
let stale = [];
for (const [name, content] of Object.entries(files)) {
  const p = path.join(outDir, name);
  if (check) {
    if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== content) stale.push(name);
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(p, content);
  }
}
if (check && stale.length) {
  console.error(`esm/ is stale (${stale.join(", ")}): run \`npm run build:esm -w packages/core\` and commit.`);
  process.exit(1);
}
console.log(check ? "esm/ is up to date" : `wrote esm/copal-core.mjs (${(js.length / 1024).toFixed(1)} KB) and esm/copal-core.d.ts`);
