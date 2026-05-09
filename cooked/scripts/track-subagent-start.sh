#!/bin/bash
# SubagentStart hook — increment the active-subagent counter.

SESSION_ID=$(sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$SESSION_ID" ] && SESSION_ID="default"

printf '+1\n' >> "/tmp/paella-$SESSION_ID-subagents.log" 2>/dev/null

exit 0
