# Set Pattern — Configure Data Access Pattern

Interactively configure the app's data access pattern. This replaces the `--pattern` CLI flag with a conversational approach.

## Step 1: Check Current State

Read `app.manifest.json` and check if a `database` section already exists.

- If `database` exists: tell the user what pattern is currently configured and ask if they want to change it
- If no `database` section: proceed to step 2

## Step 2: Understand Requirements

Ask the user: **"What does your app need to do with data? Describe it in plain language."**

Examples of what they might say:
- "It pulls employee data from Rippling every week" → schema-sync
- "It needs to store scheduling data in the client's database" → schema-tables
- "It calls an external API with an API key to get print job data" → proxy-bearer
- "It authenticates with OAuth2 to access a vendor API" → proxy-oauth
- "It only shows data from the shell (user profiles, audit log)" → simple

## Step 3: Decision Tree

Based on their answer, determine the pattern:

1. **Does the app pull data from an external API on a schedule?** → `schema-sync`
2. **Does the app need its own tables in the client's Supabase, without sync?** → `schema-tables`
3. **Does the app call an external API live with OAuth2 Client Credentials?** → `proxy-oauth`
4. **Does the app call an external API live with a Bearer token or API key?** → `proxy-bearer`
5. **None of the above?** → `simple` (no changes needed)

Confirm the choice with the user before proceeding.

**Key guidance for ambiguous cases:**
- "Live" vs "scheduled": if the UI needs instantly consistent data, use proxy. If minutes of staleness is fine and the API is slow/rate-limited, use schema-sync.
- OAuth2 **Authorization Code** (browser redirect) is NOT a pattern — start with proxy-bearer and change `credential_type` to `oauth2_auth_code` in the manifest.
- If unsure, pick the simpler pattern — it's easier to add infrastructure than remove it.

## Step 4: Apply Pattern

Read the app's `slug` from `app.manifest.json`.

### For `simple`:
No changes needed. Tell the user their app is already configured.

### For `proxy-bearer`:
Update `app.manifest.json` — add:
```json
{
  "database": {
    "mode": "proxy",
    "proxy": {
      "vault_prefix": "{slug}",
      "allowed_api_endpoints": ["*"],
      "api_config": {
        "type": "bearer_token"
      }
    }
  },
  "credential_requirements": [
    {
      "provider": "YOUR_PROVIDER_NAME",
      "credential_type": "bearer",
      "label": "{App Name} API Key",
      "description": "API key for accessing the vendor API"
    }
  ]
}
```

Ask the user for the provider name and update `YOUR_PROVIDER_NAME`.

### For `proxy-oauth`:
Update `app.manifest.json` — add:
```json
{
  "database": {
    "mode": "proxy",
    "proxy": {
      "vault_prefix": "{slug}",
      "allowed_api_endpoints": ["*"],
      "api_config": {
        "type": "oauth2"
      }
    }
  },
  "vault_secrets": [
    { "key": "{slug}_client_id", "source": "admin-input", "description": "OAuth2 client ID" },
    { "key": "{slug}_client_secret", "source": "admin-input", "description": "OAuth2 client secret" },
    { "key": "{slug}_token_url", "source": "admin-input", "description": "OAuth2 token endpoint URL" }
  ]
}
```

### For `schema-tables`:
1. Update `app.manifest.json` — add:
```json
{
  "database": {
    "mode": "schema",
    "schema": "app_{slug_underscored}",
    "migrations": [
      { "version": 1, "description": "Initial schema", "up": "migrations/v1_initial.sql" }
    ],
    "tables": [
      { "name": "items", "rls": { "read": "authenticated", "write": "authenticated" } }
    ]
  }
}
```

2. Create `migrations/v1_initial.sql`:
```sql
-- Initial schema for {app_name}
-- This migration runs automatically when the .eitapp is uploaded via Admin UI.

CREATE TABLE IF NOT EXISTS app_{slug_underscored}.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_items_name ON app_{slug_underscored}.items(name);
```

Ask the user what tables they actually need and customize the migration.

### For `schema-sync`:
This is the most complex pattern. Generate all three files:

1. Update `app.manifest.json` — add database, vault_secrets, edge_functions, config, credential_requirements, post_deploy_hooks sections.

2. Create `migrations/v1_initial.sql` — entities table, sync_log table, _config table.

3. Create `migrations/v2_schedule_sync.sql` — pg_cron job, trigger function using pg_net to call edge function. Schedule: Mondays 14:00 UTC (ask user for preferred schedule).

4. Create `migrations/v3_auto_retry_sync.sql` — retry function, max 3 failures in 2-hour window, hourly at :15.

5. Create `supabase/functions/{slug}-sync/index.ts` — edge function with:
   - AES-256-GCM credential decryption
   - Fetch with retry (3 attempts, exponential backoff)
   - Cursor-based pagination
   - Batched upserts (100 rows)
   - Sync log tracking
   - `EdgeRuntime.waitUntil()` for background execution

**Important for schema-sync:** Mark all TODO spots where the developer needs to fill in:
- Entity table columns (what data to store)
- API endpoint URL
- Response mapping function (vendor JSON → entity row)
- Pagination strategy (cursor, offset, next_link)
- Sync schedule (default: weekly Mondays 14:00 UTC)

## Step 5: Verify

After applying the pattern:
1. Run `npm run build` to verify the project still builds
2. Print a summary of what was created/modified
3. List next steps the developer needs to take (fill in TODOs, configure credentials, etc.)
