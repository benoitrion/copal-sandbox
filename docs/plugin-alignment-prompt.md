# Align the Copal plugins and integrations with the "technical mentor in the IDE" product

Prompt for a coding session (Claude Code) on github.com/benoitrion/copal-sandbox. Product reference: the white paper
"Copal — The AI Technical Mentor in Your IDE".

## How to work (non-negotiable)
- Build **only** what is listed in the current step. Do not add features, endpoints, pages or options that are not
  asked for. When something is unclear, **stop and ask**; do not assume.
- Work test-first: for each step, write the failing tests from the acceptance examples, then the simplest code.
- Small commits; after each step, report what changed, what you assumed, and anything you added beyond the step.
- Keep everything that is not mentioned unchanged. Existing tests (`npm test`, `scripts/e2e.sh`, `scripts/api-test.mjs`
  against the reference server, `scripts/mcp-smoke.mjs`, the JetBrains Gradle build in CI) must stay green.

## Step 0 — Freeze (no deletions)
- Mark the reference server's growth, usage, katas, reach and rule-health endpoints and the console tabs as
  **frozen** in the README ("not part of the current product; kept for the API contract"). Do not delete code.
- README intro rewritten to the positioning: "Copal is a technical mentor inside the IDE — it reviews code while you
  write it, with or without AI, and helps you ask AI for the right thing."
Done when: README reflects the product; all tests unchanged and green.

## Step 1 — Request check (Claude Code hook)
In `copal claude-hook` (UserPromptSubmit):
- Detect whether a request states a **goal**, a **scope / what not to touch** and a **definition of done**
  (heuristics in `@copal/core`, e.g. `requestGaps(prompt): ("goal"|"scope"|"done")[]`).
- Small or clear requests (typo, rename, question, request mentioning scope and done): no output.
- Otherwise add context asking Claude to ask the developer **one** question about the most important gap first.
- "Continue"-style requests: if a brief exists in `.copal/brief.md`, offer its next step as option 1.
- "just do it" / "skip" bypasses.
Acceptance examples (tests):
- "Add VAT to invoice totals." → gaps include "scope"; one question about what not to touch.
- "Continue the implementation." → gap "goal"; question offers the brief's next step when a brief exists.
- "Fix the rounding bug in InvoiceTotal.compute: 10.005 should round to 10.01. Only change that method; existing tests
  must pass." → no gaps, no output.
- "rename foo to bar" → no output.

## Step 2 — Examples first + brief file
- Extend the navigator/brief (`navigatorQuestions`, `buildBrief`) so answers produce 2–4 **examples** (input →
  expected) saved in `.copal/brief.md` with: task, scope (in / out), examples, done-when.
- The generated instruction (hook context and `sync-context` block) tells the AI: write the examples as failing tests,
  show them, wait for the developer's OK, then implement in small steps until they pass, nothing more.
Acceptance: brief file written with the three VAT examples from the white paper; instruction text contains the
"wait for OK" and "nothing beyond the examples" rules.

## Step 3 — Assumption and beyond-scope report
- Add to the `sync-context` block and the hook context: "End every task with two lists: *Assumptions I made that you
  didn't state* and *Things I added beyond the agreed examples*."
- New CLI command `copal scope-check [--base REF]`: compares the diff with `.copal/brief.md` and lists new files,
  new exported functions/endpoints and changed areas not covered by an example or the in-scope list, as questions
  ("Not in the brief: src/web/settings-page.ts — keep it?"). Never blocks.
- PR bot: when the repo has `.copal/brief.md`, add the same list to the review summary.
Acceptance: on a fixture repo where the brief covers VAT only and the diff adds a settings page, the settings page is
listed; a diff covering only VAT lists nothing.

## Step 4 — Tests-first check
- Extend `requireTest` evaluation in the PR/CI path: report (audit) when implementation files of the change were
  committed **before** their tests (commit order on the branch). Message as a question with the ladder.
Acceptance: branch with test commit before code → clean; code commit before test → one audit finding.

## Step 5 — "Review my change" in the IDEs
- VS Code command and JetBrains action **Review my change**: run the engine on the working-tree diff vs the base branch
  (reuse `copal check --base` / `--json`) plus `copal scope-check`, and show results as hint cards in a panel
  (same format as PR comments). No server call required.
Acceptance: on billing-api scenario 01 the panel lists ledger-rounding, invoice-contract-test and
hardcoded-credentials as hint cards with Ask me / Explain / Show me.

## Step 6 — JetBrains task panel (repurpose "Copal Pair")
- The tool window shows the current `.copal/brief.md` (task, scope, examples with test status from the last test run if
  available) and the last scope-check result. Buttons: New task (runs the navigator via CLI), Review my change.
- No own AI connection yet (that is a later phase); the panel works with any AI assistant through the brief file.
Acceptance: Kotlin model tests for parsing the brief; CI Gradle build green.

## Out of scope for this round
Dashboards, statistics, weekly note, mob mode, the plugin's own AI connection, server changes, pricing, any change to
Lovable.

## Deliverables per step
Code + tests, README section for the feature, and the end-of-step report (changed / assumed / added beyond the step).
