#!/usr/bin/env bash
# cooked installer (macOS / Linux).
# Clones the repo, registers the marketplace, installs the plugin,
# and patches ~/.claude/settings.json to use the cooked statusline
# (with a backup at ~/.claude/settings.json.before-cooked).

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

# 2. chmod scripts
chmod +x "$DEST/cooked/scripts/"*.sh 2>/dev/null || true

# 3. Register marketplace + install plugin via official CLI
if ! command -v claude >/dev/null 2>&1; then
    echo "✘ 'claude' CLI not found in PATH. Install Claude Code first." >&2
    exit 1
fi

echo "→ registering marketplace"
claude plugin marketplace add "$DEST" || true

echo "→ installing plugin"
claude plugin install cooked@cooked || true

# 4. Patch settings.json statusLine (Claude Code's plugin schema doesn't
#    accept statusLine in plugin.json, so we wire it through user settings).
STATUSLINE_PATH="$DEST/cooked/scripts/statusline.sh"

if [ -f "$SETTINGS" ]; then
    if [ ! -f "$BACKUP" ]; then
        cp "$SETTINGS" "$BACKUP"
        echo "→ backed up settings.json → $BACKUP"
    fi
else
    mkdir -p "$(dirname "$SETTINGS")"
    echo "{}" > "$SETTINGS"
fi

# Prefer jq (cleanest); fall back to python3 (always present on macOS).
if command -v jq >/dev/null 2>&1; then
    tmp=$(mktemp)
    jq --arg cmd "$STATUSLINE_PATH" \
       '.statusLine = { type: "command", command: $cmd, refreshInterval: 1, padding: 0 }' \
       "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
elif command -v python3 >/dev/null 2>&1; then
    python3 - "$SETTINGS" "$STATUSLINE_PATH" <<'PY'
import json, sys
path, cmd = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data["statusLine"] = {
    "type": "command",
    "command": cmd,
    "refreshInterval": 1,
    "padding": 0,
}
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
else
    echo "✘ Need jq or python3 to patch settings.json. Install one and re-run." >&2
    exit 1
fi

echo "→ patched settings.json statusLine"
echo
echo "✅ cooked installed. Restart Claude Code to activate."
echo
echo "   To revert later:"
echo "     bash $DEST/uninstall.sh"
