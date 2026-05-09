#!/bin/bash
# PostToolUse hook — append one tally line per tool invocation, plus the
# file path when the tool was Edit/Write/MultiEdit (so the long-turn alert
# can show "N files modified").

input=$(cat)

SESSION_ID=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$SESSION_ID" ] && SESSION_ID="default"

printf '.\n' >> "/tmp/paella-$SESSION_ID-ops.log" 2>/dev/null

# Track unique files touched by Edit/Write/MultiEdit. file_path is the
# top-level field in tool_input for all three.
TOOL=$(printf '%s' "$input" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
case "$TOOL" in
    Edit|Write|MultiEdit)
        FILE=$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
        [ -n "$FILE" ] && printf '%s\n' "$FILE" >> "/tmp/paella-$SESSION_ID-files.log" 2>/dev/null
        ;;
esac

exit 0
