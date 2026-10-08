/**
 * The published single-file ES module (esm/copal-core.mjs) must behave exactly like the source build.
 * Runs every billing-api scenario in both environments through both and compares the findings.
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as src from "../src";

const ROOT = path.resolve(__dirname, "../..");
const APP = path.resolve(ROOT, "../../examples/billing-api");

function scenarioFiles(name: string) {
  const dir = path.join(APP, "scenarios", name);
  const out: { path: string; content: string }[] = [];
  const walk = (d: string) =>
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name !== "DESCRIPTION.md") out.push({ path: path.relative(dir, p).split(path.sep).join("/"), content: fs.readFileSync(p, "utf8") });
    });
  walk(dir);
  return out;
}

function run(c: typeof src, policyText: string) {
  const policy = c.resolvePolicy(c.parsePolicy(policyText));
  const out: Record<string, unknown> = {};
  for (const name of fs.readdirSync(path.join(APP, "scenarios")).sort()) {
    for (const environment of ["local", "ci"]) {
      const r = c.evaluate(scenarioFiles(name).map((f) => c.fileAsChange(f.path, f.content)), policy, { environment });
      out[`${name}/${environment}`] = r.findings;
    }
  }
  out.redact = c.redact('k="AKIA4XQZ3P7Q2LM57Z2M" iban BE71096123456769', policy);
  return out;
}

test("esm bundle has no Node built-ins and matches the source build", async () => {
  const bundlePath = path.join(ROOT, "esm/copal-core.mjs");
  const code = fs.readFileSync(bundlePath, "utf8");
  assert.ok(!/from\s*["']node:/.test(code), "bundle imports a Node built-in");
  const esm = (await import(pathToFileURL(bundlePath).href)) as typeof src;
  const policyText = fs.readFileSync(path.join(APP, ".copalrules"), "utf8");
  assert.deepEqual(run(esm, policyText), run(src, policyText));
});

test("file extends are refused without a loader (servers receiving policy text)", () => {
  assert.throws(() => src.resolvePolicy(src.parsePolicy("version: 3\nextends: [../org.copalrules]\nrules: []\n")), /only builtin/);
});
