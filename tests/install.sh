#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}/ai-setup-install-test-$$"

cleanup() {
  chmod -R u+rwX "$TMP_ROOT" 2>/dev/null || true
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

assert_contains() {
  local haystack="$1" needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "Expected output to contain: $needle" >&2
    echo "Actual output:" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

test_install_fails_when_copy_fails() {
  local fixture="$TMP_ROOT/fixture"
  local target="$TMP_ROOT/target"
  mkdir -p "$fixture/.opencode/agents" "$fixture/.opencode/commands" "$fixture/.opencode/skills" "$target"
  cp "$ROOT/install.sh" "$fixture/install.sh"
  cp "$ROOT/opencode.json" "$fixture/opencode.json"
  printf 'secret\n' > "$fixture/.opencode/agents/unreadable.md"
  chmod 000 "$fixture/.opencode/agents/unreadable.md"

  set +e
  local output
  output="$(cd "$target" && bash "$fixture/install.sh" --target opencode 2>&1)"
  local status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    echo "Expected installer to fail when cp fails, but it exited 0" >&2
    echo "$output" >&2
    exit 1
  fi
}

test_install_warns_for_codex_global_prompt() {
  local home="$TMP_ROOT/home"
  local target="$TMP_ROOT/codex-target"
  mkdir -p "$home" "$target"

  local output
  output="$(cd "$target" && HOME="$home" bash "$ROOT/install.sh" --target codex 2>&1)"

  assert_contains "$output" "Codex prompts are installed globally"
  [[ -f "$home/.codex/prompts/planner.md" ]]
}

test_install_fails_when_copy_fails
test_install_warns_for_codex_global_prompt

echo "install tests passed"
