# Brancher Copal MCP dans vos agents

Remplacez `/ABS/copal-sandbox` par le chemin absolu du dépôt et lancez `npm run build` d'abord.
Le serveur lit `.copalrules` dans `COPAL_PROJECT_DIR` (par défaut le dossier où l'agent le lance).

## Claude Code
```bash
cd /path/to/your/repo
claude mcp add copal -e COPAL_SERVER=http://localhost:4010 -e COPAL_API_KEY=copal_dev_local \
  -- node /ABS/copal-sandbox/packages/mcp-server/dist/src/index.js
```
Ou commitez un `.mcp.json` à la racine du dépôt (voir `examples/billing-api/.mcp.json`). Ne mettez jamais la clé API dans un fichier commité : Copal le bloque (`hardcoded-credentials`). Lancez une fois `copal login --server … --key …` ; le serveur MCP lit la clé dans `~/.copal/config.json` ou dans la variable d'environnement `COPAL_API_KEY`.

## Cursor — `.cursor/mcp.json`
```json
{ "mcpServers": { "copal": { "command": "node", "args": ["/ABS/copal-sandbox/packages/mcp-server/dist/src/index.js"],
  "env": { "COPAL_SERVER": "http://localhost:4010", "COPAL_API_KEY": "copal_dev_local" } } } }
```

## VS Code / GitHub Copilot — `.vscode/mcp.json`
```json
{ "servers": { "copal": { "type": "stdio", "command": "node", "args": ["/ABS/copal-sandbox/packages/mcp-server/dist/src/index.js"],
  "env": { "COPAL_SERVER": "http://localhost:4010", "COPAL_API_KEY": "copal_dev_local" } } } }
```

## Codex — `~/.codex/config.toml`
```toml
[mcp_servers.copal]
command = "node"
args = ["/ABS/copal-sandbox/packages/mcp-server/dist/src/index.js"]
env = { COPAL_SERVER = "http://localhost:4010", COPAL_API_KEY = "copal_dev_local" }
```

## Outils exposés
| Outil | Rôle |
|---|---|
| `copal_get_rules` | Règles applicables à un chemin (à appeler avant d'écrire) |
| `copal_check_code` | Vérifie un brouillon de fichier, renvoie findings + corrections |
| `copal_check_staged` | Même validation que le hook pré-commit (enregistrée dans la console) |
| `copal_redact` | Retire secrets / données restreintes d'un texte |
| `copal_plan` | Plan technique tenant compte des règles enforce |
| `copal_report_session` | Enregistre la session (vue coûts) |

Ressources : `copal://policy`, `copal://policy/resolved`. Prompt : `copal-review`.

Test manuel sans agent : `npx @modelcontextprotocol/inspector node packages/mcp-server/dist/src/index.js`
(ou `node scripts/mcp-smoke.mjs <repo>` dans ce dépôt).
