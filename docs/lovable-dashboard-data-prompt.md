# Copal app: wire the dashboard to the new plugin data

Prompt for Lovable. Follows `lovable-dashboard-prompt.md` (pages already built: Home, Growth, Katas, Rules,
Analytics, Settings). The plugins now send more data; make sure the API accepts it and the pages use it. Keep every
existing response shape; `scripts/api-test.mjs` must keep passing. No mock data, no new pages.

## 1. API — accept what the plugins now send (`/api/public/v1`)
Verify each, and fix only where it is rejected or dropped:
- `POST /v1/coach/events` — `category` is any string (new value: `requests` from the Claude Code request check, rule
  ids `request-goal|request-scope|request-done`); `source` is one of `ide|cli|agent|pr`; `developer` is the git name.
  Accept a single event or `{ events: [...] }`.
- `POST /v1/sessions` — fields `agent` (`claude-code`, MCP agents), `project`, `inputTokens`, `outputTokens`,
  `tokens`, `model`, `navigatorUsed` (true when the request check asked or a brief existed), optional `costUsd`,
  `retries`, `durationMs`, `findings`. Non-negative numbers only.
- `POST /v1/heartbeats` — `{ heartbeats: [{ file, ts, editor }] }`, `editor` = `vscode|jetbrains|ide`. Store the
  editor so Adoption can say which IDEs are in use.
- `POST /v1/katas` — accepts `ruleId` (the rule the kata practises); `POST /v1/katas/:id/complete` with
  `{ developer }` records a completion.
- `GET /v1/usage`, `/v1/reach`, `/v1/growth`, `/v1/katas` — compute from the stored data above (same shapes as now).

## 2. "Me" = my git names
Events name the developer by git `user.name`, not the account. In **Settings › Account** add "Your git name(s)"
(comma-separated, default: the account username). Home, Growth "Me" and Katas "Suggested for you" filter with
`developer IN (my git names)`. Team views unchanged: no names, hidden below 3 developers.

## 3. Page updates
**Home**
- "Hints you saw" counts my `shown` events this week; add "Questions answered" (answered / answered+skipped).
- "Recurring hints": my top 3 rules shown ≥ 2 times in 14 days, each with its kata if the rule has one.
- New card **AI requests this week**: how many times the request check asked me first (category `requests`), split by
  gap (goal / scope / done). Caption: "Clear requests get better AI code."

**Growth**
- Add `requests` as a topic named **AI requests** with the same weekly "help needed" chart. Its caption: "How often
  Copal had to ask for the goal, the scope or what 'done' means."

**Katas**
- "Suggested for you" from `/v1/katas` suggestions filtered to my git names.
- Completed katas show the date and come from IDE "Mark kata done" or `copal kata done`; show "Done in IntelliJ /
  VS Code" is not needed — just the date.
- Library rows show the rule a kata practises (`ruleId`) linking to the Rules page.

**Rules**
- Unchanged, plus: when a rule has a `fix`, show it under a collapsed "Show me" (same ladder as the IDE).

**Analytics (leads)**
- AI requests: sessions, tokens per session and per merged change, **with vs without the request check** side by
  side (`withNavigator` / `withoutNavigator`), labelled "With request check" / "Without". Hide cost when null.
- Adoption: IDE plugins (VS Code / IntelliJ, from heartbeats in the last 30 days), AI assistants (from sessions:
  Claude Code, MCP agents), pre-commit, PR bot — each with "last seen".
- Review: keep; rename the empty state to "No pull requests checked yet. Add the GitHub Action or GitLab job."

**Settings › Set up**
- Claude Code line: `copal hook install --claude` — "adds the request check and the AI usage summary (session end)".
- Add "IntelliJ: Tools › Copal.dev › Review My Change and the Copal Task window".

## Acceptance
- With the sandbox CLI pointed at the app (`COPAL_SERVER`, `COPAL_API_KEY`), these produce visible data:
  `copal event no-float-money 1 shown --category quality`, a Claude Code session end, `copal heartbeat
  src/a.ts --editor jetbrains`, `copal kata done <url>`.
- My events appear under "Me" once my git name is set; team views show no names and hide below 3 people.
- `scripts/api-test.mjs` passes; no new endpoints; no mock data.
