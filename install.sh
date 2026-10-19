#!/usr/bin/env bash
# cooked installer (macOS / Linux).
# Clones (or updates) the repo, registers it as a marketplace and installs the
# mod. Coming from v2, it also removes the bash status line v2 wired into
# ~/.claude/settings.json (with a backup at ~/.claude/settings.json.before-cooked):
# v3 draws its own band and needs no settings change.

set -euo pipefail

REPO_DEFAULT="Marcelfedz/cooked"
REPO="${COOKED_REPO:-$REPO_DEFAULT}"
DEST="$HOME/.claude/plugins/marketplaces/cooked"
SETTINGS="$HOME/.claude/settings.json"
BACKUP="$HOME/.claude/settings.json.before-cooked"

echo "🥘 cooked installer"
echo

# 1. Fetch
if [ -d "$DEST/.git" ]; then
    echo "→ updating $DEST"
    git -C "$DEST" pull --ff-only
else
    echo "→ cloning $REPO into $DEST"
    mkdir -p "$(dirname "$DEST")"
    git clone --depth 1 "https://github.com/$REPO.git" "$DEST"
fi

# 2. Register marketplace + install plugin via official CLI
if ! command -v claude >/dev/null 2>&1; then
    echo "✘ 'claude' CLI not found in PATH. Install Claude Code first." >&2
    exit 1
fi

echo "→ registering marketplace"
claude plugin marketplace add "$DEST" || true

echo "→ installing plugin"
claude plugin install cooked@cooked || true

# 3. v2 → v3: drop the statusLine that pointed at v2's statusline.sh.
if [ -f "$SETTINGS" ] && grep -q 'cooked/scripts/statusline.sh' "$SETTINGS"; then
    [ -f "$BACKUP" ] || cp "$SETTINGS" "$BACKUP"
    if command -v jq >/dev/null 2>&1; then
        tmp=$(mktemp)
        jq 'del(.statusLine)' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
    elif command -v python3 >/dev/null 2>&1; then
        python3 - "$SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
data.pop("statusLine", None)
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
    else
        echo "✘ Need jq or python3 to remove the v2 statusLine. Remove it by hand from $SETTINGS." >&2
    fi
    echo "→ removed the v2 statusLine (backup at $BACKUP)"
fi

echo
echo "✅ cooked installed. Restart Claude Code to activate."
echo
echo "   To revert later:"
echo "     bash $DEST/uninstall.sh"
