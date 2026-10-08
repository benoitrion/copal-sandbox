#!/usr/bin/env bash
# Build a .vsix: vendors @copal/core (a workspace symlink) as a real copy, then runs vsce.
set -euo pipefail
cd "$(dirname "$0")"
npx tsc -b ../core .
rm -rf node_modules/@copal/core && mkdir -p node_modules/@copal/core
cp -r ../core/dist ../core/package.json node_modules/@copal/core/
npx --yes @vscode/vsce package --allow-missing-repository --skip-license
