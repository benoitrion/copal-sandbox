---
name: copal-review
description: Review a pull request or branch in a repository with a .copalrules file the way the team's Copal check does - ranked findings, scope against the brief, where a reviewer should look first. Use when asked to review a PR or "what should I look at in this change?".
---

# Copal review: where a reviewer should look first

1. Get the change: `git diff <base>...HEAD`, or the pull request's files.
2. Run `copal check --base <base> --json` if the CLI is available; otherwise apply `.copalrules` to the diff yourself.
3. If `.copal/brief.md` exists, list every changed file that is outside its **In scope** or touches its **Out of scope**, with the question "is this change needed?".
4. Report, in this order and nothing more:
   - **Gate:** passed or failed (from `gate:` in `.copalrules`), with the reason.
   - **Things to look at:** at most 5, riskiest first: risk · kind · one line about this code · file:line. One line per rule, with a count when it repeats.
   - **Beyond the brief:** the out-of-scope files.
   - **Read first:** the one or two files a reviewer should open first, and why.
5. Do not repeat the rule text, do not list low-risk findings one by one, and do not fix code in a review unless asked.
