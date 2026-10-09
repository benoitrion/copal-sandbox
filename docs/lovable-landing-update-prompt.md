# Copal landing update: align claims with what is built, show the app, add plans

Prompt for Lovable. Applies to the public landing page only; keep the layout (Grammarly-like, one idea per section,
alternating image/text, light and dark mode), the app pages and `/api/public/v1` unchanged. No invented logos,
testimonials, numbers or prices.

## 1. Fix labels so every claim matches the product

| Section | Change |
|---|---|
| Hero | Keep. Under the buttons: *IntelliJ · VS Code · Claude Code · GitHub & GitLab*. Replace "two minutes" anywhere with "a few minutes". |
| **A review before the review** | Remove "Coming next" — it is built. New text: "Before you open a pull request, click **Review my change**. Copal checks everything you changed against your team's standards and shows the same hint cards a reviewer would get — question first, then *Explain* and *Show me*. If you agreed a brief, it also lists what goes beyond it." Label: **Early access · IntelliJ & VS Code**. |
| **Better requests, better AI code** | Keep the text. Add label **Early access · Claude Code**. Add one line: "Works with any assistant through a shared brief file: the agreed examples become failing tests first, and nothing beyond them gets built without a question." |
| **Learn as you go** | Replace the weekly-note sentence with: "Your **Growth** page shows how much help you needed this month compared with last — question, explanation, example or fix. Lower is better." Keep the kata sentence. Remove "weekly note" everywhere. |
| For team leads › Pull request coach | Add: "…and asks, never blocks, when code arrived before its test." |
| For team leads › Pairing and mob sessions | Keep **Coming next**. |
| FAQ › What does early access include? | "The IntelliJ and VS Code plugins with hints and *Review my change*, the AI request check for Claude Code, the pull-request coach for GitHub and GitLab, and the Copal app (Growth, Katas, Rules, Analytics). Pairing and mob sessions are coming next." |

## 2. New section: "Your progress, privately" (after "Learn as you go")

Heading: **See yourself improve. Nobody else does.**
Intro: "Everything the plugins notice comes together in the Copal app — for you, not about you."
Four tiles with a small screenshot-style mock-up each (use the real app pages, sample data clearly fictional, no
real names):
1. **Home** — this week's hints, the ones that keep coming back, and the exercise suggested for them.
2. **Growth** — per topic (architecture, testing, security…), how much help you needed each week. *Lower is better.*
3. **Katas** — short exercises picked from your recurring hints. Mark them done from your IDE. No points, no badges.
4. **Rules** — your team's standards with the question each one asks, why it exists, and where to read more.
Then a separate strip **For team leads: Analytics** — "Review rounds, the most frequent hints, which rules help and
which are noise, and whether checking AI requests first saves rework. Team trends only — no names, never below three
people."

## 3. New section: Plans (before the FAQ; anchor `#plans`, add "Plans" to the header nav)

Heading: **Free while we build it with you.** Sub: "Early access is free. Plans below describe what each tier will
include; prices will be announced before early access ends."
Three cards plus one wide card:

**Developer** — *Free*
For one developer, any project.
- IntelliJ and VS Code plugins: hints, the hint ladder, *Review my change*
- AI request check for Claude Code
- Works offline with the local engine; no account needed
- Your personal Growth and Katas pages (with an account)

**Team** — *Free during early access*
For teams that agree on how they build software.
- Everything in Developer
- Shared team standards in your repository, synced to Claude Code, Cursor, Copilot and AGENTS.md
- Pull-request coach for GitHub and GitLab (`/copal explain`, `/copal rule`)
- Rule proposals from review comments, rule health
- Team Analytics (no names, minimum three people)

**Enterprise** — *Talk to us*
For organisations with strict security or many teams.
- Self-hosted Copal server (Docker image) — your code and data stay on your infrastructure
- GitHub Enterprise and GitLab self-managed
- Runs without any AI model: the engine is deterministic; AI features are optional
- Shared rule packs across teams, onboarding support
- SSO and audit export — **Coming next**

Wide card — **Technical mentoring** — *Talk to us*
"Copal plus a senior technical mentor for your team."
- We turn your architecture decisions and review history into Copal rules, questions and katas
- Monthly learning hour or kata session with the team, chosen from your most frequent hints
- Quarterly review of rule health and Analytics with the team lead
- Ideal when you adopt test-first, trunk-based development or AI assistants and want the habits to stick
Button: **Talk to a mentor** → same early-access form with role preselected "team lead / coach" and a "What would you
like help with?" field.

## 4. FAQ — add three questions
- **What does it cost?** "Nothing during early access. The Developer plan stays free. Team and Enterprise prices will
  be announced before early access ends, and early-access teams will hear first."
- **Can we keep everything in-house?** "Yes. The plugins and checks run locally, and the Enterprise plan includes a
  self-hosted server. Copal works without any AI model; AI features are optional."
- **Who sees my data?** "You see your own hints and growth. Team leads see team trends only, without names and never
  below three people. No source code is stored."

## Acceptance
- No section claims a feature without either a matching built feature or a **Coming next** label.
- "Weekly note" appears nowhere. "Review my change" has no "Coming next" label.
- Plans show no prices except "Free" and "Free during early access".
- Header nav: Product · Plans · Docs · Get early access.
