---
name: copal-check
description: While coding in a repository with a .copalrules file, check the change against the team's rules before committing, fix what is mechanical and ask the developer only about team decisions. Use before every commit and when the developer asks "is this OK for our rules?".
---

# Copal check: follow the team's rules while you code

## Before writing code

1. Read `.copalrules` (and `.copal/brief.md` if it exists: it holds the agreed scope and examples).
2. Start with a short plan: the files you will touch, which rules apply to each, and the first example you will write as a test. If a file is outside the brief, ask first.
3. Write the agreed examples as failing tests first. Implement in small steps until they pass, nothing beyond the examples.

## Before committing

Run the check on what you changed:

- With the Copal CLI: `copal check --staged --json` (or the `copal_check_staged` tool when the Copal MCP server is connected).
- Without it: compare your diff against each rule in `.copalrules` yourself (`pattern`, `deny` imports, `requireTest`, `dependencies`, `changeSize`).

Then handle each finding by its kind:

| Kind | What you do |
|---|---|
| Best practice, Error prone, Complexity, Duplication (mechanical) | Fix it. Say what you changed in one line, for example "typed `original` as `{ id; total }`". |
| Tests | Write the missing test first, from the brief's examples. |
| Architecture, Dependencies, Security, Change size (team decisions) | **Do not decide alone.** Ask the developer the rule's `coach.question`, with the facts you found. |
| Blocking (`mode: enforce`) | Must be fixed before the commit. |

Findings already in `.copal/baseline.json` existed before this change: leave them unless the developer asks.

## At the end

End with two short lists: **Assumptions I made that you didn't state**, and **Things I added beyond the agreed examples**. The developer must be able to explain every line; if they can't, explain it.
