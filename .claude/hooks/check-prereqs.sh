#!/bin/bash
# SessionStart hook: verifies the tools we need are installed before any
# onboarding work begins. If something's missing, hands Claude a strict
# instruction to STOP and route the user to ElasticIT support — clients
# do not have the technical background to install Node.js, git, etc. on
# their own, and walking them through it during a live call eats time.
#
# Exit 0 always (advisory). Output (when something's missing) is JSON for
# the SessionStart hook's additionalContext so Claude sees it before its
# first response.

# ─────────────────────────────────────────────────────────────────────────
# Sandbox detection (must run FIRST — short-circuits the regular tool check)
#
# Symptom this catches: client connects Claude Desktop App to the GitHub
# repo. Claude Desktop runs commands inside an Anthropic-hosted Linux
# sandbox, NOT on the user's PC. The sandbox doesn't have Node.js / git /
# Podman / Supabase CLI installed and ElasticIT can never make it install
# them — the sandbox tears down each session. Result: an unfixable
# false-negative where Claude keeps blaming the user/ElasticIT for missing
# tools that are actually present on the user's real machine.
#
# Detection: Linux container (no Windows env vars + container indicators).
# Real client machines are Windows (WINDIR set) or macOS (no /.dockerenv).
# A genuine Linux dev box without these indicators is rare for this
# template's audience and would just hit the regular tool check anyway.
# ─────────────────────────────────────────────────────────────────────────
SANDBOX_DETECTED=false
if [ -z "${WINDIR:-}" ] && [ -z "${SystemRoot:-}" ] && [ -z "${USERPROFILE:-}" ]; then
  if [ -f /.dockerenv ] || grep -qiE 'docker|containerd|kubepods' /proc/1/cgroup 2>/dev/null; then
    SANDBOX_DETECTED=true
  fi
fi

if [ "$SANDBOX_DETECTED" = true ]; then
  SANDBOX_CONTEXT=$(cat <<'SANDBOX'
WRONG ENVIRONMENT DETECTED. STOP IMMEDIATELY.

You are running inside a Cloud environment (Anthropic-hosted container) — NOT on the user's actual computer. The user IS in the correct app (Claude Code), but the environment selector at the bottom-left of their Claude window is set to "Cloud" or "Default" (a cloud sandbox) instead of "Local" (their own computer). The cloud sandbox has no Node.js, no git, no Docker/Podman, no Supabase CLI, and cannot reach the user's PC where those tools are installed.

Do NOT proceed with onboarding, scaffolding, or any tool checks. The regular prerequisite check would always fail in this environment regardless of what is actually installed on the user's machine.

Walk the user through the fix yourself, in plain non-technical language. IMPORTANT: the environment selector is only visible at the bottom-left of a NEW session — once a session has any messages in it, the selector is hidden behind the chat. So the user has to start a fresh session to flip it. Use this shape (paraphrase to fit the conversation, do not paste verbatim):

  Quick fix — you are in the right app, just the wrong environment. Right now Claude is running on Anthropic's cloud computers, which is why it cannot see anything on your computer. The dropdown to switch is only visible at the start of a fresh session, so we will need to open one. Here is what to do:

  1. In the left sidebar, click "+ New session" (near the top).
  2. In the new window that opens, look at the bottom-left of the message box. You will see a small selector — it probably says "Default" or "Cloud" right now, with a cloud icon next to it.
  3. Click on that selector and choose "Local" (it has a little laptop icon).
  4. If it asks which folder to open, pick the project folder for this app.
  5. Just tell me again what you want to build — we will pick right up from there, this time running on your computer.

  No download, no install needed — just a fresh session with the dropdown set to Local. You will have to repeat what you wanted to build (since the new session starts clean), but everything after that goes faster because we are now actually on your machine.

  (If after the switch you see a message saying some helper tools are missing, that is the only point where ElasticIT support needs to help you — they install those tools for you in one go.)

Then wait. Do NOT continue with onboarding work in this session — the rest of the build has to happen in the new session with the Local environment selected.
SANDBOX
)

  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$SANDBOX_CONTEXT" | jq -Rsc '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: .}}'
  else
    ESC="$SANDBOX_CONTEXT"
    ESC="${ESC//\\/\\\\}"
    ESC="${ESC//\"/\\\"}"
    ESC="${ESC//$'\n'/\\n}"
    ESC="${ESC//$'\t'/\\t}"
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$ESC"
  fi
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────
# Cloud-sync folder detection (must run after sandbox check, before tool
# check). Symptom: client extracted the GitHub ZIP into a OneDrive /
# Dropbox / iCloud / Google Drive folder. The local-dev stack does too
# much concurrent I/O on the project folder (npm install, Docker bind
# mounts of local-dev/supabase/, Postgres WAL writes inside the container)
# for a sync filter driver to keep up — failures are fixable only by
# moving the project to a non-synced path. There is no settings-level
# workaround that holds across all three I/O sources.
#
# `pwd -P` resolves any junction/symlink so `mklink /J` workarounds that
# alias a non-synced path back into OneDrive still get caught.
# ─────────────────────────────────────────────────────────────────────────
CWD_REAL=$(pwd -P 2>/dev/null || pwd)
SYNC_DETECTED=false
case "$CWD_REAL" in
  *OneDrive*|*Dropbox*|*"Google Drive"*|*"Mobile Documents"*|*"Box Sync"*)
    SYNC_DETECTED=true
    ;;
esac

if [ "$SYNC_DETECTED" = true ]; then
  SYNC_CONTEXT=$(cat <<SYNC
CLOUD-SYNC FOLDER DETECTED. STOP IMMEDIATELY before any other action.

The project is inside a cloud-sync folder (OneDrive, Dropbox, iCloud, Google Drive, or Box). The current path is:

  ${CWD_REAL}

The local development stack cannot run from here. Cloud-sync filter drivers conflict with three things this stack does at once: npm installing tens of thousands of files, Docker bind-mounting the project folder into Linux containers, and Postgres writing transaction logs inside that bind mount. There is no settings-level workaround — "Always keep on this device", excluding node_modules from sync, junction points, etc. all fail in different ways. The project must physically live outside any cloud-sync folder.

Walk the user through the move yourself, in plain non-technical language. Use this shape (paraphrase to fit, do not paste verbatim):

  Quick fix needed before we can build. The project is inside your OneDrive folder, and that conflicts with the development tools we use — they need a folder that isn't being continuously synced to the cloud. The fix is to move the project to a regular folder on your computer.

  Open PowerShell on your computer and run these commands one at a time. (You can copy-paste; press Enter after each.)

      mkdir C:\\Code -Force
      cd C:\\Code
      git clone https://github.com/ElasticIT-LLC/elasticit-app-template.git my-app
      cd my-app

  That gives you a fresh copy at C:\\Code\\my-app. Open that new folder in Claude Code (File > Open Folder, then pick C:\\Code\\my-app), and tell me again what you want to build — we will pick right up. The OneDrive copy can be deleted; nothing important lives there yet.

  (If the user has already customized files like brand.json or app.manifest.json in the OneDrive copy, tell them to copy those specific files from the OneDrive copy to the new C:\\Code\\my-app location before deleting.)

Then wait. Do NOT continue with any other work in this session — the rest of the build has to happen from the new non-synced location.
SYNC
)

  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$SYNC_CONTEXT" | jq -Rsc '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: .}}'
  else
    ESC="$SYNC_CONTEXT"
    ESC="${ESC//\\/\\\\}"
    ESC="${ESC//\"/\\\"}"
    ESC="${ESC//$'\n'/\\n}"
    ESC="${ESC//$'\t'/\\t}"
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$ESC"
  fi
  exit 0
fi

MISSING_LIST=""

if ! command -v node >/dev/null 2>&1; then
  MISSING_LIST="${MISSING_LIST}  - Node.js v22 or newer (not installed)"$'\n'
else
  NODE_MAJOR=$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)
  case "$NODE_MAJOR" in
    ''|*[!0-9]*)
      MISSING_LIST="${MISSING_LIST}  - Node.js v22 or newer (could not detect version)"$'\n'
      ;;
    *)
      if [ "$NODE_MAJOR" -lt 22 ]; then
        MISSING_LIST="${MISSING_LIST}  - Node.js v22 or newer (currently $(node --version))"$'\n'
      fi
      ;;
  esac
fi

if ! command -v npm >/dev/null 2>&1; then
  MISSING_LIST="${MISSING_LIST}  - npm (usually installed with Node.js)"$'\n'
fi

if ! command -v git >/dev/null 2>&1; then
  MISSING_LIST="${MISSING_LIST}  - git"$'\n'
fi

# Container runtime — Docker OR Podman is acceptable. Required for the local
# test stack the pre-publish checklist runs before packaging the .eitapp.
if ! command -v docker >/dev/null 2>&1 && ! command -v podman >/dev/null 2>&1; then
  MISSING_LIST="${MISSING_LIST}  - Docker Desktop or Podman (container runtime)"$'\n'
fi

# Supabase CLI v2.84+ — orchestrates the local Postgres / Auth / Edge Functions
# stack via the container runtime above.
if ! command -v supabase >/dev/null 2>&1; then
  MISSING_LIST="${MISSING_LIST}  - Supabase CLI v2.84 or newer (not installed)"$'\n'
else
  SB_VERSION=$(supabase --version 2>/dev/null | tr -d '[:space:]')
  SB_MAJOR=$(printf '%s' "$SB_VERSION" | cut -d. -f1)
  SB_MINOR=$(printf '%s' "$SB_VERSION" | cut -d. -f2)
  case "$SB_MAJOR" in
    ''|*[!0-9]*)
      MISSING_LIST="${MISSING_LIST}  - Supabase CLI v2.84 or newer (could not detect version)"$'\n'
      ;;
    *)
      if [ "$SB_MAJOR" -lt 2 ]; then
        MISSING_LIST="${MISSING_LIST}  - Supabase CLI v2.84 or newer (currently $SB_VERSION)"$'\n'
      elif [ "$SB_MAJOR" -eq 2 ]; then
        case "$SB_MINOR" in
          ''|*[!0-9]*)
            MISSING_LIST="${MISSING_LIST}  - Supabase CLI v2.84 or newer (could not detect minor version, currently $SB_VERSION)"$'\n'
            ;;
          *)
            if [ "$SB_MINOR" -lt 84 ]; then
              MISSING_LIST="${MISSING_LIST}  - Supabase CLI v2.84 or newer (currently $SB_VERSION)"$'\n'
            fi
            ;;
        esac
      fi
      ;;
  esac
fi

if [ -z "$MISSING_LIST" ]; then
  exit 0
fi

# Build the message. No inner double-quotes — keeps JSON escaping simple
# for the bash-only fallback path.
#
# Important: this message is reached when sandbox detection above did NOT
# fire AND a tool check came back missing. There are two real causes — the
# wrong environment is selected, or the tool genuinely is not installed —
# and the hook cannot tell them apart from here. So the user-facing
# instruction asks the user to check the environment selector FIRST (the
# common cause when ElasticIT has already done the install) and only then
# escalate to support if Local is already selected.
CONTEXT=$(cat <<EOF
PREREQUISITE CHECK FAILED. STOP IMMEDIATELY before any other action.

The user computer appears to be missing required software:

${MISSING_LIST}
This can mean ONE of two things, and the hook cannot tell which from here:

  (1) Most common: the environment selector at the bottom-left of the user's Claude window is set to "Default" or "Cloud" instead of "Local". When set to a cloud environment, Claude runs on Anthropic's servers and cannot see anything actually installed on the user's PC — so installed tools look "missing." This is the most common cause when ElasticIT has already done the install.

  (2) Less common: the user is genuinely in Local but the tools were not installed by ElasticIT yet.

DO NOT proceed with onboarding. Walk the user through the diagnostic in plain, non-technical language. IMPORTANT: the environment selector is only visible at the bottom-left of a NEW session — once a session has any messages in it, the selector is hidden behind the chat. So checking it requires starting a fresh session. Use this shape (paraphrase to fit the conversation, do not paste verbatim):

  Quick check first. The dropdown that controls where Claude runs is only visible at the start of a fresh session, so we need to open one to look at it:

  1. In the left sidebar, click "+ New session" (near the top).
  2. In the new window, look at the bottom-left of the message box. You will see a small selector with either a laptop icon (Local) or a cloud icon (Default / Cloud).

  Then:

  - If it says Default or Cloud, click it and choose "Local". Pick this project folder when asked. Then tell me again what you want to build — we will pick right up.
  - If it already says Local, then ElasticIT support needs to install one piece of helper software for you. Reach out to them — they will know what to look for and will get it set up quickly. Once they confirm it is ready, open a fresh session and tell me what you want to build.

Then wait. Do NOT continue until either: the user confirms the environment is now Local and we are starting fresh in a new session, OR the user confirms ElasticIT has installed the missing tools.
EOF
)

# Prefer jq for JSON escaping — handles unicode, control chars, edge cases.
# Bash parameter-substitution fallback covers shells where jq is not on PATH.
if command -v jq >/dev/null 2>&1; then
  printf '%s' "$CONTEXT" | jq -Rsc '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: .}}'
else
  ESCAPED="$CONTEXT"
  ESCAPED="${ESCAPED//\\/\\\\}"
  ESCAPED="${ESCAPED//\"/\\\"}"
  ESCAPED="${ESCAPED//$'\n'/\\n}"
  ESCAPED="${ESCAPED//$'\t'/\\t}"
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$ESCAPED"
fi

exit 0
