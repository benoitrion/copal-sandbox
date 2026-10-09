# Copal sandbox — app mock + plugins d'intégration

[![ci](https://github.com/benoitrion/copal-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/benoitrion/copal-sandbox/actions/workflows/ci.yml)

Un bac à sable complet pour tester [Copal](https://copal.lovable.app) de bout en bout, **sans aucune dépendance npm à l'exécution** (seul TypeScript sert au build).

> **Copal is a technical mentor inside the IDE — it reviews code while you write it, with or without AI, and helps you ask AI for the right thing.**
> Product reference: white paper *Copal — The AI Technical Mentor in Your IDE*. Current work: [`docs/plugin-alignment-prompt.md`](docs/plugin-alignment-prompt.md);
> website: [`docs/lovable-mentor-landing-prompt.md`](docs/lovable-mentor-landing-prompt.md).
>
> **Unfrozen for the app dashboard** (see `docs/lovable-dashboard-prompt.md`): `/v1/growth`, `/v1/usage`, `/v1/katas*`, `/v1/reach`, `/v1/rules/health` feed the Growth, Katas, Rules and Analytics pages — personal data for developers, team trends without names for leads.
> `/v1/katas*`, `/v1/reach`, `/v1/rules/health` endpoints and the console's Growth, Katas & learning hours and AI usage tabs.

```
                     ┌──────────── .copalrules (versionné dans le repo) ────────────┐
                     │                                                              │
  Agent (Claude Code, Cursor, Copilot, Codex)        Développeur            Git provider (GitHub / GitLab)
        │ MCP stdio                                   │ git commit                 │ webhook PR/MR
        ▼                                             ▼                            ▼
  packages/mcp-server ──┐                   packages/cli (hook)          packages/git-app
  packages/vscode-extension ─┐                      │                     reviews inline + status check
                             ▼                      ▼                            │
                       packages/core  ◄── même moteur partout ──►  packages/client ─┤
                                                                                 ▼
                                                     apps/mock-server  (API /v1/*, console, faux GitHub/GitLab)
```

| Dossier | Rôle |
|---|---|
| `examples/billing-api` | **App cible** : petite API de facturation propre + `.copalrules` + 4 scénarios de violations (`scenarios/`) |
| `apps/mock-server` | **Backend Copal simulé** : API publique `/v1/*`, console web, faux GitHub et faux GitLab |
| `packages/core` | Moteur de règles partagé : parser `.copalrules` v3, héritage, environnements, diff, redaction. Publié en module ES unique (Deno/Supabase, navigateur) : voir [`packages/core/README.md`](packages/core/README.md) |
| `packages/client` | Client HTTP du backend, avec repli sur le moteur local si le serveur est injoignable |
| `packages/cli` | **Plugin pré-commit** : `copal check` (sortie coach), `--show-me`, `copal reflect` (navigator), `copal hook install [--claude]` |
| `packages/mcp-server` | **Plugin MCP** pour les agents (8 outils dont `copal_reflect` / `copal_brief`, 2 ressources, 2 prompts dont `copal-pair`) |
| `packages/git-app` | **App GitHub / GitLab** : webhooks → revue inline, résumé, status check requis, feedback `/copal` |
| `packages/vscode-extension` | **Extension VS Code** : hint cards au survol (Ask me · Explain · Show me), *Copal: Pair on a task* |
| `plugins/jetbrains` | **Plugin JetBrains** (IntelliJ, WebStorm, PyCharm…) : intentions Ask me / Explain / Show me, fenêtre *Copal Pair* (navigator) |
| `integrations/` | Configs MCP (Claude Code, Cursor, VS Code, Codex), CI GitHub Actions / GitLab, manifeste GitHub App |

## Démarrage

```bash
npm install          # ne télécharge que typescript + @types/node (liens de workspace)
npm run build
npm test             # 16 tests Node (+ 3 tests Kotlin via Gradle) : moteur, scénarios, webhooks, extension VS Code (runtime simulé)
npm run e2e          # scénario complet (19 vérifications)
KEEP=1 npm run e2e   # idem, puis laisse tourner les serveurs → http://localhost:4010
```

Node ≥ 20 et git sont requis.

## Héberger le backend (et billing-api)

Le backend simulé tourne dans **un seul processus, sur un seul port**. Il regroupe l'API `/v1/*`, la console, le faux GitHub/GitLab et les webhooks de PR (`/webhooks/github`, `/webhooks/gitlab`).

- **GitHub Codespaces** : [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/benoitrion/copal-sandbox)
  - `scripts/serve-hosted.sh` démarre le backend sur `:4010` et l'app cible billing-api sur `:3000`, puis tente de rendre ces ports publics.
  - L'URL et la clé API s'affichent dans le terminal (clé aussi dans `.data/dev-key`).
  - Le codespace s'arrête après 30 min d'inactivité ; il suffit de le relancer.
- **Render** (URL permanente, offre gratuite) : [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/benoitrion/copal-sandbox)
  - La clé `COPAL_MOCK_DEV_KEY` est générée automatiquement ; vous la trouvez dans *Environment*.
- **Docker** : `docker build -t copal-mock . && docker run -p 4010:4010 -e COPAL_MOCK_DEV_KEY=… copal-mock`

Dès que `COPAL_MOCK_DEV_KEY` est défini, la clé par défaut `copal_dev_local` cesse d'être acceptée, et la console comme la création de clés exigent la clé.

Par défaut, les webhooks de PR publient sur le faux GitHub/GitLab du serveur. Pour publier sur de vraies PR, définissez `COPAL_GIT_TARGET=real` avec `GITHUB_TOKEN` (ou `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY`), `GITHUB_WEBHOOK_SECRET`, `GITLAB_TOKEN`.

**Tester une API Copal** : `COPAL_SERVER=… COPAL_API_KEY=… node scripts/api-test.mjs` vérifie le contrat `/v1`, passe billing-api et chaque scénario par `/v1/analyze` en comparant avec le moteur local, puis teste les vrais clients (CLI, check de PR). Sur GitHub : *Actions → api-test* (cible par défaut : le serveur de démo de l'issue #1).

**billing-api** est maintenant un vrai service HTTP (`cd examples/billing-api && npm install && npm start`) :
- `GET /health`
- `GET /customers/:id/invoices`
- `POST /invoices/preview`

**Lovable** : deux prompts d'alignement.
- [`docs/lovable-alignment-prompt.md`](docs/lovable-alignment-prompt.md) : vrai backend Supabase.
- [`docs/lovable-mock-alignment-prompt.md`](docs/lovable-mock-alignment-prompt.md) : app front-only sur mocks typés (`docs/lovable/mocks`), avec bascule vers le serveur de référence.

## Ce que montre `npm run e2e`

1. Démarre le backend simulé (`:4010`) et l'app Git (`:4020`), copie `billing-api` dans un repo git temporaire.
2. **Pré-commit** : installe le hook ; chaque scénario est bloqué au commit avec les bonnes règles.
3. **MCP** : un client MCP minimal demande les règles de `src/web/**` puis fait vérifier un brouillon.
4. **PR** : ouvre GitHub #248/#249/#250 et GitLab !12 sur le faux provider → statut `failure`, revue *changes requested*, commentaires inline avec suggestion.
5. **Feedback** : `/copal false-positive invoice-contract-test …` en commentaire de PR.
6. **Correction** : push du correctif → re-check → statut `success`.
7. **Console** : drift par règle, gates, sources (pré-commit / PR / branche), sessions d'agents.

## Les scénarios de l'app cible

| Scénario | Simule | Règles déclenchées |
|---|---|---|
| `01-invoice-rounding` | L'exemple de la landing page (Cursor) | `ledger-rounding` (avec correction `LedgerPort.round`), `hardcoded-credentials`, `invoice-contract-test` |
| `02-ui-to-db` | Contrôleur qui importe la persistance (Claude Code) | `ui-no-persistence`, `no-console`, `no-explicit-any` |
| `03-sql-and-deps` | Requête SQL interpolée + paquets non approuvés (Codex) | `sql-injection`, `approved-dependencies` ×2, IBAN client (`redact`) |
| `04-fixed` | Version corrigée | aucune |

Pour rejouer à la main :

```bash
cd /tmp && cp -r ~/copal-sandbox/examples/billing-api demo && cd demo && rm -rf scenarios
git init -q -b main && git add -A && git commit -qm base
node ~/copal-sandbox/packages/cli/dist/src/index.js hook install
cp -r ~/copal-sandbox/examples/billing-api/scenarios/01-invoice-rounding/src . && git add -A
git commit -m "feat: invoice totals"            # bloqué
node ~/copal-sandbox/packages/cli/dist/src/index.js check --fix   # applique la correction et re-stage
```

## Format `.copalrules` (v4 — coaching)

La v4 garde toutes les règles v3 (un fichier v3 se charge tel quel) et ajoute le coaching :

```yaml
version: 4
mode: coach                # coach (défaut v4) | audit | enforce — les règles enforce/secrets bloquent toujours
extends: [builtin:security, builtin:testing, builtin:hexagonal, builtin:clean-code]
navigator: { enabled: true, minScope: feature, maxQuestions: 3, questions: [first-example, placement, risk] }
rules:
  - id: ledger-rounding
    pattern: "Math\\.round\\(\\s*(\\w+)\\s*\\*\\s*100\\s*\\)\\s*/\\s*100"
    severity: audit        # alias v4 : block = enforce, audit = audit
    coach:
      question: Who owns rounding in this codebase?          # niveau 1 — jamais de code dans la question
      reference: docs/rules/ledger-rounding.md                 # niveau 2 — le « pourquoi » de l'équipe
      example: { bad: "Math.round(x * 100) / 100", good: "LedgerPort.round(x, Currency.EUR)" }   # niveau 3
      kata: https://sammancoaching.org/kata_descriptions/supermarket_receipt.html   # lien + crédit (CC-BY-SA)
      learningHour: naming-domain-concepts
      escalateAfter: 2     # occurrences / sprint avant de proposer le kata
    fix: { with: "LedgerPort.round($1, Currency.EUR)" }        # niveau 4 — « Show me » seulement
```

**Code smells** : `extends: [builtin:smells]` ajoute des indices (jamais bloquants) pendant l'écriture — fonction longue, imbrication profonde, trop de paramètres, gros fichier, littéral dupliqué — avec question, référence et kata. Heuristiques légères (pas d'AST) : gardez votre analyseur existant (ESLint, Sonar…), Copal ajoute le coaching.

**Bot PR (GitHub / GitLab)** : dans une PR, `/copal explain <règle>` répond avec la hint card ; `/copal rule <texte>` — ou en réponse à un commentaire de revue — rédige un brouillon de règle (YAML + question + lien vers la discussion) enregistré dans la console (`/v1/rules/drafts`). Le workflow `integrations/ci/copal-pr-check.yml` écoute aussi les commentaires.

**Agents** : `copal sync-context` écrit les règles dans `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/copal.mdc` et `.github/copilot-instructions.md` (bloc géré ; `--check` en CI échoue s'ils sont périmés).

**Claude Code** : `copal hook install --claude` ajoute un hook `UserPromptSubmit` — pour une tâche de taille « feature », Claude pose d'abord les questions du navigator puis travaille test d'abord. Avec MCP, l'agent appelle `copal_reflect` puis `copal_brief`.

### v3 (toujours supporté)

Compatible avec l'exemple de vos docs (`id`, `mode`, `deny`, `why`), étendu ainsi :

```yaml
version: 3
project: billing-api
extends: [builtin:security, builtin:quality]   # ou un chemin relatif vers une politique d'org
redact:                                         # retiré avant tout envoi à un agent / modèle
  - { name: customer-iban, pattern: "BE\\d{14}" }
rules:
  - id: ui-no-persistence           # frontière d'import
    mode: enforce                   # enforce = bloque | audit = signale | off
    deny: "src/web/** -> src/persistence/**"
    why: "Keep persistence behind the API boundary."
  - id: ledger-rounding             # motif + correction concrète
    pattern: "Math\\.round\\(\\s*(\\w+)\\s*\\*\\s*100\\s*\\)\\s*/\\s*100"
    fix: { with: "LedgerPort.round($1, Currency.EUR)" }
    paths: ["src/**/*.ts"]
    exclude: ["src/ports/**"]
    sources: [Jira FIN-402]
  - id: approved-dependencies       # package.json
    dependencies: { allow: ["zod", "@types/*"], deny: [moment] }
  - id: invoice-contract-test       # test exigé avec le changement
    requireTest: { test: "src/invoice/{name}.test.ts" }
  - id: hardcoded-credentials
    secrets: true
environments:                       # surcharges par environnement (--env ci)
  ci: { rules: { invoice-contract-test: { mode: enforce } } }
```

Faux positif : `// copal-ignore <rule-id>` sur la ligne ou celle du dessus (proposé en quick fix dans VS Code).

## Request check (Claude Code)

`copal hook install --claude` registers `copal claude-hook` on UserPromptSubmit. Before the AI builds, it checks whether the
request states a **goal**, a **scope** (what not to touch) and a **definition of done** (`requestGaps` in `@copal/core`).

- Small or clear requests (typo, rename, question, request with scope and done): silent.
- Otherwise Claude is asked to put **one** question to the developer about the most important gap first.
- "Continue"-style requests: if `.copal/brief.md` has a `Next:` line, it is offered as option 1.
- "just do it" / "skip" bypasses the check. Works without `.copalrules`.

## Examples first + brief file

`copal reflect "<task>"` asks for the first example, where the code belongs, what could go wrong and what the change must
not touch, then writes `.copal/brief.md`: task, scope in / out, 2–4 examples (`input → expected`), done-when and a
`Next:` line. IDE plugins pass `outOfScope` in the `--answers` JSON. The brief, the Claude Code hook and the
`sync-context` block tell the AI: write the examples as failing tests, show them, wait for the developer's OK, then
implement in small steps until they pass — nothing beyond the examples.

## Hint data (growth)

Every plugin records hint-ladder steps with `POST /v1/coach/events` (best effort, never blocks): VS Code directly,
JetBrains through `copal event RULE LEVEL ACTION --category CAT`, the Claude Code hook as `request-<gap>` in category
`requests`. Events carry the project and the git author; nothing is sent without a configured server.

## Brancher les plugins

**MCP** — voir [`integrations/mcp/README.md`](integrations/mcp/README.md) (Claude Code, Cursor, VS Code/Copilot, Codex). `examples/billing-api/.mcp.json` est prêt à l'emploi.

**Pré-commit**
```bash
copal login --server http://localhost:4010 --key copal_dev_local   # ou --create-key
copal hook install [--env ci]
copal check [--staged | --base origin/main | --all | --diff file.patch] [--env ci] [--json] [--fix] [--local]
copal check --stdin-file src/x.ts --json < contenu   # mode éditeur (JetBrains)
copal rules src/web/x.ts
```
Codes de sortie : `0` ok, `1` finding bloquant, `2` erreur. `COPAL_SKIP=1` contourne localement (la PR reste vérifiée). Un `.pre-commit-hooks.yaml` est fourni pour le framework *pre-commit*.

**App GitHub / GitLab**
```bash
# contre le faux provider du mock
GITHUB_API_URL=http://localhost:4010/github GITHUB_TOKEN=x \
GITLAB_API_URL=http://localhost:4010/gitlab/api/v4 GITLAB_TOKEN=x \
COPAL_SERVER=http://localhost:4010 COPAL_API_KEY=copal_dev_local npm run git-app
node packages/git-app/dist/src/server.js simulate --provider github --dir <repo> --base main --head <branche> --number 1
```
Contre le vrai GitHub : créez l'app avec `integrations/github-app-manifest.json` (permissions *pull requests*, *statuses*, *issues* en écriture, *contents* en lecture ; événements `pull_request`, `issue_comment`), exposez `:4020` via un tunnel, puis `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET` (ou un simple `GITHUB_TOKEN`). GitLab : webhook *Merge request* + *Comments* vers `/webhooks/gitlab`, `GITLAB_TOKEN` (scope `api`), `GITLAB_WEBHOOK_SECRET`. Rendez le contexte `copal/check` obligatoire dans la protection de branche. Sans app, `integrations/ci/` fournit l'équivalent en job CI.

**JetBrains** — `cd plugins/jetbrains && ./gradlew buildPlugin` produit `build/distributions/copal-jetbrains-0.2.0.zip` (aussi publié comme artefact par la CI). Installez-le via *Settings → Plugins → ⚙ → Install Plugin from Disk*, ou testez-le dans un IDE bac à sable avec `./gradlew runIde`. Dans *Settings → Tools → Copal.dev*, renseignez le chemin de la CLI (`…/copal-sandbox/packages/cli/dist/src/index.js`), puis *Tools → Copal.dev → Set API Key…*. Le plugin envoie le contenu non sauvegardé à `copal check --stdin-file <fichier> --json` : même moteur, aucune analyse enregistrée à chaque frappe. *Check Staged Changes* lance la validation pré-commit, qui est enregistrée dans la console.

**VS Code** — ouvrez `packages/vscode-extension` dans VS Code et lancez *Run Copal extension (billing-api)* (F5). `npm run package` dans ce dossier produit un `.vsix` (télécharge `@vscode/vsce`).

## API du backend simulé

En-tête `x-api-key: copal_dev_local` sur `/v1/*`. Les endpoints documentés de Copal sont présents (`status`, `plan`, `suggestions`, `mentor`, `sessions`, `heartbeats`, `keys`) ; ceux-ci sont propres au mock, à aligner sur votre vraie API :

| Méthode | Chemin | Rôle |
|---|---|---|
| GET / PUT | `/v1/projects/:name/policy` | Lire / publier la politique (`?file=` → règles applicables) |
| POST | `/v1/analyze` | `{project?, environment, source, ref, files[], policyText?}` → rapport + `analysisId` |
| GET | `/v1/analyses[/:id]` | Historique |
| POST | `/v1/analyses/:id/feedback` | `{ruleId, verdict: false-positive \| accepted}` |
| GET | `/v1/metrics` | Drift, gates, governed changes, tokens |
| POST | `/v1/coach/reflect` | `{project, task, files?}` → `{sessionId, engage, questions[≤3]}` (navigator) |
| POST | `/v1/coach/reflect/:id/answers` | `{answers[], skipped?}` → `{brief}` (test d'abord, emplacement, cas limites, règles) |
| POST | `/v1/coach/events` | Étape de l'échelle `{ruleId, levelReached 0-4, action, source}` → 204 |
| GET | `/v1/growth` | Niveau médian nécessaire par catégorie et par semaine, récurrences, taux de réponse |
| GET / POST | `/v1/katas` | Bibliothèque (katas canoniques crédités) + suggestions par récurrence |
| POST | `/v1/katas/generate`, `/v1/katas/:id/complete` | Micro-kata depuis un finding ; complétion |
| GET | `/v1/rules/health` | Par règle : hits, tendance, part « caught late » (vue d'abord en PR/CI), taux de faux positifs, statut (recurring · noisy · caught-late · silent · uncoached) |
| POST / GET | `/v1/rules/drafts` | Brouillons de règles issus des revues (`/copal rule`) ; `POST /v1/rules/drafts/:id {status}` approuve ou écarte |
| GET | `/v1/reach` | Dernière activité par surface (pre-commit, PR, agents MCP, navigator, IDE) |
| GET | `/v1/usage` | Tokens et coût par changement mergé, avec vs sans navigator |

Options : `--port 4010`, `--project dir1,dir2` (projets préchargés), `--persist data/state.json`.

## Limites connues

- Le parser YAML intégré couvre le sous-ensemble utile aux politiques ; si le paquet `yaml` est installé, il est utilisé automatiquement.
- `--fix` remplace la ligne fautive mais n'ajoute pas l'import manquant (`LedgerPort`, `Currency`).
- L'analyse d'import est textuelle (imports relatifs et paquets) ; les alias de `tsconfig` ne sont pas résolus.
- L'extension VS Code compile contre un sous-ensemble local de l'API (`typings/vscode.d.ts`) ; installez `@types/vscode` et supprimez ce dossier pour développer plus loin.
- Le plugin JetBrains est compilé et testé par la CI GitHub (le SDK IntelliJ n'est pas téléchargeable dans l'environnement où il a été écrit) ; il n'a pas encore été lancé dans un IDE réel.
