# Add Page

Add a new page to this app.

## Steps

1. Ask for:
   - **Page key** (e.g., `reports`) — used in `currentPage` switch and permissions
   - **Page label** (e.g., "Reports") — shown in sidebar
   - **Permission key** (e.g., `apps/{slug}/reports/view`) — required to see the page
   - **Permission group** (e.g., "Reports") — grouping in admin Roles page

2. Create the page component at `src/pages/{PageName}Page.tsx`:
   ```tsx
   export default function {PageName}Page({ tenantId }: { tenantId: string }) {
     return (
       <div>
         <h1 className="text-2xl font-bold text-shell-100 mb-6">{label}</h1>
         {/* TODO: Implement page content */}
       </div>
     )
   }
   ```

3. Add to `src/App.tsx` switch:
   ```tsx
   case '{key}':
     return <{PageName}Page tenantId={tenantId} />
   ```

4. Add import at top of `src/App.tsx`

5. Add to `app.manifest.json` (the unified source of truth — permissions + pages + database config all live here):
   - Permission entry in `permissions[]`: `{ "key": "{permKey}", "label": "...", "description": "...", "group": "{group}" }`
   - Page entry in `pages[]`: `{ "key": "{key}", "label": "{label}", "permission": "{permKey}" }`

6. Run `npm run build` to verify. Optionally `npm run package` to produce a `.eitapp` for Admin UI upload.
