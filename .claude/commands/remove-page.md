# Remove Page

Remove a page from the app: delete the component, update routing, and clean up manifest + permissions.

## Step 1: Identify the Page

Read `app.manifest.json` and list all pages:
```
Current pages:
  1. dashboard — "Dashboard" (apps/{slug}/dashboard/view)
  2. users — "Users" (apps/{slug}/users/view)
  3. settings — "Settings" (apps/{slug}/settings/manage)
```

Ask the user: **"Which page do you want to remove?"**

**Guard:** If only one page remains, warn that the app needs at least one page. Do not proceed.

## Step 2: Confirm

Show what will be deleted:
```
Will remove:
  - src/pages/{PageName}Page.tsx
  - Case '{key}' from src/App.tsx switch
  - Page entry from app.manifest.json pages[]
  - Permission 'apps/{slug}/{key}/view' from app.manifest.json permissions[]
  - registerPage('{key}', ...) from src/index.ts setup()
```

Ask: **"Proceed? (yes/no)"**

## Step 3: Execute

1. **Delete the page component:**
   Delete `src/pages/{PageName}Page.tsx`

2. **Update `src/App.tsx`:**
   Remove the `case '{key}':` block from the switch statement.
   If this was the default case, update the default to point to another page.

3. **Update `src/index.ts`:**
   Remove the `api.registerPage('{key}', ...)` line from the `setup()` function.
   Remove the corresponding lazy import.

4. **Update `app.manifest.json`:**
   - Remove the page from `pages[]`
   - Remove the page-specific permission from `permissions[]` (e.g., `apps/{slug}/{key}/view`)
   - Keep the wildcard permission (`apps/{slug}/*`)

## Step 4: Verify

```bash
npm run build
```

If the build succeeds, print a summary of what was removed.

If the build fails (e.g., another component imported the deleted page), show the error and help fix it.
