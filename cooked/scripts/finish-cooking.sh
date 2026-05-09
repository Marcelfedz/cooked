#!/bin/bash
# Stop hook — read per-turn stats, fire an adaptive notification (banner if
# the turn was short, sticky modal alert if long), then clean up.

input=$(cat)

SESSION_ID=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$SESSION_ID" ] && SESSION_ID="default"

OPS_FILE="/tmp/paella-$SESSION_ID-ops.log"
ERR_FILE="/tmp/paella-$SESSION_ID-errors.log"
SUBA_FILE="/tmp/paella-$SESSION_ID-subagents.log"
START_FILE="/tmp/paella-$SESSION_ID-start"
MARKER="/tmp/paella-cooking-$SESSION_ID"

# Threshold — short vs long turn (seconds). Tweakable via env var.
THRESHOLD=${PAELLA_ALERT_THRESHOLD:-120}

OPS=0
[ -f "$OPS_FILE" ] && OPS=$(wc -l < "$OPS_FILE" 2>/dev/null | tr -d ' ')
[ -z "$OPS" ] && OPS=0

ERRORS=0
[ -f "$ERR_FILE" ] && ERRORS=$(wc -l < "$ERR_FILE" 2>/dev/null | tr -d ' ')
[ -z "$ERRORS" ] && ERRORS=0

COOKS_LAUNCHED=0
[ -f "$SUBA_FILE" ] && COOKS_LAUNCHED=$(grep -c '^+1' "$SUBA_FILE" 2>/dev/null)
[ -z "$COOKS_LAUNCHED" ] && COOKS_LAUNCHED=0

NOW=$(date +%s)
START=$NOW
[ -f "$START_FILE" ] && START=$(cat "$START_FILE" 2>/dev/null)
[ -z "$START" ] && START=$NOW
ELAPSED=$(( NOW - START ))
[ $ELAPSED -lt 0 ] && ELAPSED=0

if [ "$ERRORS" -eq 0 ]; then
    ICON="✅"
else
    ICON="❌"
fi

if [ $ELAPSED -lt 60 ]; then
    ELAPSED_FMT="${ELAPSED}s"
else
    MINS=$(( ELAPSED / 60 ))
    SECS=$(( ELAPSED % 60 ))
    ELAPSED_FMT="${MINS}m ${SECS}s"
fi

if [ "$COOKS_LAUNCHED" -gt 0 ]; then
    BODY="${OPS} ops · ${COOKS_LAUNCHED} cooks · ${ELAPSED_FMT} · ${ICON}"
else
    BODY="${OPS} ops · ${ELAPSED_FMT} · ${ICON}"
fi

# Clean up state files now (before notification, so even if osascript hangs
# the next turn starts fresh).
rm -f "$MARKER" "$OPS_FILE" "$ERR_FILE" "$SUBA_FILE" "$START_FILE" 2>/dev/null

if command -v osascript >/dev/null 2>&1; then
    if [ $ELAPSED -lt $THRESHOLD ]; then
        # Short turn — quiet banner, auto-dismiss
        osascript >/dev/null 2>&1 <<EOF &
display notification "${BODY}" with title "Claude Code" subtitle "Cooked!" sound name "Ping"
EOF
    else
        # Long turn — sticky modal alert, requires click to dismiss
        osascript >/dev/null 2>&1 <<EOF &
display alert "Claude Code 🥘" message "Cooked! — ${BODY}" as informational
EOF
    fi
    disown 2>/dev/null
elif command -v notify-send >/dev/null 2>&1; then
    if [ $ELAPSED -lt $THRESHOLD ]; then
        notify-send "Claude Code" "Cooked! — ${BODY}" 2>/dev/null
    else
        notify-send -u critical "Claude Code" "Cooked! — ${BODY}" 2>/dev/null
    fi
fi

exit 0
