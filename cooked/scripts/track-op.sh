#!/bin/bash
# PostToolUse hook — append one tally line per tool invocation.
# Fast path: must run in well under 50ms.

SESSION_ID=$(sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$SESSION_ID" ] && SESSION_ID="default"

printf '.\n' >> "/tmp/paella-$SESSION_ID-ops.log" 2>/dev/null

exit 0
