#!/usr/bin/env bash
# Build a .vsix that does not depend on the npm workspace: the extension and @copal/core are bundled into one file
# with esbuild, then packaged from a clean staging folder (vsce's `npm list` check fails on workspace symlinks).
#   ESBUILD="node /path/to/esbuild"  overrides the bundler (default: npx esbuild@0.28.2)
set -euo pipefail
cd "$(dirname "$0")"
OUT="$PWD"
npx tsc -b ../core .
STAGE="$(mktemp -d)"
ESBUILD="${ESBUILD:-npx --yes esbuild@0.28.2}"
$ESBUILD dist/src/extension.js --bundle --platform=node --format=cjs --target=node18 --external:vscode \
  --outfile="$STAGE/dist/extension.js" --log-level=warning
node -e '
  const fs = require("fs"); const p = require("./package.json");
  p.main = "./dist/extension.js"; delete p.dependencies; delete p.devDependencies; delete p.scripts;
  fs.writeFileSync(process.argv[1] + "/package.json", JSON.stringify(p, null, 2));
' "$STAGE"
cp README.md "$STAGE/"
printf 'Copyright (c) 2026 Copal.dev. All rights reserved.\n' > "$STAGE/LICENSE"
[ "${SKIP_VSCE:-}" = 1 ] && { echo "staged in $STAGE"; exit 0; }
(cd "$STAGE" && npx --yes @vscode/vsce package --no-dependencies --out "$OUT/")
