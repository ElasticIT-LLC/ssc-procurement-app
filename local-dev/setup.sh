#!/usr/bin/env bash
set -euo pipefail

# Local development setup for ElasticIT Portal apps
# Run: cd local-dev && bash setup.sh

cd "$(dirname "$0")"

echo "=== ElasticIT Portal — Local Dev Setup ==="
echo ""

# Check prerequisites
command -v supabase >/dev/null 2>&1 || { echo "ERROR: Supabase CLI not found. Install: scoop install supabase (Windows) or brew install supabase/tap/supabase (Mac)"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found. Install Node.js 22+."; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl not found."; exit 1; }

# Container runtime: Docker is the default. Podman is supported as a fallback
# for clients who already have it installed (often pre-existing on RHEL-based
# distros or via `podman-desktop` on Windows). When DOCKER_HOST is unset and
# only Podman is installed on Windows, point DOCKER_HOST at the Podman pipe so
# the supabase CLI can still talk to a runtime.
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  if [ -z "${DOCKER_HOST:-}" ] && ! command -v docker >/dev/null 2>&1 && command -v podman >/dev/null 2>&1; then
    export DOCKER_HOST="npipe:////./pipe/podman-machine-default"
    echo "Docker not found — falling back to Podman. Set DOCKER_HOST=$DOCKER_HOST"
  fi
fi

# Detect already-initialized state. If a previous run finished cleanly AND the
# Supabase stack is still up, skip migration copy / test user creation / seed
# (the slow steps). Just refresh credentials and start the dev server. Saves
# ~30-60s per re-run and avoids tearing down a working environment.
#
# Force a full re-init by setting FORCE_REINIT=1.
ALREADY_INITIALIZED=false
if [ "${FORCE_REINIT:-0}" != "1" ] && [ -f .setup-complete ] && [ -f test-shell/.env ]; then
  if (cd supabase && supabase status >/dev/null 2>&1); then
    ALREADY_INITIALIZED=true
    echo "[reuse] Local stack already initialized and running — skipping slow init steps."
    echo "        To force a full re-init: FORCE_REINIT=1 bash setup.sh"
    echo ""
  fi
fi

# Ensure brand.json exists for brandCompiler to consume. Copy from
# brand.json.example on first run; user can edit afterwards. brand.json is
# gitignored so changes stay local.
if [ ! -f brand.json ]; then
  if [ -f brand.json.example ]; then
    cp brand.json.example brand.json
    echo "[init] Created local-dev/brand.json from brand.json.example"
    echo "       Edit colors / fonts / clientName in brand.json to preview different brands."
  else
    echo "ERROR: brand.json.example missing. Reinstall template or report a bug."
    exit 1
  fi
fi

# 1. Copy shell migrations from installed package — skipped on warm re-runs
SHELL_SUPABASE=""
for candidate in "../node_modules/@elasticit-llc/shell/supabase" "test-shell/node_modules/@elasticit-llc/shell/supabase"; do
  if [ -d "$candidate/migrations" ]; then
    SHELL_SUPABASE="$candidate"
    break
  fi
done

if [ "$ALREADY_INITIALIZED" = true ]; then
  echo "[1/7] Skipping migration copy (already applied to running stack)."
elif [ -n "$SHELL_SUPABASE" ]; then
  echo "[1/7] Copying shell migrations..."
  rm -rf supabase/migrations
  cp -r "$SHELL_SUPABASE/migrations" supabase/migrations

  # Fix migrations for local dev: comment out auth table RLS (local user doesn't own auth tables)
  for f in supabase/migrations/*.sql; do
    sed -i 's/^ALTER TABLE IF EXISTS auth\./-- LOCAL DEV: &/' "$f" 2>/dev/null || true
  done

  # Fix vault function: replace with conditional stub
  for f in supabase/migrations/*.sql; do
    if grep -q "vault.decrypted_secrets" "$f" 2>/dev/null; then
      sed -i '/CREATE OR REPLACE FUNCTION.*get_vault_secret/,/LANGUAGE sql/{
        s/^/-- LOCAL DEV REPLACED: /
      }' "$f" 2>/dev/null || true
      # Append stub at end of file
      cat >> "$f" <<'STUB'

-- LOCAL DEV: vault stub (vault extension not available locally)
CREATE OR REPLACE FUNCTION public.get_vault_secret(secret_name TEXT)
RETURNS TEXT AS $$ SELECT NULL::TEXT; $$ LANGUAGE sql SECURITY DEFINER STABLE;
STUB
    fi
  done

  if [ -d "$SHELL_SUPABASE/functions" ]; then
    echo "       Copying edge functions..."
    rm -rf supabase/functions
    cp -r "$SHELL_SUPABASE/functions" supabase/functions
  fi

  # Generate a dev-only AES-256-GCM key for the Credential Vault if missing.
  # Without this, credential-vault / app-proxy / api-proxy / graph-groups crash
  # on every encrypt/decrypt call with "Internal Server Error" — Test Connection
  # in particular fails because the function tries to .match() on undefined.
  # Production portals get a real key set via the Supabase Dashboard.
  if [ ! -f supabase/functions/.env ]; then
    if command -v openssl >/dev/null 2>&1; then
      DEV_VAULT_KEY=$(openssl rand -hex 32)
    else
      # Fallback: 64 hex chars from /dev/urandom
      DEV_VAULT_KEY=$(head -c 32 /dev/urandom 2>/dev/null | od -An -vtx1 | tr -d ' \n' | head -c 64)
    fi
    cat > supabase/functions/.env <<EOF
# Local-dev edge function secrets — auto-generated by setup.sh.
# WARNING: dev-only key. Do NOT commit. Production portals set this via
# Supabase Dashboard > Project Settings > Edge Functions > Secrets.
CREDENTIAL_ENCRYPTION_KEY=$DEV_VAULT_KEY
EOF
    echo "       Generated supabase/functions/.env (CREDENTIAL_ENCRYPTION_KEY)"
  fi
else
  echo "[1/7] WARNING: Shell migrations not found."
  echo "  Run 'cd test-shell && npm install' first, then re-run this script."
  exit 1
fi

# 2. Create required directories
echo "[2/7] Preparing Supabase directories..."
mkdir -p supabase/snippets

# 3a. Copy app's own edge functions (if any) into local-dev so supabase serves them.
# Apps that declare edge_functions[] in app.manifest.json have their TS sources
# under <repo>/supabase/functions/<name>/. In production these are deployed via
# publish-app's Management API call; locally there's no Management API, so we
# bind-mount them into the local supabase functions folder. Without this, any
# `supabase.functions.invoke('<name>')` call from the app returns 404 / non-2xx.
# Skipped on warm re-runs because the supabase stack isn't restarted — config.toml
# changes wouldn't take effect anyway. Use FORCE_REINIT=1 to pick up new functions.
if [ "$ALREADY_INITIALIZED" != true ]; then
  APP_FN_DIR="../supabase/functions"
  if [ -d "$APP_FN_DIR" ]; then
    for fn in "$APP_FN_DIR"/*/; do
      [ -d "$fn" ] || continue
      fn_name=$(basename "$fn")
      if [ ! -d "supabase/functions/$fn_name" ]; then
        echo "       Copying app edge function: $fn_name"
        cp -r "$fn" "supabase/functions/$fn_name"
        # Register in config.toml with verify_jwt=false (matches production
        # --no-verify-jwt deploy; the function does its own auth via
        # supabase.auth.getUser(token)).
        if ! grep -q "\[functions\.$fn_name\]" supabase/config.toml 2>/dev/null; then
          cat >> supabase/config.toml <<EOF

[functions.$fn_name]
verify_jwt = false
EOF
        fi
      fi
    done
  fi
fi

# 3. Start Supabase local stack — supabase start is idempotent and reuses
#    existing containers when the stack is already up
if [ "$ALREADY_INITIALIZED" = true ]; then
  echo "[3/7] Supabase stack already up — reusing."
else
  echo "[3/7] Starting Supabase local stack..."
  cd supabase
  supabase start
  cd ..
fi

# Pre-install extensions that schema-mode app migrations commonly need.
# Without these, any app migration with `CREATE EXTENSION pg_cron|pg_net`
# fails with "permission denied to create extension" because exec_sql runs
# as postgres which is NOT a superuser on local Supabase. Skipped on warm
# re-runs (extensions persist across `supabase start`).
if [ "$ALREADY_INITIALIZED" != true ]; then
  echo "       Pre-installing pg_cron + pg_net (idempotent)..."
  DB_CONTAINER_INIT="supabase_db_local-dev"
  EXT_SQL="CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;"
  if command -v docker >/dev/null 2>&1; then
    docker exec -i "$DB_CONTAINER_INIT" psql -U postgres -c "$EXT_SQL" >/dev/null 2>&1 || true
  elif command -v podman >/dev/null 2>&1; then
    podman exec -i "$DB_CONTAINER_INIT" psql -U postgres -c "$EXT_SQL" >/dev/null 2>&1 || true
  fi
fi

# 4. Capture generated keys (JWT format)
echo "[4/7] Capturing Supabase credentials..."
SUPABASE_URL=$(cd supabase && supabase status -o env 2>/dev/null | grep "^API_URL=" | cut -d'"' -f2)
ANON_KEY=$(cd supabase && supabase status -o env 2>/dev/null | grep "^ANON_KEY=" | cut -d'"' -f2)
SERVICE_ROLE_KEY=$(cd supabase && supabase status -o env 2>/dev/null | grep "^SERVICE_ROLE_KEY=" | cut -d'"' -f2)

if [ -z "$ANON_KEY" ]; then
  echo "ERROR: Could not read Supabase credentials."
  echo "Try: cd supabase && supabase status -o env"
  exit 1
fi

# Write .env for test shell
cat > test-shell/.env <<EOF
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$ANON_KEY
EOF

echo "  URL: $SUPABASE_URL"
echo "  Anon key: ${ANON_KEY:0:20}..."

# 5. Create test users via GoTrue admin API — skipped on warm re-runs
if [ "$ALREADY_INITIALIZED" = true ]; then
  echo "[5/7] Skipping test user creation (already provisioned)."
else
  echo "[5/7] Creating test users..."
  for entry in "admin:admin123" "user:user123" "viewer:viewer123"; do
    email="${entry%%:*}@localhost"
    password="${entry##*:}"
    curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
      -H "apikey: $SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$email\",\"password\":\"$password\",\"email_confirm\":true}" \
      > /dev/null 2>&1 || true
    echo "  Created: $email ($password)"
  done
fi

# 6. Apply seed data — skipped on warm re-runs
if [ "$ALREADY_INITIALIZED" = true ]; then
  echo "[6/7] Skipping seed (already applied)."
else
  echo "[6/7] Seeding database..."
  DB_CONTAINER="supabase_db_local-dev"
  SEED_APPLIED=false

  # Try docker first (default runtime).
  if [ "$SEED_APPLIED" = false ] && command -v docker >/dev/null 2>&1; then
    if docker exec -i "$DB_CONTAINER" psql -U postgres < seed.sql 2>&1 | grep -v "^$"; then
      SEED_APPLIED=true
    fi
  fi

  # Fall back to podman (respects DOCKER_HOST set earlier for Windows).
  if [ "$SEED_APPLIED" = false ] && command -v podman >/dev/null 2>&1; then
    if podman exec -i "$DB_CONTAINER" psql -U postgres < seed.sql 2>&1 | grep -v "^$"; then
      SEED_APPLIED=true
    fi
  fi

  if [ "$SEED_APPLIED" = false ]; then
    echo "  WARNING: Could not find container $DB_CONTAINER. Seed data not applied."
    echo "  Run manually: docker exec -i $DB_CONTAINER psql -U postgres < seed.sql"
  fi

  # 6b. Populate app_notifications from the parent app.manifest.json.
  # In production, publish-app does this on .eitapp upload; locally we
  # generate the SQL inline from the manifest and apply it. Lets the dev
  # see their own app's events on the bundled portal's Notifications page.
  if [ "$SEED_APPLIED" = true ]; then
    NOTIF_SQL=$(node seed-app-notifications.mjs 2>/dev/null || true)
    if [ -n "$NOTIF_SQL" ]; then
      if command -v docker >/dev/null 2>&1 && \
         echo "$NOTIF_SQL" | docker exec -i "$DB_CONTAINER" psql -U postgres >/dev/null 2>&1; then
        echo "[6b/7] Seeded app_notifications from manifest."
      elif command -v podman >/dev/null 2>&1 && \
           echo "$NOTIF_SQL" | podman exec -i "$DB_CONTAINER" psql -U postgres >/dev/null 2>&1; then
        echo "[6b/7] Seeded app_notifications from manifest."
      else
        echo "[6b/7] WARNING: failed to seed app_notifications. Run manually:"
        echo "        node seed-app-notifications.mjs | docker exec -i $DB_CONTAINER psql -U postgres"
      fi
    fi
  fi
fi

# 7. Install test shell deps and start. npm install is fast on re-runs once
# the lockfile + node_modules are present, so it's safe to call unconditionally.
echo "[7/7] Starting test shell..."
cd test-shell
npm install --silent 2>/dev/null || npm install
cd ..

# Mark this setup as complete so the next run can take the fast path. The
# marker file is gitignored. Removing it (or running with FORCE_REINIT=1)
# triggers a full re-init.
touch .setup-complete

cd test-shell
echo ""
echo "=== Local dev environment ready ==="
echo ""
echo "  Portal:          http://localhost:3000"
echo "  Supabase Studio: http://localhost:54323"
echo ""
echo "  Login credentials:"
echo "    admin@localhost  / admin123  (admin — full portal + admin pages)"
echo "    user@localhost   / user123   (user — app with full access)"
echo "    viewer@localhost / viewer123 (viewer — app with view-only access)"
echo ""
echo "  In another terminal, run: cd $(cd .. && pwd) && npm run dev"
echo "  (This starts vite build --watch for your app)"
echo ""
npx vite --port 3000
