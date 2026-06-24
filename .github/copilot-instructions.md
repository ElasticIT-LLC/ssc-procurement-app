# Copilot Instructions — Portal App

## Coding Conventions

- This is a library, not a standalone SPA. Export a single `<App />` component.
- Use `shell-*` and `brand-*` Tailwind tokens for all colors. Never hardcode hex values or use default Tailwind palette.
- Use `currentPage` from `useShellContext()` for page navigation — do NOT use `react-router-dom`.
- Use `useProxyClient()` for external data access — do NOT create your own Supabase client.
- Use `hasPermission()` from `usePermissions()` to gate features.
- Use `showToast()` from `useToast()` for notifications.
- Keep `react`, `react-dom`, `@elasticit-llc/app-bridge` as peer dependencies — never bundle them.

## Permissions

Format: `apps/{slug}/{resource}/{action}` — declare in `app.manifest.json` (the unified source of truth — permissions, pages, database config, vault secrets all live here).
