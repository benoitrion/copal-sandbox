#!/usr/bin/env bash
# Copal Action entry point. Decides what to run from MODE and the triggering event.
set -euo pipefail
mode="${MODE:-auto}"
if [ "$mode" = auto ]; then
  case "${GITHUB_EVENT_NAME:-}" in
    pull_request|pull_request_target|issue_comment|pull_request_review_comment) mode=check ;;
    schedule) mode=weekly ;;
    workflow_dispatch) mode=weekly ;;
    *) echo "copal: nothing to do for event '${GITHUB_EVENT_NAME:-}'"; exit 0 ;;
  esac
fi
cli=(node "$COPAL/packages/cli/dist/src/index.js")
track=()
[ -n "${TRACK:-}" ] && track=(--track "$TRACK")
case "$mode" in
  check)
    exec node "$COPAL/packages/git-app/dist/src/action.js" ;;
  weekly|readiness)
    out="$(mktemp -d)"
    if [ "$mode" = readiness ]; then
      "${cli[@]}" weekly --repo "$GITHUB_REPOSITORY" --days "${DAYS:-90}" "${track[@]}" --out "$out"
      title="Copal readiness diagnostic · $(date -u +%Y-%m-%d)"
    else
      "${cli[@]}" weekly --repo "$GITHUB_REPOSITORY" "${track[@]}" --out "$out"
      title="Copal weekly report · $(date -u +%Y-%m-%d)"
    fi
    file="$(ls "$out"/*.md | head -1)"
    cat "$file" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    gh label create "$LABEL" --repo "$GITHUB_REPOSITORY" --color 2dd4bf --description "Copal team reports" --force >/dev/null 2>&1 || true
    gh issue create --repo "$GITHUB_REPOSITORY" --title "$title" --body-file "$file" --label "$LABEL"
    ;;
  *) echo "copal: unknown mode '$mode' (auto, check, weekly, readiness)"; exit 2 ;;
esac
