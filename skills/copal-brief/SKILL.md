---
name: copal-brief
description: Before writing code for a feature-sized task in a repository with a .copalrules file, agree the task with the developer and write .copal/brief.md (goal, in scope, out of scope, examples that become the first failing tests).
---

# Copal brief: agree the task before the first line of code

Use this when the developer asks for a feature, a fix that changes behaviour, or any task an agent will run on its own, in a repository that has a `.copalrules` file.

## Steps

1. Read `.copalrules`. Note the rules that the files you will touch fall under, and their `coach.question`.
2. Ask the developer, in one message, at most three questions:
   - the **first concrete example** (input → expected result); it becomes the first failing test;
   - **where the code belongs** (which folder or module), and what is out of scope;
   - **what could go wrong** (the case they worry about).
   Do not ask what the code or `.copalrules` already answers.
3. Write `.copal/brief.md`:

   ```markdown
   # Brief: <task in a few words>

   **Goal:** <one sentence>

   **In scope:** <folders or modules>

   **Out of scope:** <what must not change>

   **Done when:** <the examples, as checkable statements>
   ```

4. Show the brief and wait for the developer's OK. Then hand over to the `copal-check` skill's way of working: examples as failing tests first, then small steps.

## Rules

- Keep the brief under 15 lines. A long brief is a sign the task should be split.
- Never put credentials, customer data or internal URLs in the brief.
