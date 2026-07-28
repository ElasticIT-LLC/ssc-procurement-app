# Agent Workflows — ElasticIT Portal (Orchestrator)

## Important: This Repo Is Documentation Only

This `elasticit-portal` repo is a **documentation hub** — reference and guides only.
Real code lives in the individual repos listed in `README.md` (framework, client shells, apps).
When searching for code, always look in the actual repos, NOT this one.

## Team

- **Devs:** Jerome, Robert
- All process rules apply to sessions with either developer.

## Process Rules

### Backward Compatibility

All updates should be backwards-compatible by default. Avoid breaking changes unless absolutely necessary. When a breaking change is required:
- Increment the MAJOR version
- Run breaking change impact analysis (see below) before releasing
- Coordinate with the other dev before implementing

### Semantic Versioning

All packages follow semver: `MAJOR.MINOR.PATCH`
- **MAJOR** — Backwards-incompatible API changes (e.g., `2.0.0` → `3.0.0`)
- **MINOR** — Backwards-compatible new features (e.g., `2.1.0` → `2.2.0`)
- **PATCH** — Backwards-compatible bug fixes (e.g., `2.1.1` → `2.1.2`)

Before committing a version bump, validate the bump reason matches the increment type. If possible, automate this check.

### Remove Old Build Artifacts

After bumping a version and building (e.g., packaging a new `.eitapp`), **always remove the old build artifact** from the output directory (e.g., `dist/`). Only the current version's artifact should remain. This prevents accidental uploads of stale versions.

### QA Handover Format

Every ClickUp task handover must include:
1. **What changed & why** — short summary of what was built/fixed and the reason
2. **Expected behavior** — clear, testable pass/fail statements QA should verify
3. **How to test it** — environment/URL, test accounts or data, step-by-step actions

### ClickUp Task Update Comment Format

Every dev update comment on a ClickUp task should follow this structure (reference: https://app.clickup.com/t/90182493682/86exz0ujv?comment=90180235956452):

- **Header:** `AppName — Dev update (YYYY-MM-DD): vX.Y.Z in progress`
- **Intro:** One sentence context
- ✅ **✅ Completed** — completed work with bullet points (sub-items indented)
- 🟡 **🟡 In progress** — work currently underway with status details
- ℹ️ **ℹ️ Investigated** — items researched/confirmed, no changes needed
- 🛠️ **🛠️ Errors found & fixed** — ordered list of bugs caught and how
- ⏳ **⏳ Pending (next session)** — remaining work plan as bullet points
- **Note:** italic note for important caveats (e.g., version state, QA dependencies)

### Commit, Branch, and Release Workflow

- All updates → commit and push to `for-qa` branch in each affected repo
- Release to production on the last day of the sprint, or when instructed
- Pre-release workflow: `elasticit-shell` uses pre-release versions (e.g., `0.24.1-qa.6`) for `for-qa` staging
- QA testing currently happens through mainspring shell (only client with Supabase QA branch)
- Other client shells (`certus`, `solterra`, `elasticit`) have `for-qa` branches and will get Supabase QA branches

## Cross-Repo Version Sync

**Trigger:** Weekly or on-demand
**Task:** Check all client-*-shell repos for outdated `@elasticit-llc/*` dependencies. For each outdated dependency, create a PR bumping to latest.
**How:** Run `scripts/push-all.sh --status`, then check `npm outdated` in each client shell.

## Ecosystem Audit

**Trigger:** On-demand
**Task:** Run `/audit` in each repo, collect results into a unified health dashboard.
**How:** Iterate through REPOS array in `scripts/push-all.sh`, run audit checks per repo.

## Breaking Change Impact Analysis

**Trigger:** Before publishing shell or app-bridge with breaking changes
**Task:** Search all downstream repos for usages of changed interfaces. Report which repos would break.
**How:** Grep for changed type/function names across all repos.

## Documentation Freshness

**Trigger:** After PR merges to elasticit-shell or elasticit-app-bridge
**Task:** Check if CLAUDE.md needs updating (new exports, changed APIs). Draft update if needed.
**How:** Compare CLAUDE.md export lists against actual barrel exports in `src/index.ts`.
