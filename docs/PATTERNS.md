# App Development Patterns

Battle-tested patterns from production apps. This file does **not** replace `CLAUDE.md` — that's still the source of truth for scaffolding, schema-mode setup, RLS, edge function basics, and Tailwind v4 rules. PATTERNS.md captures patterns those sections don't cover yet.

When in doubt: `CLAUDE.md` first, then come here for the specific gotchas below.

---

## 1. PostgREST 1000-row cap

PostgREST applies a hard 1000-row default to every query. If your dashboard expects 5000 rows you silently get 1000 — no error, no warning. Pagination is your responsibility.

**Pattern — paginate with `.range()`:**

```ts
const PAGE = 1000
const all: MyRow[] = []
for (let offset = 0; ; offset += PAGE) {
  const { data, error } = await supabase
    .from('my_table')
    .select('*')
    .order('id')                            // stable order is required for offset paging
    .range(offset, offset + PAGE - 1)
  if (error) throw error
  if (!data?.length) break
  all.push(...data)
  if (data.length < PAGE) break
}
```

Extract into a helper the second time you need it; the inline form usually wins until then.

**Alternative — aggregate inside an RPC.** Max-rows applies to `/rpc/` results too, so this isn't a bypass. It works because the function collapses thousands of rows server-side (sum / count / one-row-per-group) into a small result set, which fits comfortably under the cap. One trip, no loop.

## 2. SECURITY DEFINER advisor lints

Two unrelated Supabase database-linter rules apply to functions you write in migrations. They have different mitigations — don't confuse them.

### `function_search_path_mutable`

Any function (DEFINER or not) without an explicit `search_path` is flagged. Without one, the caller's `search_path` is used inside the function body, so an attacker can prepend their own schema and make your unqualified references (`SELECT * FROM users`) resolve to their tables.

Fix — add `SET search_path = ...` to every function:

```sql
CREATE OR REPLACE FUNCTION my_function()
RETURNS TABLE (...)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ ... $$;
```

If your function reads from your own `app_*` schema and `public`, set both: `SET search_path = app_<slug>, public`.

### `0028_anon_security_definer_function_executable` + `0029_authenticated_*`

These flag any `SECURITY DEFINER` function in the `public` schema that's executable by `anon` or `authenticated`. **`SET search_path` does NOT silence these** — the lints are about *who can call the function*, not its search path.

Fix — put the privileged body in an `internal` schema (not exposed to PostgREST), then create a thin `SECURITY INVOKER` wrapper in `public` that delegates. The shell uses this pattern in `migrations/023_security_definer_lockdown.sql`.

Skeleton:

```sql
-- Privileged body in `internal`. Not reachable via PostgREST.
CREATE FUNCTION internal.do_admin_thing(arg text)
  RETURNS some_type
  LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ ... $$;
GRANT EXECUTE ON FUNCTION internal.do_admin_thing(text) TO authenticated, service_role;

-- Public wrapper. The only thing PostgREST sees.
CREATE FUNCTION public.do_admin_thing(arg text)
  RETURNS some_type
  LANGUAGE sql
  SECURITY INVOKER SET search_path = pg_catalog, public, internal
AS $$ SELECT internal.do_admin_thing(arg) $$;
GRANT EXECUTE ON FUNCTION public.do_admin_thing(text) TO authenticated, service_role;
```

Functions only called by triggers or `service_role` (never reached via PostgREST `.rpc()`) skip the wrapper — just `REVOKE EXECUTE FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`.

## 3. Bundle entire edge-function directories (when you add them)

This template doesn't ship edge-function packaging by default. `scripts/package.ts` bundles `migrations/` and the built app, but not `supabase/functions/`. When your app needs an edge function, you'll add a `supabase/functions/<name>/` directory and extend the packager to include it.

**Gotcha to plan for up front:** bundle every file in each function's directory, not just `index.ts`. A typical naive implementation only ships `index.ts`, and the function deploys looking healthy but fails at first invocation with `Module not found` when it imports a sibling (`./helpers.ts`, `./types.ts`).

Use `readdirSync(funcDir, { recursive: true })` (Node 20+) or a recursive walk, and mirror the per-function directory path inside the archive so `publish-app` preserves structure on upload.

Symptom: `.eitapp` upload succeeds, function appears in the dashboard, first invocation returns 500 with `Cannot find module './...'`. The fix is on the packaging side, not the function code.

## 4. Permission-scope hook recipe

If your app has role-gated views (e.g. department managers see only their team), encode the scope rules as custom permission keys + a hook:

```ts
// src/hooks/usePermissionScope.ts
import { useMemo } from 'react'
import { usePermissions } from '@elasticit-llc/app-bridge'

const APP_SLUG = 'my-app'  // ← keep in sync with app.manifest.json

type Scope = {
  isAdmin: boolean
  allowedDepartments: string[] | null  // null = unrestricted
}

const SCOPE_DEFINITIONS: Record<string, { allowedDepartments?: string[] }> = {
  [`apps/${APP_SLUG}/scope/dept-engineering`]: { allowedDepartments: ['engineering'] },
  [`apps/${APP_SLUG}/scope/dept-sales`]: { allowedDepartments: ['sales'] },
}

export function usePermissionScope(): Scope {
  const { hasPermission, appPermissions } = usePermissions()

  return useMemo(() => {
    if (hasPermission(`apps/${APP_SLUG}/*`)) {
      return { isAdmin: true, allowedDepartments: null }
    }
    let allowedDepartments: string[] | null = null
    for (const perm of appPermissions) {
      const scope = SCOPE_DEFINITIONS[perm]
      if (scope?.allowedDepartments) {
        allowedDepartments = [...(allowedDepartments ?? []), ...scope.allowedDepartments]
      }
    }
    return { isAdmin: false, allowedDepartments }
  }, [hasPermission, appPermissions])
}
```

Declare the keys (`apps/my-app/scope/dept-*`) under `permissions` in `app.manifest.json` so admins can grant them via Role Management. Pages call `usePermissionScope()` and filter their queries by `allowedDepartments` when it's non-null.

## 5. CSV export recipe

No dependencies, ~30 lines. Drop into `src/lib/csv-export.ts` if your app has Export buttons:

```ts
type Col<T> = { key: keyof T; label: string }

function escape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function generateCsv<T>(rows: T[], cols: Col<T>[]): string {
  const header = cols.map(c => c.label).join(',')
  const body = rows.map(r => cols.map(c => escape(r[c.key])).join(',')).join('\n')
  return `${header}\n${body}`
}

export function downloadCsv<T>(rows: T[], cols: Col<T>[], filename: string): void {
  // UTF-8 BOM so Excel decodes non-ASCII correctly instead of mojibaking it.
  const blob = new Blob(['\uFEFF', generateCsv(rows, cols)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
```

For multi-section reports (metadata + KPIs + grouped rollups), build the CSV string yourself by joining lines.

## 6. "Last sync" indicator — `LATEST_SYNC_WINDOW_MS`

If your app shows a "last synced N events ago" indicator and subscribes to sync events as they stream in, naive `min/max` on a timestamp column will sweep in events from the *current* sync run — making every page-render look like a fresh sync.

Define a tight window for what counts as "the latest sync":

```ts
const LATEST_SYNC_WINDOW_MS = 1000  // events within 1s of max belong to the same sync

if (!events.length) return []   // Math.max([]) is -Infinity — guard first
const maxTs = Math.max(...events.map(e => +new Date(e.occurred_at)))
const latest = events.filter(
  e => maxTs - +new Date(e.occurred_at) < LATEST_SYNC_WINDOW_MS,
)
```

The right window depends on how your sync writes:

- **Streamed incrementally** (each event committed as it happens) → 1 second is safe. The "latest sync" is the cluster of events written within ~1s of one another.
- **Batched at end of run** (all events flushed in one transaction at the end) → use a wider window (2 hours is the conservative ceiling) to absorb the spread of write timestamps across a long batch insert. Wide windows are a workaround for legacy sync code — streaming is strictly better.

When in doubt, refactor the sync to stream incrementally and keep the window at 1s.

## 7. Stale-DOM rows in large grouped tables

React's reconciler can leave stale `<tr>` rows visible when a filtered + grouped table re-renders with a different filter. Symptom: rows from the previous filter appear interleaved with the new filter's rows.

Fix — render one host `<tbody>` per group, keyed on `${filterState}|${groupId}`, capped at ~200 visible rows:

```tsx
{groups.map(g => (
  <tbody key={`${filterState}|${g.id}`}>
    {g.rows.slice(0, 200).map(r => <tr key={r.id}>...</tr>)}
  </tbody>
))}
```

The composite key forces React to remount the entire `<tbody>` whenever the filter changes, eliminating the stale-DOM behavior at the cost of a brief re-render.

The 200-row cap keeps it cheap. If your tables are larger, virtualize them rather than raising the cap.

## 8. Service-role grants in app_* schemas

If your edge function (running as `service_role`) gets `permission denied for schema app_<slug>` when writing to its own tables, the schema-creation flow didn't grant access to `service_role`. Add a one-time migration:

```sql
GRANT USAGE ON SCHEMA app_<slug> TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA app_<slug> TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA app_<slug> TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_<slug> GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_<slug> GRANT ALL ON SEQUENCES TO service_role;
```

The `ALTER DEFAULT PRIVILEGES` lines cover tables/sequences created in *future* migrations; the `GRANT ALL ON ALL TABLES` lines cover the ones that already exist. Place this migration immediately after your initial table-creation migration so everything stays covered.

This is a known platform gap — your migration shouldn't need to do it long-term, but you do need it today.

## 9. Server-side permission checks in edge functions

If an edge function performs a privileged action on a user's behalf (triggering a sync, mutating data, calling an external system), verify the user's permission **server-side**. Never trust the client's `hasPermission()` — the browser can be bypassed, so client-side gating is UX only, not security.

The platform's intended mechanism is a shell-provided RPC, `check_user_permission(p_user_id uuid, p_permission_key text) → boolean`, which resolves whether a user holds a permission (honoring system admins and `*` wildcard grants):

```ts
// After verifying the caller's JWT and resolving `user`:
const { data: allowed, error } = await serviceClient.rpc('check_user_permission', {
  p_user_id: user.id,
  p_permission_key: 'apps/<your-slug>/<resource>/<action>',
})
if (error || !allowed) {
  return new Response(
    JSON.stringify({ error: { message: 'Forbidden — missing permission' } }),
    { status: 403, headers: cors },
  )
}
```

Critical rules:

- **Declare the permission key** in `app.manifest.json` under `permissions` so admins can grant it via Role Management. The key you pass here must be one you declared.
- **NEVER degrade to an admin-only fallback** (e.g. `if (rpcError) allowed = profile.role === 'admin'`). That silently ignores granular permissions — a non-admin user who legitimately holds the permission via a custom role gets wrongly rejected, and the bug stays invisible because admins still pass. If the permission check can't run, treat it as a deployment/config error: fail loudly, log it, and surface a clear message — don't quietly fall back to admin-only.
- **Confirm the RPC is available** in the shell version your target portal runs before you rely on it. Server-side permission resolution is a platform capability — if `check_user_permission` isn't present in your portal, ask ElasticIT to provide it rather than reimplementing your own (an app-local reimplementation drifts from the platform's permission model and is easy to get subtly wrong).

---

## Where to look first

| If you want to know | Where it lives |
|---|---|
| How to scaffold a new app conversation with a client | `CLAUDE.md` — First-Turn Protocol |
| Schema mode setup, manifest, migrations, RLS | `CLAUDE.md` — External Data Access (Schema Mode) |
| Proxy mode setup, vault prefix, tenant isolation | `CLAUDE.md` — External Data Access (Proxy Mode) |
| Tailwind v4 rules, semantic tokens, custom grid CSS | `CLAUDE.md` — Critical Rules |
| Single-line plpgsql function body | `CLAUDE.md` — Troubleshooting |
| `EdgeRuntime.waitUntil` + pg_cron sync pattern | `CLAUDE.md` — Scheduled Sync Pattern |
| Local-dev environment setup | `CLAUDE.md` — Local Development |
| Patterns above (1000-row cap, CSV, scope hook, etc.) | This file |
