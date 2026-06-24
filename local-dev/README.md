# Local Dev

A bundled test shell + local Supabase stack for previewing your app while you develop it.

```bash
npm run local-dev
```

Opens http://localhost:3000 with your app rendered inside a working portal shell, against a local Supabase instance. The shell is the real `@elasticit-llc/shell` package — same context (`useShellContext`, `useAuth`, permissions, theme tokens) you get in production.

## First-time setup vs. updating an existing local-dev

> **For Claude:** first decide which case you're in. If there's **no** working local-dev yet (no running Supabase stack / no `local-dev/test-shell/.env`), do the **fresh setup**. If the user **already** has a working local-dev and just pulled new changes, do the **update** path — it refreshes the environment without wiping their local data.

### Fresh setup (no local-dev yet)
```bash
npm run local-dev
```
`setup.sh` provisions the local Supabase stack, seeds test users, and starts the test shell on http://localhost:3000. Nothing else to do.

### Updating an existing local-dev (after pulling new changes)
Run these from the repo root, in order:

1. **Get the latest code:** `git pull` (or check out the branch you were given).
2. **Rebuild the app + `.eitapp`:**
   ```bash
   npm install
   npm run package      # writes dist/ and dist/<app-slug>-<version>.eitapp
   ```
3. **Refresh the test-shell's vendored shell.** The shell ships as a `.tgz` under `vendor/`, pinned in `local-dev/test-shell/package.json`; a pull may bump it. Reinstall so the test-shell picks it up:
   ```bash
   cd local-dev/test-shell
   npm install
   ```
   ⚠️ **Vite caches pre-bundled deps.** If the test-shell still shows old behavior after reinstalling, clear the cache (the #1 "updated but nothing changed" gotcha):
   ```bash
   rm -rf node_modules/.vite
   ```
4. **Start it** from the repo root:
   ```bash
   cd ../.. && npm run local-dev
   ```
   `setup.sh` detects the already-running stack and **skips** the slow Supabase re-provisioning (keeps your existing DB + seeded users), then serves http://localhost:3000. If Vite serves stale code, start directly with a forced re-optimize: `cd local-dev/test-shell && npx vite --port 3000 --force`.
5. **Load the updated app:** compile-time mode auto-loads from `dist/`; for runtime mode, re-upload `dist/<app-slug>-<version>.eitapp` via **Admin → App Management → Publish App**.

**Do NOT** set `FORCE_REINIT=1` for an update — that tears down and reseeds the local Supabase. Only use it when you deliberately want a clean DB.

> Note: behavior provided by the **portal shell itself** (layout, routing, the browser tab title, deep links) comes from the **vendored shell** (step 3), not your app's `.eitapp`. If shell behavior didn't change after an update, the test-shell is still on the old shell — repeat step 3, including the `.vite` clear.

## Branding in local-dev vs production

Local-dev uses a **generic placeholder brand** sourced from `brand.json.example`. The first time you run `npm run local-dev`, `setup.sh` copies that example to `local-dev/brand.json` (gitignored). Edit it freely — change colors, fonts, client name — to preview different visual contexts.

**In production, your app does NOT carry its own brand.** Every client portal (built from `client-*-shell` repos) injects its own brand tokens as CSS variables at runtime. Your app inherits them automatically through semantic tokens:

- `bg-card`, `bg-muted`, `bg-accent` — content surfaces (flip with light/dark)
- `text-foreground`, `text-muted-foreground` — text colors
- `bg-primary`, `text-primary-foreground` — primary actions in the client's brand color
- `bg-brand-50` … `bg-brand-900` — full brand spectrum

This is why the `validate-tokens.sh` hook blocks hardcoded hex values, raw Tailwind palette utilities (`bg-blue-600`), and inline `style={{ color: '#abc' }}`. If your app uses semantic tokens correctly, it adapts to every client's portal automatically — without per-client code or per-client builds.

So local-dev is for **UI verification** (layout, data flow, loading/error states, interactions) — not for proving brand correctness. A well-built app looks right under any brand.

## Local-dev shell version

The bundled shell is `@elasticit-llc/shell` (vendored), matching the version production client portals run. Layout, hooks, permissions, the Lucide icon registry, and runtime app loading all behave the same locally as in production.

The only manifest features still hard to exercise locally are the ones that touch real portal infrastructure rather than the shell itself:

- `credential_requirements[]` — Credential Vault is in the local Supabase, but linking flows are admin-driven via the portal UI; full exercise typically waits until upload.
- `post_deploy_hooks[]` — fired by the portal's `publish-app` edge function on `.eitapp` upload. Locally the hooks file exists but isn't auto-invoked.
- `edge_functions[]` — per-app edge function deploy goes through the portal's Management API path on upload, not in local-dev.

Everything else — page rendering, sidebar icons, RBAC gating, proxy mode, schema mode, vault secret reads — behaves identically to production. If a behavior differs between local-dev and production after upload, that's a bug worth flagging.

## Files

- `brand.json.example` — placeholder brand. Copy to `brand.json` to customize (gitignored).
- `setup.sh` — boots the local Supabase stack + dev server. Auto-copies brand.json from example on first run.
- `seed.sql` — seed users/permissions for the local Supabase project.
- `supabase/` — local Supabase config + edge function stubs.
- `test-shell/` — the Vite app that hosts the test shell. Compiles `brand.json` via `brandCompiler` so the chrome (sidebar/topbar/login) reflects your placeholder brand.

## Keeping local-dev current (IMPORTANT for apps scaffolded earlier)

> **The test-shell files under `local-dev/test-shell/` are a one-time copy taken when your app was scaffolded.** Later fixes to this template do **not** flow back into apps that were already scaffolded. If your local-dev looks wrong but production looks fine, your scaffold predates one of the fixes below — apply them by hand to your `local-dev/test-shell/` files.

These are the current baseline fixes. Each makes the local-dev test-shell render the way production does. If any is missing in your app, copy it in:

1. **`src/App.tsx` — WelcomePage uses semantic tokens, not `shell-*`.**
   The placeholder WelcomePage must use `text-foreground`, `text-muted-foreground`, `bg-card`, `border-border`, `text-primary`. The older copy used `text-shell-100` / `bg-shell-800` / etc., which map to fixed neutral shades that do **not** flip for light mode — so text goes near-invisible on a white background. (This is the same rule your app code follows: never use `shell-*` tokens in content.)

2. **`public/logo-wordmark.svg` — explicit light `fill`, not `currentColor`.**
   The shell renders the wordmark via `<img src=...>`. An SVG loaded through `<img>` is an isolated document, so `currentColor` resolves to black, not the page color. The sidebar chrome is always dark, so the placeholder wordmark must use an explicit light fill (e.g. `fill="#e4e7ea"`) or it renders black-on-dark and disappears.

3. **`src/main.tsx` — imports the built app's CSS (`import '@local-app/index.css'`).**
   The test-shell's Tailwind `@source` scan only regenerates Tailwind **utility** classes from your built app's JS. It does **not** load **custom CSS classes** you define in `src/app.css` (for example, a grid layout that can't be expressed as a Tailwind utility because the v4 scanner can't parse arbitrary grid values). Without this import, those custom-class layouts fall back to block layout and look broken in local-dev even though they render correctly in production, where the portal injects your app's compiled CSS. `@local-app` aliases to `../../dist`.

Newly scaffolded apps already include all three. This list exists so an older app can be brought up to date without guessing.
