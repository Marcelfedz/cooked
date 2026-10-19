#!/usr/bin/env bash
# cooked uninstaller. Uninstalls the plugin, restores settings.json from the
# backup install.sh made (if any), and removes the marketplace clone and the
# kitchen files.

set -euo pipefail

DEST="$HOME/.claude/plugins/marketplaces/cooked"
SETTINGS="$HOME/.claude/settings.json"
BACKUP="$HOME/.claude/settings.json.before-cooked"

echo "🥘 cooked uninstaller"

if command -v claude >/dev/null 2>&1; then
    echo "→ uninstalling plugin"
    claude plugin uninstall cooked 2>/dev/null || true
    echo "→ removing marketplace"
    claude plugin marketplace remove cooked 2>/dev/null || true
fi

if [ -f "$BACKUP" ]; then
    echo "→ restoring settings.json from $BACKUP"
    cp "$BACKUP" "$SETTINGS"
    rm -f "$BACKUP"
fi

if [ -d "$DEST" ]; then
    echo "→ removing $DEST"
    rm -rf "$DEST"
fi

# The kitchen (v3) and any v2 leftovers in /tmp
rm -rf "$HOME/.claude/cooked" 2>/dev/null || true
rm -f /tmp/paella-cooking-* /tmp/paella-*-{start,ops.log,errors.log,subagents.log,files.log,tools.log,prompt} 2>/dev/null || true

echo "✅ cooked uninstalled. Restart Claude Code."
