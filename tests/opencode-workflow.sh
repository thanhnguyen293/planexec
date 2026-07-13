#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}/planexec-opencode-test-$$"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

assert_contains_file() {
  local file="$1" needle="$2"
  if ! grep -Fq "$needle" "$file"; then
    echo "Expected $file to contain: $needle" >&2
    exit 1
  fi
}

for agent in planner executor; do
  file="$ROOT/.opencode/agents/$agent.md"
  assert_contains_file "$file" "external_directory:"
  assert_contains_file "$file" "~/.pub-cache/hosted/pub.dev/*"
done

assert_contains_file "$ROOT/.opencode/agents/planner.md" 'MUST invoke the `question` tool for EVERY user-facing question'
assert_contains_file "$ROOT/.opencode/agents/planner.md" "Never end a turn with a plain-text question"
assert_contains_file "$ROOT/README.md" "restart OpenCode"
assert_contains_file "$ROOT/README.vi.md" "khởi động lại OpenCode"

mkdir -p "$TMP_ROOT/project"
(
  cd "$TMP_ROOT/project"
  "$ROOT/install.sh" --target opencode
)

echo "opencode workflow tests passed"
