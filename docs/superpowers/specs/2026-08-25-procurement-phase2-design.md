# Procurement Phase 2 — Design

Date: 2026-08-25
Branch: `for-qa` · App version: 0.17.0 → **0.18.0** (MINOR — new features, backwards-compatible)
Repos touched: `msr-procurement-app` only (+ its QA Supabase project `jkbqaxpfvqbeepwhunhl`). No shell or ui-kit changes.

## Goals (from user)

1. Records page: remove the Delete button entirely; give admins the ability to **archive** items instead.
2. **Favorites** (heart) item list, suggested to purchaser and requester in all request form types (Item Name combobox + helper text).
3. Notifications: requesters should only see notifications about their own requests — concretely, **"New request to approve" must be visible to admins and approvers only**.
4. Conditional Formatting card: add a **font style** option (bold / italic / underline, combinable).

## Confirmed decisions (brainstorm Q&A)

- Archive is a **toggle**: Archive + Unarchive, never destructive.
- Archived items are **hidden everywhere** (Records default view, dashboard KPIs/charts, CSV export) except a "Show archived" view in Records.
- "New request to approve" delivery is restricted to **admin + approvers only**; all other event types are unchanged.
- Font style UI = **three independent checkboxes** (Bold / Italic / Underline) per rule, combinable.
- Favorites UI visibility: **only admin sees the favorites list in the UI** (manager tab). In requester/purchaser form views, **only auto-suggestion** appears (no heart, no management).
- Favorites manager location: **"Favorites" tab on the Purchasing page**, alongside Ready for Purchasing / Open Orders / Closed Orders, rendered only for admins.
- Because requesters never populate the list, favorites is a **single shared, admin-curated catalog** (not per-user): admin adds/removes items (name + optional URL); every authenticated user filling a request form gets suggestions from it.

---

## 1 — Records: Archive instead of Delete

### Schema (migration 028)

```sql
ALTER TABLE app_procurement.line_items ADD COLUMN archived_at timestamptz;  -- NULL = active

CREATE OR REPLACE FUNCTION app_procurement.archive_line_item(
  p_line_item_id uuid, p_archived boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app_procurement, public AS $fn$
BEGIN
  IF NOT public.check_user_permission(auth.uid(), 'apps/procurement/*') THEN
    RAISE EXCEPTION 'Only full-access admins can archive items';
  END IF;
  UPDATE app_procurement.line_items
     SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_line_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
END; $fn$;
REVOKE ALL ON FUNCTION app_procurement.archive_line_item(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_procurement.archive_line_item(uuid, boolean) TO service_role;
```

- Gate = `apps/procurement/*` (FULL_ACCESS) — the same gate the existing Delete button uses.
- Archiving does **not** change item or request status, and does **not** touch status rollups — it is a records-management marker, not a workflow state. Workflow queues (Approvals / Purchasing / Returns) are unaffected.
- The `delete_line_item` RPC stays in the DB (backwards-compatible, still available at DB level); it is only removed from the UI.

### Data layer (`src/data/db.ts`)

- `LineItemRow` gains `archived_at: string | null`.
- `listAllLineItemsDetailed()`, `listLineItemFacets()`, `countLineItems()` all gain an `archived_at is null` filter (new optional param defaults to excluding archived) → Records default view, dashboard stats/charts, and CSV export all exclude archived items automatically.
- New `archiveLineItem(id: string, archived: boolean)` → RPC.

### UI (`src/records/RecordsPage.tsx`)

- Delete button, `handleDelete`, and `canDelete` removed entirely.
- New **"Show archived"** checkbox (default off), placed next to the Export CSV button.
- When on: archived rows render an **Archived** badge next to the Status badge, and the row action reads **Unarchive**; active rows read **Archive**.
- CSV export exports exactly the rows currently visible (respects the toggle).
- `showActionsColumn` now depends on `canArchive || canReturn`.

---

## 2 — Favorites: admin-curated item catalog + form auto-suggest

### Schema (migration 029)

```sql
CREATE TABLE app_procurement.favorite_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  item_url   text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_favorite_items_name ON app_procurement.favorite_items (lower(name));

ALTER TABLE app_procurement.favorite_items ENABLE ROW LEVEL SECURITY;
-- Any authenticated user can read (form suggestions for requesters + purchasers).
CREATE POLICY favorite_items_read ON app_procurement.favorite_items
  FOR SELECT TO authenticated USING (true);
-- Only procurement admins (admin/manage) can manage the catalog.
CREATE POLICY favorite_items_write ON app_procurement.favorite_items
  FOR ALL TO authenticated
  USING (public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'))
  WITH CHECK (public.check_user_permission(auth.uid(), 'apps/procurement/admin/manage'));
```

- Anonymous (public-form visitors) get no read access → plain text input, no suggestions.
- Manifest `database.tables` gains `{ "name": "favorite_items", "rls": { "read": "authenticated", "write": "admin" } }`.

### Data layer (`src/data/db.ts`)

- `FavoriteItem { id: string; name: string; item_url: string | null; created_by: string | null; created_at: string }`
- `listFavorites(): FavoriteItem[]` — ordered by `name`.
- `addFavorite(name: string, itemUrl?: string | null)` — insert (PostgREST).
- `removeFavorite(id: string)` — delete by id.
- No RPCs needed; RLS enforces the admin-write gate.

### Form UI — auto-suggest only (no heart)

- New component `src/requester/ItemNameCombobox.tsx`, mirroring the existing `ShipToCombobox.tsx` pattern (searchable dropdown + free-text fallback + keyboard nav + outside-click close):
  - Focus with empty text → shows the full favorites list; typing filters it (case-insensitive substring).
  - Selecting a suggestion sets the item name; if the row's Item URL field is empty, it also fills the suggestion's URL.
  - Free text always allowed — a name not in the list can be typed verbatim.
- Helper text under the field (per user request): *"Tip: items on the favorites list are suggested as you type."*
- Wired into both form surfaces:
  - `LineItemFormRow.tsx` (in-app New Request form — every item row). Favorites are loaded once per form open (like workers), shared across rows.
  - `PublicRequestFormPage.tsx` inline item fields — for **authenticated** users only (private-link form); anonymous keeps the existing plain input.

### Admin UI — "Favorites" tab on Purchasing

- `src/pages/PurchasingPage.tsx`: new tab `{ key: 'favorites', label: 'Favorites' }`, rendered **only when `hasAppPermission(PERMS.admin)`** (the page itself stays gated to purchasing/manage or admin, so non-admin purchasers never see the tab).
- New component `src/purchasing/FavoritesTab.tsx`:
  - **Add form** at top: Name (required) + Item URL (optional) + Add button. Duplicate names (case-insensitive) are rejected with a toast (unique index + friendly pre-check).
  - **Table** of the catalog: Name (linked when a URL exists), URL, Added (MM/DD/YYYY via `formatDate`), Remove button per row (confirm dialog).
  - Empty state: "No favorite items yet. Add a standard item so it's suggested in request forms."

---

## 3 — Notifications: "New request to approve" → admins + approvers only

### Change (edge function `procurement-capture-and-notify`, local source `supabase/functions/procurement-capture-and-notify/index.ts`)

In the generic `notification` handler (the block that resolves `resolve_notification_recipients` and writes bell rows + email):

- When `key === 'request_submitted'`, after resolving opt-in recipients, **intersect** with `app_procurement.get_permission_holders('apps/procurement/approvals/act')` (existing RPC, service-role-only).
- `check_user_permission` (used by that RPC) returns true for system admins (`role = 'admin'`) and wildcard-matches, so the holder set = system admins + users granted `apps/procurement/approvals/act` + full-access `apps/procurement/*` holders. Exactly "admin and approvers".
- Users with no holder permission are dropped from **both** the bell rows and the email recipient list. Opt-in still applies for approvers (an opted-out approver gets nothing).
- All other keys (`item_approved`, `item_declined`, `item_ordered`, `item_cancelled`, `return_initiated`) are unchanged — still opt-in based.
- The approval screenshot email (separate `submitted` handler) already targets `get_permission_holders(APPROVE_PERMISSION)` — untouched.

### Rollout

- Redeploy the edge function to QA (new version). Prod deployment happens with the release flow, not in this phase.
- No shell changes, no catalog changes (the event stays in the per-user opt-in catalog; delivery is what's gated).

---

## 4 — Conditional Formatting: font styles

### Model (`src/formatting/rules.ts`)

- `FormatRule` gains optional `bold?: boolean; italic?: boolean; underline?: boolean` — optional so already-saved rules (without the keys) parse and render as "none". Backwards-compatible.
- `evalRowTone` (currently returns `Tone | null`) returns the full matched rule's presentation: `{ tone, bold, italic, underline } | null` (first enabled matching rule wins, same as today). Update `DEFAULT_RULES` consumers accordingly (defaults get no font flags).

### Rendering (`src/formatting/tones.ts`, `useFormattingRules.ts`)

- `FONT_CLASS` map with **literal** Tailwind classes (the @source scan requirement noted in tones.ts): `bold: 'font-bold'`, `italic: 'italic'`, `underline: 'underline'`.
- `useFormattingRules.toneClassFor(row)` returns the combined class string: background tint (as today) + any font classes. All existing call sites (Records, Requests, Approvals, Purchasing, Returns) pick up font styles automatically with no changes.

### Editor (`src/pages/AdminPage.tsx` → `FormattingRuleRow`)

- Three checkboxes — **Bold / Italic / Underline** — after the color select, independent and combinable.
- `handleAdd` default: all three false. "Reset to defaults" unchanged (default rules carry no font flags).
- Card description text updated: "…sets the row's tint (and font style)."

---

## Versioning & deployment

| Artifact | Change |
|---|---|
| `package.json` + `app.manifest.json` | 0.17.0 → **0.18.0** |
| QA Supabase migrations | 028 (archive), 029 (favorite_items) |
| Edge function | `procurement-capture-and-notify` redeployed to QA |
| Build | `npm run package` → `dist/procurement-0.18.0.eitapp`; delete stale 0.17.0 artifact |
| Git | commit + push `for-qa` (plain version on for-qa — established convention for this app) |
| QA portal | manual `.eitapp` upload (Admin → App Management → Publish App) |

Production rollout (0.18.0 + prod Supabase migrations + prod edge function) is a separate release-flow step after QA sign-off.

## Testing

- Unit (vitest, existing suite grows from 33):
  - `rules.ts`: font flags returned by `evalRow` (first-match-wins, disabled rules skipped, legacy rules without flags → none).
  - `drilldown.ts`/stats unaffected; `db.ts` filter logic covered by existing mocks if practical.
- Manual (QA portal, per the established handover format):
  1. Records: no Delete button; Archive hides the row everywhere (dashboard counts drop); Show archived → badge + Unarchive restores; CSV respects the toggle.
  2. Purchasing → Favorites (admin only): add "Dell 27" Monitor" + URL; duplicate rejected; non-admin sees no tab.
  3. New Request form (requester): typing "Dell" suggests the favorite; selecting fills name + URL; free text still works; helper text present. Private-link form: authed user gets suggestions; anonymous does not.
  4. Notifications: submit a request as a requester account → approver + admin get the bell + email "New request to approve"; the requester does not. Item-status notifications unchanged.
  5. Admin → Conditional Formatting: add a rule with Bold + Underline; matching rows render bold+underlined across Records/Requests/Approvals/Purchasing/Returns; saved rules reload with flags; old saved rules render unchanged.
  6. `tsc` clean, lint clean, full vitest pass.

## Non-goals / out of scope

- No per-user favorites, no heart in requester forms (per confirmed decision).
- No broader notification re-scoping (item events stay opt-in based).
- No `delete_line_item` removal from the database.
- No shell/ui-kit changes; no production deployment in this phase.
- No strikethrough option (user approved Bold/Italic/Underline only).
