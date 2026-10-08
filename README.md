# Copal sandbox — app mock + plugins d'intégration

[![ci](https://github.com/benoitrion/copal-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/benoitrion/copal-sandbox/actions/workflows/ci.yml)

Un bac à sable complet pour tester [Copal](https://copal.lovable.app) de bout en bout, **sans aucune dépendance npm à l'exécution** (seul TypeScript sert au build).

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
| `packages/core` | Moteur de règles partagé : parser `.copalrules` v3, héritage, environnements, diff, redaction |
| `packages/client` | Client HTTP du backend, avec repli sur le moteur local si le serveur est injoignable |
| `packages/cli` | **Plugin pré-commit** : `copal check`, `copal hook install`, `--fix` |
| `packages/mcp-server` | **Plugin MCP** pour les agents (6 outils, 2 ressources, 1 prompt) |
| `packages/git-app` | **App GitHub / GitLab** : webhooks → revue inline, résumé, status check requis, feedback `/copal` |
| `packages/vscode-extension` | **Extension VS Code** : diagnostics en direct + corrections rapides |
| `plugins/jetbrains` | **Plugin JetBrains** (IntelliJ, WebStorm, PyCharm…) : annotations, quick fixes, menu Tools → Copal.dev |
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

## Format `.copalrules` (v3)

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

**JetBrains** — `cd plugins/jetbrains && ./gradlew buildPlugin` produit `build/distributions/copal-jetbrains-0.1.0.zip` (aussi publié comme artefact par la CI). Installez-le via *Settings → Plugins → ⚙ → Install Plugin from Disk*, ou testez-le dans un IDE bac à sable avec `./gradlew runIde`. Dans *Settings → Tools → Copal.dev*, renseignez le chemin de la CLI (`…/copal-sandbox/packages/cli/dist/src/index.js`), puis *Tools → Copal.dev → Set API Key…*. Le plugin envoie le contenu non sauvegardé à `copal check --stdin-file <fichier> --json` : même moteur, aucune analyse enregistrée à chaque frappe. *Check Staged Changes* lance la validation pré-commit, qui est enregistrée dans la console.

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

Options : `--port 4010`, `--project dir1,dir2` (projets préchargés), `--persist data/state.json`.

## Limites connues

- Le parser YAML intégré couvre le sous-ensemble utile aux politiques ; si le paquet `yaml` est installé, il est utilisé automatiquement.
- `--fix` remplace la ligne fautive mais n'ajoute pas l'import manquant (`LedgerPort`, `Currency`).
- L'analyse d'import est textuelle (imports relatifs et paquets) ; les alias de `tsconfig` ne sont pas résolus.
- L'extension VS Code compile contre un sous-ensemble local de l'API (`typings/vscode.d.ts`) ; installez `@types/vscode` et supprimez ce dossier pour développer plus loin.
- Le plugin JetBrains est compilé et testé par la CI GitHub (le SDK IntelliJ n'est pas téléchargeable dans l'environnement où il a été écrit) ; il n'a pas encore été lancé dans un IDE réel.
