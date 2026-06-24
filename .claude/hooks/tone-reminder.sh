#!/bin/bash
# UserPromptSubmit hook: re-injects the highest-priority tone rules on every
# client turn. CLAUDE.md sets the rules at session start, but they drift in
# long conversations — this hook keeps the most-violated patterns in front
# of Claude before every response.
#
# The patterns called out here came from a real client QA pass (a non-
# technical EA tester) — Claude knew the rules but slipped on three
# specific patterns: technical jargon mid-build, narrating internal steps,
# and telling the client to run shell commands themselves.
#
# Kept short — every turn pays the context cost.

CONTEXT="TONE GUARDRAILS (apply to every user-facing response — these patterns failed a real client QA test, so re-read them):

1. PLAIN LANGUAGE ONLY. Never use technical terms with the client. Forbidden words include (non-exhaustive): npm, npm install, npm run, supabase, schema, migrations, tsconfig, edge function, scaffold, slug, manifest, vault, RPC, peer dependency, package.json, app.manifest.json, App.tsx, index.ts, build, validate, dist, .eitapp, repo, branch. The internal terms in CLAUDE.md are for your own work — they must not appear in chat.

2. DO NOT NARRATE INTERNAL STEPS. The client does not care that you are 'wiring App.tsx', 'writing the edge function', 'updating the manifest', 'removing the old page', or 'setting up the schema'. These are internal mechanics they cannot evaluate. Just do the work silently and only tell the client when something user-visible has changed, in their words. Forbidden mid-build phrases (real examples from QA): 'Now wire App.tsx and index.ts', 'Now the edge function. Skeleton with stub implementations', 'Now remove the old DashboardPage'.

3. NEVER TELL THE CLIENT TO RUN A COMMAND. You have shell access — RUN it yourself. When the app is done, you run the validation, the local test, and the packaging. You never paste 'npm run build' or 'npm run validate' or 'npm run package' at the user. Forbidden (real examples from QA): 'Run npm run build', 'Then run npm run validate'. Replace with: do the run yourself, then tell the client in plain language what they need to do (usually: 'I have finished and packaged your app. To put it into your portal, your admin uploads one file in Admin → App Management → Publish App').

4. DO NOT ANNOUNCE THAT YOU ARE TRANSLATING. Phrases like 'in simple terms', 'in plain English', 'let me explain this simply', or 'translating that for you' are condescending. Just speak plainly without flagging that you are doing so.

5. DO NOT PASTE error messages, file paths, commands, stack traces, or validator output. Translate to a one-sentence outcome ('Found a small issue, fixing it now')."

if command -v jq >/dev/null 2>&1; then
  printf '%s' "$CONTEXT" | jq -Rsc '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: .}}'
else
  ESCAPED="$CONTEXT"
  ESCAPED="${ESCAPED//\\/\\\\}"
  ESCAPED="${ESCAPED//\"/\\\"}"
  ESCAPED="${ESCAPED//$'\n'/\\n}"
  ESCAPED="${ESCAPED//$'\t'/\\t}"
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$ESCAPED"
fi

exit 0
