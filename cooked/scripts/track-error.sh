#!/bin/bash
# PostToolUseFailure hook — count tool failures so the finish notification
# can flip the outcome icon to ❌.

SESSION_ID=$(sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$SESSION_ID" ] && SESSION_ID="default"

printf '!\n' >> "/tmp/paella-$SESSION_ID-errors.log" 2>/dev/null

exit 0
