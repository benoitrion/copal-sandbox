import { test } from "node:test";
import * as assert from "node:assert/strict";
import { agentContextBlock, FileChange, parseBriefMarkdown, parsePolicy, REPORT_RULE, requestCheckContext, resolvePolicy, scopeCheck } from "../src";

const BRIEF = `# Task: Add VAT to invoice totals

Scope in: the total calculation in src/invoice
Scope out: the PDF and the database

## Examples
- [ ] 100 EUR net (BE) → 121 EUR gross
- [x] negative amount → error
- [ ] unknown country → error

Done when: every example above passes as a test, existing tests stay green, nothing beyond the examples.
Next: make "100 EUR net (BE) → 121 EUR gross" pass
`;

const added = (path: string, lines: string[]): FileChange => ({ path, status: "added", addedLines: lines.map((text, i) => ({ line: i + 1, text })) });
const modified = (path: string, lines: string[]): FileChange => ({ ...added(path, lines), status: "modified" });

test("parseBriefMarkdown reads task, scope and examples (with done state)", () => {
  const b = parseBriefMarkdown(BRIEF);
  assert.equal(b.task, "Add VAT to invoice totals");
  assert.deepEqual(b.scope, { in: "the total calculation in src/invoice", out: "the PDF and the database" });
  assert.deepEqual(b.examples.map((e) => [e.text, e.done]), [
    ["100 EUR net (BE) → 121 EUR gross", false],
    ["negative amount → error", true],
    ["unknown country → error", false],
  ]);
  assert.equal(b.next, 'make "100 EUR net (BE) → 121 EUR gross" pass');
});

test("a diff covering only VAT lists nothing", () => {
  const items = scopeCheck(BRIEF, [
    added("src/invoice/vat.ts", ["export function vatFor(country: string, net: number) {", "}"]),
    modified("src/invoice/total.ts", ["  const gross = net + vatFor(country, net);"]),
    added("test/invoice/vat.test.ts", ["test('100 EUR net (BE) → 121 EUR gross', () => {});"]),
  ]);
  assert.deepEqual(items, []);
});

test("a settings page added beyond the brief is listed as a question; never blocking", () => {
  const items = scopeCheck(BRIEF, [
    added("src/invoice/vat.ts", ["export function vatFor(country: string, net: number) {}"]),
    added("src/web/settings-page.ts", ["export function renderSettingsPage() {}", "router.get('/settings', renderSettingsPage);"]),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].file, "src/web/settings-page.ts");
  assert.equal(items[0].question, "Not in the brief: src/web/settings-page.ts — keep it?");
  assert.deepEqual(items[0].details, ["new export renderSettingsPage", "new endpoint GET /settings"]);
});

test("touching what the brief says not to touch is asked about", () => {
  const items = scopeCheck(BRIEF, [modified("src/pdf/invoice-pdf.ts", ["  drawVat(total);"])]);
  assert.equal(items.length, 1);
  assert.match(items[0].question, /brief says not to touch "the PDF and the database"/);
});

test("report rule in the hook context and the sync-context block", () => {
  assert.match(REPORT_RULE, /Assumptions I made that you didn't state/);
  assert.match(REPORT_RULE, /Things I added beyond the agreed examples/);
  assert.ok(requestCheckContext("Add VAT to invoice totals.")!.includes(REPORT_RULE));
  assert.ok(agentContextBlock(resolvePolicy(parsePolicy("version: 4\nrules: []\n"))).includes(REPORT_RULE));
});
