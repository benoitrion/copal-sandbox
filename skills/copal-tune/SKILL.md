---
name: copal-tune
description: Reduce noise from Copal rules - turn "Not relevant" dismissals and /copal false-positive replies into concrete .copalrules changes (narrow paths, add excludes, lower the mode, or remove a rule). Use when the team says Copal is noisy or a rule keeps being dismissed.
---

# Copal tune: make the rules fit the team

1. Collect the evidence:
   - `copal weekly --json` → `rulesToTune` (rules dismissed most often, with counts);
   - `/copal false-positive <rule>` comments on recent pull requests;
   - the files where dismissals happen.
2. For each noisy rule, propose the **smallest** change that removes the false positives and keeps the real ones:
   - dismissals concentrated in a folder (generated code, tests, scripts) → add it to `exclude`;
   - the pattern matches too widely → tighten `pattern`, with one example it should and one it should not match;
   - the team disagrees with the rule → `mode: audit`, or remove it, and say so explicitly.
3. Show the `.copalrules` diff and the reasoning in one line per rule. Never change rules silently: the developer or lead approves.
4. After the change, run `copal check --all` and report how many findings disappeared and which remain.
