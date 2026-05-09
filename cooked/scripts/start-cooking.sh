#!/bin/bash
# UserPromptSubmit hook — turn-start. Drops the cooking marker, records start
# timestamp, and resets the per-turn stat logs.

input=$(cat)

SESSION_ID=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$SESSION_ID" ] && SESSION_ID="default"

touch "/tmp/paella-cooking-$SESSION_ID" 2>/dev/null
date +%s > "/tmp/paella-$SESSION_ID-start" 2>/dev/null
: > "/tmp/paella-$SESSION_ID-ops.log" 2>/dev/null
: > "/tmp/paella-$SESSION_ID-errors.log" 2>/dev/null
: > "/tmp/paella-$SESSION_ID-subagents.log" 2>/dev/null
: > "/tmp/paella-$SESSION_ID-files.log" 2>/dev/null
: > "/tmp/paella-$SESSION_ID-tools.log" 2>/dev/null

# Capture the user's prompt for the long-turn alert. Pure-bash JSON parsing
# is best-effort: the regex tolerates common \" / \n / \\ escapes, and an
# embedded unescaped quote will just truncate the label.
PROMPT=$(printf '%s' "$input" | tr '\n' ' ' \
    | sed -En 's/.*"prompt"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' \
    | sed 's/\\n/ /g; s/\\t/ /g; s/\\"/"/g; s/\\\\/\\/g')
printf '%s' "$PROMPT" > "/tmp/paella-$SESSION_ID-prompt" 2>/dev/null

exit 0
