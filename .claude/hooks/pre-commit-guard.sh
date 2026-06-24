#!/bin/bash
# Pre-commit guard: blocks commits containing secrets or failing type checks
# Exit 2 = block, Exit 0 = allow

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Only check git commit commands
if ! echo "$COMMAND" | grep -q 'git commit'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

# Check for staged secret files
STAGED=$(git diff --cached --name-only 2>/dev/null)
BLOCKED=""
for f in $STAGED; do
  case "$f" in
    .env|.env.local|.env.onboard|credentials.json|**/secrets/*|deployments/elasticit.env)
      BLOCKED="$BLOCKED $f"
      ;;
  esac
done

if [ -n "$BLOCKED" ]; then
  echo "BLOCKED: Secrets detected in staged files:$BLOCKED" >&2
  echo "Remove these files from staging: git reset HEAD <file>" >&2
  exit 2
fi

# Run type check if TypeScript files are staged
if echo "$STAGED" | grep -qE '\.(ts|tsx)$'; then
  if [ -f "tsconfig.json" ]; then
    npx tsc --noEmit 2>&1 | tail -5 >&2
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
      echo "BLOCKED: TypeScript errors found. Fix them before committing." >&2
      exit 2
    fi
  fi
fi

exit 0
