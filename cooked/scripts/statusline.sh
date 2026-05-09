#!/bin/bash
# Paella v2 statusline — live activity meter while Claude is cooking,
# idle plate when not. Reads JSON session info from stdin (Claude Code).

input=$(cat)

C_FLAME=$'\033[38;5;208m'
C_RICE=$'\033[38;5;179m'
C_HERB=$'\033[38;5;114m'
C_DIM=$'\033[38;5;240m'
C_RST=$'\033[0m'

SESSION_ID=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$SESSION_ID" ] && SESSION_ID="default"

model=$(printf '%s' "$input" | sed -n 's/.*"display_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$model" ] && model=$(printf '%s' "$input" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$model" ] && model="claude"

if [ ! -f "/tmp/paella-cooking-$SESSION_ID" ]; then
    printf '%b' "${C_RICE}🥘 cooked${C_RST}${C_DIM}  ·  ${model}${C_RST}"
    exit 0
fi

OPS_FILE="/tmp/paella-$SESSION_ID-ops.log"
SUBA_FILE="/tmp/paella-$SESSION_ID-subagents.log"
START_FILE="/tmp/paella-$SESSION_ID-start"

OPS=0
[ -f "$OPS_FILE" ] && OPS=$(wc -l < "$OPS_FILE" 2>/dev/null | tr -d ' ')
[ -z "$OPS" ] && OPS=0

COOKS=0
[ -f "$SUBA_FILE" ] && COOKS=$(awk '{ s += $1 } END { print s+0 }' "$SUBA_FILE" 2>/dev/null)
[ -z "$COOKS" ] && COOKS=0

NOW=$(date +%s)
START=$NOW
[ -f "$START_FILE" ] && START=$(cat "$START_FILE" 2>/dev/null)
[ -z "$START" ] && START=$NOW
ELAPSED=$(( NOW - START ))
[ $ELAPSED -lt 0 ] && ELAPSED=0

if [ $ELAPSED -lt 60 ]; then
    ELAPSED_FMT="${ELAPSED}s"
else
    MINS=$(( ELAPSED / 60 ))
    SECS=$(( ELAPSED % 60 ))
    ELAPSED_FMT="${MINS}m${SECS}s"
fi

if [ "$OPS" -eq 0 ]; then
    # warming up — show the v1 cooking animation until the first tool fires
    frame=$(( NOW % 8 ))
    case $frame in
        0) verb="cooking";   dots="";       fire="${C_FLAME}🔥${C_RST} " ;;
        1) verb="cooking";   dots=" .";     fire="${C_FLAME}🔥${C_RST} " ;;
        2) verb="cooking";   dots=" . .";   fire="${C_FLAME}🔥${C_RST} " ;;
        3) verb="cooking";   dots=" . . ."; fire="${C_FLAME}🔥${C_RST} " ;;
        4) verb="simmering"; dots="";       fire="" ;;
        5) verb="simmering"; dots=" .";     fire="" ;;
        6) verb="simmering"; dots=" . .";   fire="" ;;
        7) verb="simmering"; dots=" . . ."; fire="" ;;
    esac
    printf '%b' "${fire}${C_RICE}🥘${C_RST} ${C_HERB}${verb}${dots}${C_RST}${C_DIM}  ·  ${model}${C_RST}"
    exit 0
fi

# active — render activity meter
if [ "$COOKS" -gt 0 ]; then
    if [ "$COOKS" -eq 1 ]; then
        cooks_label="cook"
    else
        cooks_label="cooks"
    fi
    cooks_segment="${C_DIM} · ${C_RST}${C_HERB}${COOKS} ${cooks_label}${C_RST}"
else
    cooks_segment=""
fi

printf '%b' "${C_FLAME}🔥${C_RST} ${C_RICE}🥘${C_RST} ${C_RICE}${OPS} ops${C_RST}${cooks_segment}${C_DIM} · ${C_RST}${C_HERB}${ELAPSED_FMT}${C_RST}${C_DIM}  ·  ${model}${C_RST}"
