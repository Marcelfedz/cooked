#!/bin/bash
# Stop hook — read per-turn stats, fire an adaptive notification (banner if
# the turn was short, sticky modal alert if long), then clean up.

input=$(cat)

SESSION_ID=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$SESSION_ID" ] && SESSION_ID="default"

OPS_FILE="/tmp/paella-$SESSION_ID-ops.log"
ERR_FILE="/tmp/paella-$SESSION_ID-errors.log"
SUBA_FILE="/tmp/paella-$SESSION_ID-subagents.log"
FILES_FILE="/tmp/paella-$SESSION_ID-files.log"
TOOLS_FILE="/tmp/paella-$SESSION_ID-tools.log"
PROMPT_FILE="/tmp/paella-$SESSION_ID-prompt"
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

# Long-turn extras: files modified count + finish timestamp. These are only
# rendered on the sticky alert (you walked away — give yourself more context).
FILES_TOUCHED=0
[ -f "$FILES_FILE" ] && FILES_TOUCHED=$(sort -u "$FILES_FILE" 2>/dev/null | sed '/^$/d' | wc -l | tr -d ' ')
[ -z "$FILES_TOUCHED" ] && FILES_TOUCHED=0

NOW_HM=$(date +"%H:%M")

if [ "$FILES_TOUCHED" -gt 0 ]; then
    if [ "$FILES_TOUCHED" -eq 1 ]; then
        FILE_LABEL="file"
    else
        FILE_LABEL="files"
    fi
    EXTRA="${FILES_TOUCHED} ${FILE_LABEL} modified · finished ${NOW_HM}"
else
    EXTRA="finished ${NOW_HM}"
fi

# Build the long-turn bullet block: top dirs touched + tool mix. Only computed
# here; only rendered into the sticky alert below (banners are too narrow).
BULLETS=""
if [ $ELAPSED -ge $THRESHOLD ]; then
    # Top 2 parent directories from the unique file list, by file count.
    if [ -f "$FILES_FILE" ] && [ "$FILES_TOUCHED" -gt 0 ]; then
        DIR_LINES=$(sort -u "$FILES_FILE" 2>/dev/null | sed '/^$/d' \
            | awk -F/ 'NF >= 2 { print $(NF-1) }' \
            | sort | uniq -c | sort -rn | head -2 \
            | awk '{ count=$1; $1=""; sub(/^[ \t]+/, ""); label=(count==1?"file":"files"); printf "• %s/  — %d %s\n", $0, count, label }')
        [ -n "$DIR_LINES" ] && BULLETS="$DIR_LINES"
    fi

    # Tool mix — count Bash and Read calls; pluralize naturally.
    if [ -f "$TOOLS_FILE" ]; then
        BASH_COUNT=$(grep -c '^Bash$' "$TOOLS_FILE" 2>/dev/null)
        READ_COUNT=$(grep -c '^Read$' "$TOOLS_FILE" 2>/dev/null)
        [ -z "$BASH_COUNT" ] && BASH_COUNT=0
        [ -z "$READ_COUNT" ] && READ_COUNT=0
        MIX=""
        [ "$BASH_COUNT" -gt 0 ] && MIX="${BASH_COUNT} bash"
        if [ "$READ_COUNT" -gt 0 ]; then
            [ -n "$MIX" ] && MIX="${MIX} · ${READ_COUNT} reads" || MIX="${READ_COUNT} reads"
        fi
        if [ -n "$MIX" ]; then
            [ -n "$BULLETS" ] && BULLETS="${BULLETS}
• ${MIX}" || BULLETS="• ${MIX}"
        fi
    fi

    # Sub-agent count — already tallied above as COOKS_LAUNCHED.
    if [ "$COOKS_LAUNCHED" -gt 0 ]; then
        SUBA_LABEL="sub-agents"
        [ "$COOKS_LAUNCHED" -eq 1 ] && SUBA_LABEL="sub-agent"
        [ -n "$BULLETS" ] && BULLETS="${BULLETS}
• ${COOKS_LAUNCHED} ${SUBA_LABEL}" || BULLETS="• ${COOKS_LAUNCHED} ${SUBA_LABEL}"
    fi

    # Echo the user's original prompt so the alert says *what was asked*, not
    # just where the work happened. Truncate to keep the alert tight.
    if [ -f "$PROMPT_FILE" ] && [ -s "$PROMPT_FILE" ]; then
        PROMPT_TXT=$(cat "$PROMPT_FILE" 2>/dev/null)
        if [ ${#PROMPT_TXT} -gt 80 ]; then
            PROMPT_TXT="${PROMPT_TXT:0:77}…"
        fi
        ASKED_LINE="Asked: \"${PROMPT_TXT}\""
        if [ -n "$BULLETS" ]; then
            BULLETS="${ASKED_LINE}
${BULLETS}"
        else
            BULLETS="${ASKED_LINE}"
        fi
    fi
fi

# Clean up state files now (before notification, so even if osascript hangs
# the next turn starts fresh).
rm -f "$MARKER" "$OPS_FILE" "$ERR_FILE" "$SUBA_FILE" "$FILES_FILE" "$TOOLS_FILE" "$PROMPT_FILE" "$START_FILE" 2>/dev/null

ICON_PATH="${CLAUDE_PLUGIN_ROOT}/assets/cooked.jpeg"

if [ $ELAPSED -ge $THRESHOLD ] && command -v osascript >/dev/null 2>&1; then
    # Long turn — sticky modal alert, requires click to dismiss
    # (osascript display alert is the only macOS primitive that's reliably sticky)
    if [ -n "$BULLETS" ]; then
        # Escape \ and " for AppleScript string interpolation — the prompt
        # echo can introduce either.
        BULLETS_ESC=$(printf '%s' "$BULLETS" | sed 's/\\/\\\\/g; s/"/\\"/g')
        ALERT_MSG="Cooked! — ${BODY}
${EXTRA}

${BULLETS_ESC}"
    else
        ALERT_MSG="Cooked! — ${BODY}
${EXTRA}"
    fi
    osascript >/dev/null 2>&1 <<EOF &
display alert "Claude Code 🥘" message "${ALERT_MSG}" as informational
EOF
    disown 2>/dev/null
elif command -v terminal-notifier >/dev/null 2>&1; then
    # Short turn (or fallback) — branded banner via terminal-notifier
    # (lets us set a custom paella appIcon instead of the Script Editor default)
    if [ -f "$ICON_PATH" ]; then
        terminal-notifier -title "Claude Code" -subtitle "Cooked!" -message "$BODY" \
            -appIcon "$ICON_PATH" -sound Ping >/dev/null 2>&1 &
    else
        terminal-notifier -title "Claude Code" -subtitle "Cooked!" -message "$BODY" \
            -sound Ping >/dev/null 2>&1 &
    fi
    disown 2>/dev/null
elif command -v osascript >/dev/null 2>&1; then
    # Short turn fallback — vanilla osascript banner (Script Editor icon)
    osascript >/dev/null 2>&1 <<EOF &
display notification "${BODY}" with title "Claude Code" subtitle "Cooked!" sound name "Ping"
EOF
    disown 2>/dev/null
elif command -v notify-send >/dev/null 2>&1; then
    if [ $ELAPSED -lt $THRESHOLD ]; then
        notify-send -i "$ICON_PATH" "Claude Code" "Cooked! — ${BODY}" 2>/dev/null
    else
        if [ -n "$BULLETS" ]; then
            notify-send -u critical -i "$ICON_PATH" "Claude Code" "Cooked! — ${BODY}
${EXTRA}

${BULLETS}" 2>/dev/null
        else
            notify-send -u critical -i "$ICON_PATH" "Claude Code" "Cooked! — ${BODY}" 2>/dev/null
        fi
    fi
fi

exit 0
