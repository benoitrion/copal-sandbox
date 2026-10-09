# Copal: Grammarly-style landing page + account-only app

Replaces every earlier landing and dashboard prompt. Positioning: **Copal is a technical mentor inside the IDE — it
reviews code while you write it, with or without AI, and helps you ask AI for the right thing.**

## Who builds what (unchanged)
Lovable owns the website, the account area (sign-in, keys, early access) and the `/api/public/v1` storage endpoints.
Everything else — engine `@copal/core`, IDE plugins, CLI, Claude Code integration, MCP, PR bot — lives in
github.com/benoitrion/copal-sandbox. Do not rebuild any of it. Keep `/api/public/v1` passing `scripts/api-test.mjs`.

## 1. Remove
- Dashboard, Activity, Checks lists, Rules editor, Growth, AI usage, rule health tables, the savings calculator,
  narrative example cards, any "Mock data" view, and the "Edit with Lovable" badge on public pages.
- Old routes redirect to `/`.

## 2. App (signed in) = account only
- **Account & keys:** device keys (create, revoke, never re-display).
- **Set up:** short install steps with links to the docs: IntelliJ plugin, VS Code extension, Claude Code
  (`copal hook install --claude`), pre-commit hook, PR bot (GitHub Action / GitLab job), `copal sync-context`.
- **Rule proposals:** list of drafts posted by the PR bot (`GET /v1/rules/drafts`), each with the original comment and a
  link to the discussion; actions Approve / Dismiss (`POST /v1/rules/drafts/:id`).
- **Plan:** early-access status. No pricing checkout yet.

## 3. Landing page — layout like grammarly.com
Clean, lots of white space, one idea per section, alternating text/image blocks, product images (simple mock-ups of the
IDE are fine), a sticky "Get early access" button. Light and dark mode. No invented logos, testimonials or numbers.

### Hero
**Your technical mentor, inside your IDE.**
Copal reviews your code as you write it — with or without AI. It points out what matters, asks the question a senior
developer would ask, and explains your team's standards when you want to know why.
[Get early access] · [See it in action]
*IntelliJ · VS Code · Claude Code · GitHub & GitLab*
Image: IntelliJ editor with a Copal hint card ("Who owns rounding in this codebase?" · Ask me · Explain · Show me).

### Why Copal
**Code review comes too late.**
By the time a pull request is reviewed, the design is set, the AI has added extras nobody asked for, and the feedback
feels like criticism. Copal gives you that feedback while you're still writing — when it's easy to act on, and easy to
learn from.
Small cited strip (keep sources linked): "−17 pts comprehension when delegating to AI (Anthropic)" · "+441% median time
in review, high vs low AI adoption (Faros AI)".

### Four feature blocks (alternating image left/right)
1. **Hints as you code.** Copal highlights what your team cares about: architecture boundaries, testing, security, code
   smells. Each hint starts with a question, not a verdict. You decide how far to go.
   *Question → Explanation → Example → Fix, only when you ask.* — Image: the ladder on a hint card.
2. **A review before the review.** Ask Copal to look at your change before you open a pull request. It checks it
   against your team's standards, flags anything that looks unfinished or out of scope, and tells you what a reviewer
   would likely ask. *→ Shorter reviews, fewer rounds.* — Label: **Coming next**.
3. **Better requests, better AI code.** Working with an AI assistant? Copal notices when a request leaves out the goal,
   the scope or what "done" means, and asks one quick question. When the AI is done, it shows what it assumed and
   anything it added that you didn't ask for. *→ Less AI slop, fewer rewrites.* — Label: **Early access in Claude
   Code**. Image: the task panel with agreed examples and "Added beyond the examples: a settings page → keep or remove?".
4. **Learn as you go.** Every hint links to your team's reasoning. When the same mistake keeps coming back, Copal
   suggests a short exercise (a kata). A weekly note shows what you've improved and what to work on next.
   *→ You need it less over time. That's the point.* — Weekly note labelled **Coming next**.

### How it works (three steps, icons)
1. **Install the plugin.** IntelliJ or VS Code — two minutes.
2. **Code as usual.** Copal hints as you write and reviews before you push.
3. **Go deeper when you want.** Explanation, example, fix or exercise — one click each.

### For team leads
**Mentor your whole team at once.**
Write your architecture rules and best practices once. Copal brings them to every developer as they code, to every AI
assistant your team uses, and to every pull request on GitHub and GitLab. New joiners learn your way of working from day
one, and reviewers stop repeating themselves.
- **Team standards** — rules, references and examples in your repository
- **Pull request coach** — comments that ask before they judge; `/copal explain`, `/copal rule`
- **Pairing and mob sessions** — an AI mentor that keeps the agreed examples and notes decisions (**Coming next**)

### Built for trust
**A mentor, not a monitor.**
- **You stay in control.** Every hint can be skipped. Nothing changes without your say.
- **No scores, no rankings.** Copal helps people grow; it never rates them.
- **Your code stays private.** Secrets are removed before anything reaches an AI model.

### FAQ (accordion)
- **Is Copal another linter?** Linters tell you what's wrong. Copal asks why, explains your team's reasoning, and helps
  you learn it — so the same issue doesn't come back. Keep your linter; Copal works alongside it.
- **Do I need to use AI?** No. Hints, reviews and exercises work on any code. If you use an AI assistant, Copal also
  helps you ask it for the right thing and checks what it produced.
- **How is it different from Copilot or Junie?** They write code for you. Copal mentors you while you write it — with
  or without them.
- **What does early access include?** The IntelliJ and VS Code plugins, team standards, AI request coaching for Claude
  Code, and pull request reviews on GitHub and GitLab. "Review my change", pairing sessions and the weekly note are
  coming next.

### Final call to action
**Get a senior developer's eye on every line — while you write it.**
[Get early access] — form: name, email, role (developer / team lead / coach), IDE (IntelliJ / VS Code / other), AI
assistant used (none / Claude Code / Copilot / Cursor / other). Store in a simple table.

### Footer
"Copal — your technical mentor, inside your IDE." · Docs · GitHub · Privacy · © 2026 Copal.dev

## Acceptance criteria
- Public site = landing page + docs + early-access form; signed-in area = Account & keys, Set up, Rule proposals, Plan.
- Every "Coming next" feature is labelled as such; no claim without a matching built feature.
- No dashboard, activity list, mock data or Lovable badge anywhere public.
- `/api/public/v1` unchanged; api-test still passes.
