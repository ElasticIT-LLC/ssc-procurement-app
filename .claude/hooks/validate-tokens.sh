#!/bin/bash
# Post-edit token-rule enforcement: BLOCKS the tool call when colors /
# typography choices in TSX or app.css don't inherit from the shell.
#
# Exit 1 on any violation (blocking). Exit 0 when clean.
#
# The ui-kit docs are the single source of truth for the token system and
# inheritance rules: node_modules/@elasticit-llc/ui-kit/docs/
#
# This hook flags anti-patterns that break adaptability:
#   - Hardcoded hex colors
#   - Raw Tailwind palette (ALL 17 color keys — not just gray family)
#   - shell-* / surface-* tokens (reserved for chrome / legacy)
#   - bg-[#hex] / text-[#hex] arbitrary-value hex utilities
#   - font-sans / font-serif / font-mono Tailwind utilities
#   - Inline style={{ fontFamily: ... }}
#   - @font-face / Google Fonts imports in app.css
#
# Rationale: one app bundle must adapt to every client shell (teal / blue /
# red / purple / green) in both light and dark modes. Violations lock the
# bundle to one client's palette or break light-mode flipping. Let the hook
# catch these at edit time — the alternative (per screening-system-app) is
# 175 violations accumulating in source under advisory-only enforcement.

INPUT=$(cat)
# Extract file_path from the hook's JSON payload. Prefer jq when available;
# fall back to a sed-based extractor so the hook still functions on systems
# without jq installed (Windows dev shells often lack it by default).
if command -v jq >/dev/null 2>&1; then
  FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  FILE=$(printf '%s' "$INPUT" | sed -nE 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -1)
fi

# Check TSX files and the app.css for src/
IS_TSX=$(echo "$FILE" | grep -qE 'src/.*\.tsx$' && echo yes)
IS_APP_CSS=$(echo "$FILE" | grep -qE 'src/app\.css$' && echo yes)
if [ -z "$IS_TSX" ] && [ -z "$IS_APP_CSS" ]; then
  exit 0
fi

[ -f "$FILE" ] || exit 0

WARNINGS=""

DOCS_URL="node_modules/@elasticit-llc/ui-kit/docs/app-ui-adaptation-guide.md"

# All 17 Tailwind default color-palette keys. Any of these + -{number} breaks adaptability.
ALL_PALETTES='gray|zinc|slate|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'

if [ -n "$IS_TSX" ]; then
  # Hardcoded hex (anywhere — JSX props, inline styles, const literals)
  if grep -qE '#[0-9a-fA-F]{3,8}\b' "$FILE" 2>/dev/null; then
    WARNINGS="$WARNINGS\n  - Hardcoded hex color. Use semantic tokens (bg-card, bg-muted, text-foreground, bg-primary, border-border) or bg-brand-<shade> for accents. See $DOCS_URL"
  fi

  # rgb()/rgba()/hsl()/hsla() color literals — same intent as hex, different syntax.
  # Blocks things like rgba(132, 202, 178, 1) that would otherwise bypass the hex check.
  # For translucent overlays, use Tailwind opacity syntax instead (bg-foreground/10).
  if grep -qE '\b(rgb|rgba|hsl|hsla)\s*\([^)]*[0-9]' "$FILE" 2>/dev/null; then
    WARNINGS="$WARNINGS\n  - rgb/rgba/hsl/hsla color literal. Same issue as hex — locks the app to one palette. Use semantic tokens or Tailwind opacity syntax (bg-foreground/10) for translucent overlays. See $DOCS_URL"
  fi

  # Arbitrary-value hex utilities: bg-[#hex], text-[#hex], fill-[#hex], etc.
  if grep -qE '(bg|text|border|ring|from|to|via|fill|stroke|decoration|outline|shadow)-\[#[0-9a-fA-F]+\]' "$FILE" 2>/dev/null; then
    WARNINGS="$WARNINGS\n  - Arbitrary hex utility (bg-[#hex], etc.) locks the app to one client brand. Use semantic tokens or var(--color-brand-500). See $DOCS_URL"
  fi

  # Raw Tailwind palette — ALL color keys (not just the gray family)
  if grep -qE "\b(bg|text|border|ring|from|to|via|fill|stroke|divide|placeholder|accent|caret|outline|shadow|decoration)-($ALL_PALETTES)-[0-9]" "$FILE" 2>/dev/null; then
    WARNINGS="$WARNINGS\n  - Raw Tailwind palette (doesn't adapt to client brand or flip in light mode). Use semantic tokens (bg-card, bg-muted, text-foreground, text-muted-foreground, border-border, bg-primary) or bg-brand-<shade>. See $DOCS_URL"
  fi

  # Legacy shell-* / surface-* tokens (reserved for chrome / back-compat only)
  if grep -qE '\b(bg|text|border|hover:bg|hover:text|hover:border|ring|fill|stroke)-(shell|surface)-[0-9]+' "$FILE" 2>/dev/null; then
    WARNINGS="$WARNINGS\n  - shell-*/surface-* are legacy tokens (reserved for shell chrome; don't flip in light mode). Use semantic content tokens (bg-card, bg-muted, text-foreground, border-border). See $DOCS_URL"
  fi

  if grep -qE '\b(font-sans|font-serif|font-mono)\b' "$FILE" 2>/dev/null; then
    WARNINGS="$WARNINGS\n  - font-sans/font-serif/font-mono override the shell's brand font. Use plain HTML elements and let font-family inherit via CSS cascade. Weights/sizes (font-semibold, text-2xl) are fine. See $DOCS_URL"
  fi

  if grep -qE "style=\{\{[^}]*fontFamily" "$FILE" 2>/dev/null; then
    WARNINGS="$WARNINGS\n  - Inline style={{ fontFamily: ... }} hardcodes a font. Inherit via cascade instead. See $DOCS_URL"
  fi
fi

if [ -n "$IS_APP_CSS" ]; then
  if grep -qE '^\s*@font-face' "$FILE" 2>/dev/null; then
    WARNINGS="$WARNINGS\n  - @font-face in app.css. The shell loads the client's brand fonts — don't reload them in the app. See $DOCS_URL"
  fi

  if grep -qE "@import\s+url\(['\"]?https?://fonts\." "$FILE" 2>/dev/null; then
    WARNINGS="$WARNINGS\n  - Google Fonts @import in app.css. The shell loads fonts; apps inherit via cascade. See $DOCS_URL"
  fi

  # Bare 'tailwindcss' import pulls a full reset + @theme block that overrides
  # the shell's brand tokens at runtime. Must use the utilities-only import.
  if grep -qE "^\s*@import\s+[\"']tailwindcss[\"']\s*;?\s*$" "$FILE" 2>/dev/null; then
    WARNINGS="$WARNINGS\n  - @import 'tailwindcss' (bare) bundles a reset + default theme that overrides the shell's brand at runtime. Use @import 'tailwindcss/utilities' instead. See $DOCS_URL"
  fi

  # :root / html overrides that set a --color-* to a literal color silently
  # replace the shell's brand values. Safe: var(--color-*) references inside
  # @theme reference blocks (which declare utilities without setting values).
  if grep -qE '^\s*--color-[a-z0-9-]+\s*:\s*(#[0-9a-fA-F]|rgb|hsl|[a-z]+\s*;)' "$FILE" 2>/dev/null; then
    WARNINGS="$WARNINGS\n  - Literal --color-* declaration in app.css overrides the shell's brand tokens. Only use var(--color-*) references inside @theme reference — never set a hex/rgb/hsl value. See $DOCS_URL"
  fi
fi

if [ -n "$WARNINGS" ]; then
  echo "❌ Token rule violations in $FILE:$WARNINGS" >&2
  exit 1  # BLOCK the edit — fix violations before proceeding
fi

exit 0
