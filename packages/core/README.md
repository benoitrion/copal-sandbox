# @copal/core

The Copal rule engine: parses `.copalrules` (v3), evaluates changes, redacts secrets. One implementation, used by the CLI, the MCP server, the GitHub/GitLab app, the VS Code extension, the JetBrains plugin (through the CLI), the mock backend, and the production backend.

## Use it

Released versions are tagged `core-vX.Y.Z` ([releases](https://github.com/benoitrion/copal-sandbox/releases)).

**Deno / Supabase Edge Functions** — import the single-file ES module by URL (immutable per tag):

```ts
// @ts-types="https://cdn.jsdelivr.net/gh/benoitrion/copal-sandbox@core-v0.2.0/packages/core/esm/copal-core.d.ts"
import { evaluate, parsePolicy, resolvePolicy, validatePolicy, redact, navigatorQuestions, buildBrief, hintCard, kataSuggestions } from "https://cdn.jsdelivr.net/gh/benoitrion/copal-sandbox@core-v0.2.0/packages/core/esm/copal-core.mjs";

const policy = resolvePolicy(parsePolicy(policyText));      // builtin:* packs only — no file access
const report = evaluate(files, policy, { environment: "ci" });
```

**npm (Node, Vite, any bundler)** — install the release tarball by URL, no registry account needed:

```bash
npm i https://github.com/benoitrion/copal-sandbox/releases/download/core-v0.2.0/copal-core-0.2.0.tgz
```

```ts
import { evaluate } from "@copal/core/isomorphic"; // browser-safe build
import { loadPolicy } from "@copal/core";           // Node: adds filesystem helpers (loadPolicy, findPolicyFile)
```

## Entry points

| Import | Contents | Runs in |
|---|---|---|
| `esm/copal-core.mjs` / `@copal/core/isomorphic` | Everything except filesystem helpers | Node, Deno, Bun, browsers |
| `@copal/core` | Isomorphic API + `loadPolicy`, `findPolicyFile`, `readPolicyFile`, `nodePolicyLoader` | Node |

`resolvePolicy(policy, baseDir?, loader?)` resolves `extends: [builtin:…]` everywhere. File references (`extends: [../org.copalrules]`) need a loader and are refused without one, so a server that receives policy text never reads its own disk.

## Release

1. Change code in `src/`, run `npm run build:esm -w packages/core`, commit `esm/` (CI fails if it is stale).
2. Bump `version` in `package.json`.
3. Publish a GitHub release with a new tag `core-vX.Y.Z` on `main` (Releases → Draft a new release, or `gh release create core-vX.Y.Z --target main --title "@copal/core X.Y.Z" --notes ""`). The `release-core` workflow tests the tagged commit, then attaches the npm tarball and the ES module to the release.

Before the first release, or between releases, pin jsDelivr to a commit instead of a tag: `https://cdn.jsdelivr.net/gh/benoitrion/copal-sandbox@<commit-sha>/packages/core/esm/copal-core.mjs`.

The bundle is checked by `test/esm.test.ts` (identical results to the source build on every billing-api scenario).

## Coaching (0.2.0, `.copalrules` v4)

- `parsePolicy` / `validatePolicy` accept `version: 4`, policy `mode` (coach | audit | enforce), `navigator`, per-rule `coach` (question, reference, example, kata, learningHour, escalateAfter) and `severity: block | audit`. v3 files are unchanged.
- Findings carry `coach` and `fixText`; `hintCard(finding)` gives the hint-ladder view (signal, question, why/reference/example, fix behind "Show me", kata).
- `navigatorQuestions(policy, task)` → up to 3 code-free questions for feature-sized tasks (skips small ones); `buildBrief(policy, task, questions, answers)` → the agent brief (first failing test, location, edge cases, rules, small steps).
- `kataSuggestions(policy, occurrences)` → katas per developer when a rule recurs, learning-hour topics when it recurs across a team.
- `containsCode(text)` guards questions against leaking the answer.
- Built-in packs: `builtin:security`, `builtin:quality`, `builtin:testing`, `builtin:hexagonal`, `builtin:clean-code`, all with coaching.
