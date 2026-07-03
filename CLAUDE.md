# Procurement App

A runtime app that runs inside the ElasticIT portal shell. It is a shell **port** of the
MSR-SPS purchasing workflow: **request → approval → purchasing → returns**, with per-role
views, comment attribution, conditional formatting, and a Rippling-backed "Ship to" picker.

> **This is an existing, built app being maintained/improved by a developer (Jerome).**
> Run terminal commands, read logs, and edit source directly — normal dev workflow.
> (The verbose client-onboarding playbook this file was scaffolded from is archived at
> [`docs/CLAUDE.app-template-original.md`](docs/CLAUDE.app-template-original.md) for reference.)

## Token hygiene (this repo specifically)

This file replaced a ~199 KB inherited template CLAUDE.md (~50k tokens that replayed every
turn). Keep it lean. When you need deep template/scaffolding mechanics, open the archived
reference on demand rather than inlining it here. Delegate broad code exploration to a
subagent so its output doesn't accumulate in the main thread.

## Architecture

- **Frontend:** React + TypeScript + Vite, loaded by the portal shell as a `.eitapp` bundle.
- **Database:** **schema mode**, schema **`app_procurement`**. Tables: `locations`,
  `departments`, `purchase_requests`, `line_items`, `_config`. RLS is enabled on all
  (row-ownership model; `_config` is admin-only).
- **Migrations:** `migrations/001…009_*.sql`, declared in `app.manifest.json` under
  `database.migrations`. Numbered sequentially; each maps to a phase (see manifest descriptions).
  **Never edit an applied migration — add a new numbered one.**
- **Edge functions** (`supabase/functions/`):
  - `procurement-capture-and-notify` — captures requester identity + sends workflow
    notifications (bell + HVE internal email; external email deferred).
  - `procurement-rippling-proxy` — proxies the Rippling API for the active-worker
    "Ship to" dropdown (6h cache + manual refresh). Open to any authed user.
- **App-bridge:** data access via `ProxyClient` / `.api()` (needs app-bridge ≥ 0.8.1 for the
  restored `api()` timeout). RPCs are called through the bridge, not direct SQL.
- **Notifications:** keys declared in manifest (`request_submitted`, `item_approved`, …);
  recipients resolved via `get_permission_holders` / `get_user_names` RPCs.

## Source ↔ manifest contract

`app.manifest.json` is the single source of truth for slug, permissions (7 keys), pages,
migrations, edge functions, notifications, and vault secrets. If source needs a new
permission / table / secret / function, **declare it in the manifest and re-package** — do
not wire it up out-of-band.

- **Vault secrets:** declared in the manifest so the admin fills them via the portal UI.
  **Never manually insert vault rows** — fix the manifest and re-package.
- **App version** lives in `app.manifest.json` (currently `0.7.1`). `package.json` version
  may lag; the manifest is authoritative for the shipped app.

## Commands

```bash
npm run dev        # local dev
npm run local-dev  # run inside the local test-shell (vendored shell in local-dev/)
npm run validate   # manifest/source validation
npm run build      # production build
npm run package    # -> dist/*.eitapp bundle for Admin UI upload
npm test           # unit tests
```

## Deploy

Runtime apps ship via **`npm run package` → upload the `.eitapp` in the portal Admin UI** —
no PR/git ceremony. QA upload requires shell **0.20.0+** on the target (the Cloudflare-WAF
base64 migration fix); until then `.eitapp` upload can fail with "Failed to fetch".

## Conventions & hard rules

- **SemVer** for the app: MAJOR breaking / MINOR compatible feature / PATCH compatible fix.
- **SECURITY DEFINER** functions use the wrapper-in-`public` / definer-in-`internal` pattern
  to avoid Supabase advisor lints 0028/0029.
- **Inter-function auth:** call other edge functions with the `SERVICE_ROLE_KEY` (from
  `Deno.env`) as a Bearer token. Never store a service-role JWT in a client-visible vault.
- **Never expose keys** — not even "public" anon/publishable keys — in committed code or
  deploy params.
- Do **not** re-seed auto-generated "{App} Full Access/Viewer" roles; RBAC is managed manually.

## Deeper references

- Archived template scaffolding/onboarding playbook: `docs/CLAUDE.app-template-original.md`
- App-specific patterns: `docs/PATTERNS.md` · client setup: `docs/CLIENT_SETUP.md`
- Ecosystem architecture, shell, deploys: the **elasticit-portal** docs hub.
