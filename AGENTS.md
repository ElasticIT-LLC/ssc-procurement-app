# Procurement App — Agent Workflows

## Team
- **Dev:** Jerome
- Based on ElasticIT Portal agent standards.

## Process Rules

### Backward Compatibility
All updates should be backwards-compatible by default. Avoid breaking changes unless absolutely necessary. When a breaking change is required:
- Increment the MAJOR version
- Coordinate before implementing

### Semantic Versioning

App version lives in `app.manifest.json` — that is authoritative. `package.json` version may lag.

- **MAJOR** — Backwards-incompatible changes (e.g., breaking manifest contract, removed permissions/pages)
- **MINOR** — Backwards-compatible new features (e.g., new pages, new email templates, new migration)
- **PATCH** — Backwards-compatible fixes (e.g., missing permission on page, typo fix)

Before bumping, validate the reason matches the increment type.

### QA Handover Format

Every ClickUp task handover must include:
1. **What changed & why** — short summary
2. **Expected behavior** — clear, testable pass/fail statements
3. **How to test it** — URL, test accounts, step-by-step actions

### ClickUp Task Update Comment Format

- **Header:** `Procurement — Dev update (YYYY-MM-DD): vX.Y.Z in progress`
- **Intro:** One sentence context
- ✅ **✅ Completed** — bullet points
- 🟡 **🟡 In progress** — status details
- ℹ️ **ℹ️ Investigated** — research notes
- 🛠️ **🛠️ Errors found & fixed** — ordered list
- ⏳ **⏳ Pending (next session)** — remaining work

### Commit, Branch, and Release Workflow

- All updates → commit and push to `for-qa` branch
- Release to production on last day of sprint, or when instructed
- QA testing on mainspring portal

## Mandatory Completion Checklist

Before claiming any task is complete, the agent must verify all applicable items below. Use the `verification-before-completion` skill if unsure. Skipping an item requires explicit user approval.

- [ ] **Semver bump** — `app.manifest.json` version incremented according to the change type.
  - MAJOR: backwards-incompatible manifest/permission/API changes
  - MINOR: backwards-compatible new features (new pages, new email templates, new migrations, new workflow events)
  - PATCH: backwards-compatible fixes (RLS fixes, UI labels, typo/bug fixes)
- [ ] **Build passes** — `npm run build` succeeds with no errors.
- [ ] **Tests pass** — `npm run test` succeeds (if tests exist for the changed area).
- [ ] **Package created** — `npm run package` produces `dist/procurement-X.Y.Z.eitapp`.
- [ ] **Migrations applied to QA** — any new migration applied to the QA Supabase project (`jkbqaxpfvqbeepwhunhl`).
- [ ] **Edge functions deployed** — any changed edge function deployed to QA via `supabase functions deploy --project-ref jkbqaxpfvqbeepwhunhl`.
- [ ] **Committed and pushed to for-qa** — changes committed and pushed to the `for-qa` branch.
- [ ] **ClickUp updated** — dev update comment posted to the task following the format below.
- [ ] **QA handover notes** — for any user-facing change, QA handover notes added to the ClickUp task.
- [ ] **AGENTS.md updated** — if the workflow, conventions, or setup steps changed.

## App-Specific Conventions

- **Manifest** is single source of truth for slug, permissions, pages, migrations, edge functions, notifications, vault secrets
- **Never edit an applied migration** — add a new numbered one
- **SECURITY DEFINER** functions use wrapper-in-public / definer-in-internal pattern
- **Never expose keys** in committed code
- **SemVer is mandatory:** bump `app.manifest.json` version on every feature/fix and document the reason in the commit message
