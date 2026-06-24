# ElasticIT App Template

> ⚠️ **Use Claude Code with the "Local" environment selected** (look at the bottom-left of the Claude window — flip the environment selector from "Default"/"Cloud" to "Local"). The cloud environments are Anthropic-hosted sandboxes that can't reach your computer, so the local test environment, scaffolding, and packaging steps fail there. The session-start prerequisite hook detects the cloud case and walks you through the one-click fix; if you see that message, just flip the selector and continue.

> **Client-facing template.** This is the starting point for clients building their own portal apps. Clone it, develop your app, and deploy via Admin UI `.eitapp` upload. ElasticIT maintains a separate internal toolchain (`create-elasticit-app`) for platform-level tasks and multi-client deploys — not included here.

Template for building apps that run inside the ElasticIT portal shell. Clone it, develop your app (with or without Claude as a guide), and deploy by uploading the built `.eitapp` bundle via **Admin → App Management → Publish App** in your client portal.

> **For full documentation, see [`CLAUDE.md`](./CLAUDE.md).** That file is the complete development reference — First-Turn Protocol, manifest schema, hooks API, proxy/schema modes, deployment, and troubleshooting.

## Quick Start

### 1. Scaffold a fresh app folder

From inside the cloned template:

```bash
bash scripts/scaffold.sh my-app
```

This creates `../my-app/` (validates the slug, copies template files, `git init`, `npm install`, initial commit). Then `cd ../my-app` and continue.

<details>
<summary>Manual alternative (if you want to work inside the template clone directly)</summary>

```bash
git clone https://github.com/ElasticIT-LLC/elasticit-app-template.git my-app
cd my-app
rm -rf .git
git init && git add . && git commit -m "initial commit from elasticit-app-template"
```

</details>

### 2. Push to your own GitHub repo

Create an empty repo in your org (e.g., `your-org/my-app`), then:

```bash
git branch -M main
git remote add origin git@github.com:your-org/my-app.git
git push -u origin main
```

Don't push changes back to the template repo — it's shared across all clients.

### 3. Configure your app identity

- `package.json` — change `name` to your app's slug (or `@your-org/<slug>`)
- `app.manifest.json` — change `slug`, `name`, `icon`, permissions, pages (this is the unified source of truth)

The validator flags template defaults (`my-app`, `My App`, `📦`) as warnings during development and blocks packaging in strict mode — you can't accidentally ship an unconfigured app.

### 4. Install and build

```bash
npm install
npm run build
```

> No authentication required. `@elasticit-llc/app-bridge` is pre-bundled in `vendor/` (see `vendor/README.md` for version info). Everything needed ships with the template.

### 5. Develop your app

- `src/App.tsx` — main component with a `currentPage` switch
- `src/pages/` — page components
- `src/index.ts` — dual export: `App` + `setup()` registering pages for runtime loading
- `app.manifest.json` — permissions, pages, database config
- Use `CLAUDE.md` as the development guide

### 6. Verify in local-dev (do this before packaging)

```bash
npm run local-dev    # boots a real shell + local Supabase at http://localhost:3000
```

The first run copies `local-dev/brand.json.example` to `local-dev/brand.json` (gitignored) and sets up the local Supabase stack. Click through every page of your app, exercise auth/permissions, and confirm everything renders.

Local-dev uses a **placeholder brand** — your app does not carry its own branding. In production, every client portal injects its own brand tokens at runtime (teal, blue, red, purple, etc.) and your app inherits them automatically through the semantic tokens (`bg-card`, `text-foreground`, `bg-primary`, `bg-brand-500`). So local-dev's job is to verify *layout, data flow, and behavior* — not brand correctness. A well-built app adapts to every client without any per-client code. See `local-dev/README.md` for the full explanation.

`npm run package` will print a soft warning + 3-second pause if `local-dev` was never run on this machine — a nudge to ship verified.

### 7. Package + deploy

```bash
npm run package      # produces dist/<slug>-<version>.eitapp
```

Upload the `.eitapp` file via **Admin → App Management → Publish App** in your client portal. The portal's `publish-app` edge function handles storage, registration, schema creation, and permission sync. No shell rebuild required — the app appears on next page load.

## Commands

```bash
npm install          # Install deps (also activates husky pre-commit hook)
npm run dev          # Watch mode — rebuilds on file changes
npm run validate     # Run the manifest ↔ source validator
npm run build        # Validate + produce dist/index.js + dist/index.css
npm run package      # Build + produce dist/<slug>-<version>.eitapp
npm run local-dev    # Start local test shell + Supabase stack (see CLAUDE.md)
npm run test         # Run tests
```

## How It Works

This is a **React component library**, not a standalone SPA. It exports a component plus a `setup()` function that the ElasticIT portal shell calls after fetching the bundle at runtime.

- `src/App.tsx` — entry component, reads `currentPage` from `useShellContext()`
- `src/index.ts` — dual export: `App` + `setup(api)` (registers pages via lazy imports)
- `app.manifest.json` — permissions, sidebar pages, database config (schema or proxy mode)
- `types/app-bridge.d.ts` — TypeScript types for shell integration hooks
- `scripts/scaffold.sh` — cross-platform scaffold script
- `scripts/validate.ts` — manifest ↔ source validator (runs on edits, commits, builds, package)
- `scripts/package.ts` — bundles `dist/` + manifest + migrations into a `.eitapp` ZIP

### Data Access Modes

| Your app needs... | Pattern |
|---|---|
| **Third-party vendor API** (Rippling, BambooHR, etc.) | Credential Vault + Proxy — API keys stored in vault, requests routed through `app-proxy` |
| **Its own database** (separate Supabase project) | Proxy mode — connection details stored in vault, accessed via `useProxyClient()` |
| **Tables in client's Supabase** | Schema mode — app creates `app_*` schema, migrations run on upload |
| **Only shell data** | None — use `useSupabase()` from app-bridge |

See [CLAUDE.md — Choosing Your Data Access Pattern](./CLAUDE.md#choosing-your-data-access-pattern) for full walkthroughs.

## Guardrails

Four independent enforcement layers prevent broken apps from being published, all sharing one validator (`scripts/validate.ts`):

- **Claude Code PostToolUse hook** — validator runs after every Edit/Write to critical files; errors surface so Claude self-corrects mid-session
- **Husky pre-commit** — validator blocks `git commit` on broken state
- **Prebuild + Vite plugin** — validator runs at build start; `npm run build` AND direct `npx vite build` both blocked on errors
- **Packager strict mode** — `scripts/package.ts` runs validator with `--strict`, which promotes template-default warnings to errors so unconfigured scaffolds can't produce a shippable `.eitapp`

## Local Development

```bash
npm run local-dev
```

Spins up a local Supabase stack + test shell on [http://localhost:3000](http://localhost:3000). See [CLAUDE.md — Local Development](./CLAUDE.md#local-development) for prerequisites and troubleshooting.

## Support

For help — vault secret provisioning, schema exposure, or any issue during development — see [CLAUDE.md — Requesting ElasticIT Support](./CLAUDE.md#requesting-elasticit-support).
