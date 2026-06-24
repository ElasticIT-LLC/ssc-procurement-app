#!/usr/bin/env bash
# Scaffold a new app from this template into a sibling folder.
#
# Usage:
#   bash scripts/scaffold.sh <slug>
#
# What it does:
#   1. Validates the slug (lowercase + hyphens, 3-32 chars, not reserved, not template default)
#   2. Creates ../<slug>/ (fails if it already exists)
#   3. Copies all template files EXCEPT .git/, node_modules/, dist/, .husky/_/
#   4. Inside ../<slug>/: git init, npm install (activates husky), initial commit
#   5. Exits cleanly, instructing you to `cd ../<slug>`
#
# Works on macOS, Linux, and Windows (via Git Bash).
#
# After scaffolding, also run these manual edits before writing code:
#   - app.manifest.json — set slug, name, icon, permissions, pages
#   - package.json — set name to match slug (or @your-org/<slug>)

set -euo pipefail

# ── Args ────────────────────────────────────────────────────────────────
SLUG="${1:-}"

if [ -z "$SLUG" ]; then
  echo "error: slug is required" >&2
  echo "usage: bash scripts/scaffold.sh <slug>" >&2
  exit 1
fi

# ── Validate slug ───────────────────────────────────────────────────────
if ! printf '%s' "$SLUG" | grep -Eq '^[a-z][a-z0-9-]{2,31}$'; then
  echo "error: slug \"$SLUG\" is invalid" >&2
  echo "  - lowercase letters, digits, hyphens only" >&2
  echo "  - must start with a letter" >&2
  echo "  - 3-32 characters" >&2
  exit 1
fi

# Reserved slugs (must match scripts/validate.ts RESERVED_SLUGS)
for reserved in admin shell portal app apps login; do
  if [ "$SLUG" = "$reserved" ]; then
    echo "error: slug \"$SLUG\" is reserved — conflicts with shell/portal concepts" >&2
    exit 1
  fi
done

if [ "$SLUG" = "my-app" ]; then
  echo "error: slug \"my-app\" is the template default — pick something specific to your app (e.g., inventory, field-ops, billing)" >&2
  exit 1
fi

# ── Resolve source + target dirs ────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$(cd "$SOURCE_DIR/.." && pwd)/$SLUG"

if [ -e "$TARGET_DIR" ]; then
  echo "error: $TARGET_DIR already exists — pick a different slug or remove the existing directory first" >&2
  exit 1
fi

echo "→ Scaffolding \"$SLUG\" from $(basename "$SOURCE_DIR")"
echo "  source: $SOURCE_DIR"
echo "  target: $TARGET_DIR"
echo ""

# ── Copy files (excluding .git, node_modules, dist, .husky/_) ───────────
mkdir -p "$TARGET_DIR"

# Use tar for portable exclude-aware copy. Git Bash on Windows + macOS + Linux all have tar.
# BSD tar (macOS) and GNU tar (Linux) both support these flags.
(cd "$SOURCE_DIR" && tar -cf - \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./.husky/_' \
  . ) | (cd "$TARGET_DIR" && tar -xf -)

echo "✓ Files copied"

# ── Fresh git history ───────────────────────────────────────────────────
cd "$TARGET_DIR"
git init --initial-branch=main --quiet
echo "✓ git init"

# ── Install deps (activates husky via prepare script) ───────────────────
echo "→ Running npm install (activates husky pre-commit hook)..."
npm install --silent
echo "✓ npm install"

# ── Initial commit ──────────────────────────────────────────────────────
git add .
git commit --quiet -m "chore: scaffold from elasticit-app-template"
echo "✓ Initial commit"

# ── Done ────────────────────────────────────────────────────────────────
echo ""
echo "Scaffold complete."
echo ""
echo "Next steps:"
echo "  cd $TARGET_DIR"
echo "  # Edit app.manifest.json (slug, name, icon, permissions, pages)"
echo "  # Edit package.json (name to match slug or @your-org/$SLUG)"
echo "  # Start building: see CLAUDE.md First-Turn Protocol for full onboarding"
