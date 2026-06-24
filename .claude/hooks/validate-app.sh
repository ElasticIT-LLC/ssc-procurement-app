#!/bin/bash
# Post-edit: runs scripts/validate.ts after Claude edits template-critical files.
# Errors surface to Claude via stderr + exit 2 so it can self-correct before moving on.
# Warnings are silent here (validator surfaces them at build time instead).

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Only run the validator when a file that affects the manifest ↔ source contract changes.
case "$FILE" in
  */app.manifest.json|*/package.json|*/vite.config.ts)
    ;;
  */src/*.ts|*/src/*.tsx|*/src/**/*.ts|*/src/**/*.tsx|*/src/app.css)
    ;;
  */migrations/*.sql)
    ;;
  *)
    exit 0
    ;;
esac

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

# Skip if tsx / validator are not present (fresh clone, install not run yet)
[ -f scripts/validate.ts ] || exit 0
[ -d node_modules/tsx ] || [ -x "$(command -v tsx)" ] || exit 0

OUTPUT=$(npx --no-install tsx scripts/validate.ts 2>&1)
STATUS=$?

# Exit 0: validator clean, stay silent
if [ $STATUS -eq 0 ]; then
  exit 0
fi

# Exit 1: validator found errors — surface to Claude
echo "" >&2
echo "App template validator found issues that must be resolved:" >&2
echo "$OUTPUT" >&2
exit 2
