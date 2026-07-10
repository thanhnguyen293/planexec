#!/usr/bin/env bash
# Install ticket workflow (planner/executor agents, command, skills)
# Usage:
#   ./install.sh [--target opencode|claude|codex] [--global] [--force]
#     --target   opencode | claude (Claude Code) | codex (Codex CLI) | all (default)
#     --global   install globally instead of into the current project
#     --force    overwrite existing files
#   No flags = install all three tools globally.
#   --target all always implies --global.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# Bootstrap for `curl | bash`: repo files are not local, clone first.
REPO_URL="${REPO_URL:-https://github.com/thanhnguyen293/planexec}"
if [ ! -d "$SRC/.opencode/agents" ]; then
  echo "Repo files not found next to install.sh — cloning $REPO_URL ..."
  command -v git >/dev/null 2>&1 || { echo "git is required"; exit 1; }
  TMP="$(mktemp -d)"
  git clone --depth 1 "$REPO_URL" "$TMP/repo" || {
    echo "Clone failed. Set REPO_URL, e.g.: REPO_URL=https://github.com/you/repo bash install.sh"; exit 1; }
  exec bash "$TMP/repo/install.sh" "$@"
fi

TARGET="all"
GLOBAL=false
FORCE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift ;;
    --target=*) TARGET="${1#*=}" ;;
    --global) GLOBAL=true ;;
    --force)  FORCE=true ;;
    -h|--help) grep '^#' "$0" | head -9; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

CP_FLAG="-n"
$FORCE && CP_FLAG="-f"

copy_tree() { # $1=src_dir $2=dest_dir
  [ -d "$1" ] || return 0
  mkdir -p "$2"
  cp -R $CP_FLAG "$1/." "$2/"
}

merge_json() { # $1=dst $2=src
  local dst="$1" src="$2"
  if [ ! -f "$dst" ]; then
    cp "$src" "$dst"; echo "  created $dst"
  elif command -v jq >/dev/null 2>&1; then
    jq -s '.[0] * .[1]' "$dst" "$src" > "$dst.tmp" && mv "$dst.tmp" "$dst"
    echo "  merged  $dst (jq)"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$dst" "$src" <<'EOF'
import json, sys
def deep(a, b):
    for k, v in b.items():
        a[k] = deep(a.get(k, {}), v) if isinstance(v, dict) and isinstance(a.get(k), dict) else v
    return a
dst, src = sys.argv[1], sys.argv[2]
merged = deep(json.load(open(dst)), json.load(open(src)))
json.dump(merged, open(dst, "w"), indent=2, ensure_ascii=False)
print(f"  merged  {dst} (python3)")
EOF
  else
    echo "  WARNING: jq/python3 not found — merge $src into $dst manually"
  fi
}

if [ "$TARGET" = "all" ]; then
  # "all" always installs globally
  FLAGS="--global"
  $FORCE && FLAGS="$FLAGS --force"
  for t in opencode claude codex; do
    "$0" --target "$t" $FLAGS
    echo ""
  done
  exit 0
fi

case "$TARGET" in
  opencode)
    if $GLOBAL; then DEST="$HOME/.config/opencode"; else DEST="$(pwd)/.opencode"; fi
    echo "Installing OpenCode workflow -> $DEST"
    copy_tree "$SRC/.opencode/agents"   "$DEST/agents"
    copy_tree "$SRC/.opencode/commands" "$DEST/commands"
    copy_tree "$SRC/.opencode/skills"   "$DEST/skills"
    if $GLOBAL; then CONFIG="$DEST/opencode.json"; else CONFIG="$(pwd)/opencode.json"; fi
    merge_json "$CONFIG" "$SRC/opencode.json"
    echo "Done. Open opencode and type /planner <content>. Adjust models in agents/*.md if needed (opencode models)."
    ;;
  claude)
    if $GLOBAL; then DEST="$HOME/.claude"; else DEST="$(pwd)/.claude"; fi
    echo "Installing Claude Code workflow -> $DEST"
    copy_tree "$SRC/claude-code/.claude/agents"   "$DEST/agents"
    copy_tree "$SRC/claude-code/.claude/commands" "$DEST/commands"
    copy_tree "$SRC/claude-code/.claude/skills"   "$DEST/skills"
    echo "Done. Open claude and type /planner <content>. Executor uses haiku (change in agents/executor.md if needed)."
    ;;
  codex)
    if $GLOBAL; then DEST="$HOME/.codex"; else DEST="$(pwd)/.codex"; fi
    echo "Installing Codex CLI workflow -> $DEST"
    copy_tree "$SRC/codex/.codex/agents"  "$DEST/agents"
    copy_tree "$SRC/codex/.codex/skills"  "$DEST/skills"
    # Codex custom prompts live in ~/.codex/prompts (global only)
    echo "Note: Codex prompts are installed globally -> $HOME/.codex/prompts"
    copy_tree "$SRC/codex/.codex/prompts" "$HOME/.codex/prompts"
    echo "Done. Open codex and type /planner <content>. Executor uses gpt-5.4-mini (change in agents/executor.toml if needed)."
    ;;
  *)
    echo "Unknown target: $TARGET (opencode|claude|codex|all)"; exit 1
    ;;
esac

echo "Note: for non-Flutter projects, update the verify/test commands to match your toolchain."
