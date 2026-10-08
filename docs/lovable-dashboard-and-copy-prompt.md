# Copal: one-screen dashboard + honest landing copy

Replaces all earlier dashboard prompts (pivot phases 1 and 4, "restore", "four sections").

## Goal and rule
Copal helps developers prompt AI better — better results, less slop, fewer tokens — and understand the code they ship.
**The dashboard answers only the questions a lead asks every week, with data Copal has today, and every row leads to
an action.** If a page fails one of these three tests, it does not exist.
Do not reinvent the wheel: no quality-gate engine (link to SonarQube/CI), no learning platform (katas are links),
no PR inbox (PRs are handled in GitHub/GitLab), no per-person scoring, no cost-per-change until sessions are linked to commits.

## Non-negotiables
- /api/public/v1 must keep passing scripts/api-test.mjs (github.com/benoitrion/copal-sandbox): now 33 checks
  (25 contract + 8 coaching). Reference implementation: apps/mock-server in copal-sandbox.
- Engine: @copal/core core-v0.2.0 (https://cdn.jsdelivr.net/gh/benoitrion/copal-sandbox@core-v0.2.0/packages/core/esm/copal-core.mjs).
- Never display or log API keys/secrets. No app content depends on the "Add VAT" example.

## Navigation (final)
**Dashboard** · **Rules** · **Checks** · **Settings**. Remove: Overview, Growth, Katas & learning hours (standalone),
AI usage, Activity, savings calculator, narrative example cards. Old routes redirect to Dashboard.

---

## A. Dashboard — one screen, three blocks (project selector + period selector 7/30/90 days)

### Block 1 — Reach: "Are our standards reaching the developers and the AI?"
New endpoint `GET /v1/reach?project=` (shape in the reference server):
`{ precommit:{lastSeen}, prCheck:{lastSeen}, agentSelfCheck:{lastSeen}, ide:{heartbeats}, agents:{<name>:{sessions,lastSeen}}, navigator:{sessions,answered,skipped} }`
One line of status chips: ● pre-commit (last seen) · ● PR check · ● agents via MCP (sessions per agent) · ● navigator
(asked / answered / skipped) · ● IDE. A grey chip = "not seen yet" + a [Set up] button opening the snippet:
- pre-commit: `copal login --server … && copal hook install`
- PR check: the GitHub Action / GitLab job snippet
- agents: MCP config + **`copal sync-context`** (writes the rules into CLAUDE.md, AGENTS.md, Cursor and Copilot
  instruction files; `copal sync-context --check` in CI fails when they are out of date)
- Claude Code navigator: `copal hook install --claude`

### Block 2 — Rules that need attention: "Which standards aren't working?"
New endpoint `GET /v1/rules/health?project=&days=` → `{ rules: [{ ruleId, mode, hits, trend: up|down|flat,
caughtLate: 0–1|null, falsePositiveRate: 0–1|null, lastSeen, status: [recurring|noisy|caught-late|silent|uncoached], kata }] }`.
Definitions (same as the reference server):
- **caught late** = share of the rule's findings first seen in a PR/CI check rather than in the editor, the agent's
  self-check or pre-commit. High = the knowledge isn't reaching the developer or the AI.
- **noisy** = false-positive rate ≥ 20 % (≥ 3 hits); **recurring** = ≥ 3 hits and not trending down;
  **silent** = no hit in 90 days; **uncoached** = no `coach.question`.
Table, rules with a status first: rule · hits · trend arrow · caught late % · false + % · status pills · **one action**:
- recurring → [Kata] (rule's kata link) · [Sharpen question] (opens the rule in Rules)
- caught-late → [Sync agent files] (setup snippet) · [Sharpen question]
- noisy → [Review feedback] (opens Checks filtered on that rule's false-positive notes)
- silent → [Retire?] (opens the rule; never auto-deletes)
- uncoached → [Add coaching]
Rules without a status collapse under "N rules healthy".

### Block 3 — This week: "What happened?"
Latest 10 analyses (`GET /v1/analyses?project=&limit=10`): outcome icon (⛔ blocked · 💬 coached · ✓ clean), title/ref,
source, author, agent, counts, time. PR rows link to GitHub/GitLab. Row click → Checks detail.

## B. Rules (configuration, not dashboard)
The existing editor (`GET/PUT /v1/projects/:name/policy`, YAML tab, validation). Per rule: question, why, wrong/right
example, reference link, kata link (credited), mode, and the live **hint-card preview**. Deep-linkable per rule
(`/rules#ledger-rounding`) for the dashboard actions. Starter packs: security, quality, testing, hexagonal, clean-code.

## C. Checks (detail, reached from the dashboard)
List + detail of analyses (`GET /v1/analyses`, `/v1/analyses/:id`) with filters (source, rule, outcome). Findings
render as hint cards (question first; Explain and Show me collapsed; kata link). Per finding: **False positive** /
**Accepted** with a note (`POST /v1/analyses/:id/feedback`) — this feeds the "noisy" status.

## D. Settings
Projects, API keys (create/revoke, never re-display), data controls (redaction patterns), privacy, integrations
(optional SonarQube/SonarCloud key or CI status URL → shown as a link next to the repo, never recomputed).

## E. Mock mode data
3 projects (TypeScript/Node, Java/Spring with hexagonal pack, Angular); 8 weeks; mixed sources (precommit, pr, ci, mcp)
and agents; so that the table shows at least one rule per status (recurring, noisy with notes, caught-late, silent,
uncoached) and one surface "not seen yet". Label it "Sample data".

---

## F. Landing page copy changes (every promise must have something behind it)
1. **How it works, step 5** — replace "Measure growth by rule category, test-first ratio, recurring findings, and AI
   spend per merged change" with:
   **Keep the rules alive.** "Copal shows which rules keep recurring, which ones reach review too late, which developers
   flag as wrong, and which never fire — so your standards get sharper with every review."
2. **Add a step before the navigator** — **Your AI reads your standards.** "`copal sync-context` writes your team's rules
   into CLAUDE.md, AGENTS.md, Cursor and Copilot instructions, so every assistant starts with your context."
3. **Navigator claim** — replace "clearer briefs mean fewer retries and fewer tokens" with "Designed to cut retries and
   tokens — the pilot measures it on your team."
4. **Blocking** — replace "only security issues block" with "Only the rules your lead chooses to enforce block —
   security by default."
5. **Step 1** — add: "Rules grow from review: when the same review comment comes back, turn it into a rule with a
   question and a reference."
6. **Demo section** — point to billing-api PR #6 (question-first review comments on the v4 rules) instead of PRs #1–#4,
   and make the demo project viewable **read-only without sign-in**.
7. **Trust section** — "Self-hosting and air-gapped deployment are available" → "Self-hosting on request (Enterprise)".
8. **Pricing, Team tier** — features: "Coaching rules with references and katas · navigator · IDE hint ladder · agent
   instruction sync · rule-health dashboard · email support". Remove "growth / test-first / AI-usage pages".
   Billing line: "Billed per developer whose commits or pull requests Copal checked that month."
9. **Pricing, free tier** — label "Free" (not "Open core") until the repository carries an open-source licence.
10. **Pilot** — "Prove it on one team in 6 weeks: fewer findings reaching review, fewer repeat mistakes, rules your
    team trusts (false positives down), and the team's own verdict on AI retries."
Keep unchanged: hero, the three cited statistics, "A coach, not a gatekeeper or a monitor", the comparison table, footer.

## Acceptance criteria
- Navigation is exactly Dashboard · Rules · Checks · Settings; removed pages are gone and redirect.
- Dashboard renders the three blocks from `/v1/reach`, `/v1/rules/health`, `/v1/analyses`; every table row and chip has an action.
- `/v1/reach` and `/v1/rules/health` match the reference server's shapes; api-test 33/33 against the real backend.
- Landing copy contains none of: "test-first ratio", "AI spend per merged change", "only security issues block",
  "air-gapped deployment are available", "Open core" (until licensed).

Work in this order: endpoints → Dashboard → Checks feedback → Rules deep links → copy. After each, confirm the contract test still passes.
