# Vendor Dependencies

Pre-built ElasticIT packages bundled here so clients can build and test
without GitHub Packages authentication.

## Current versions

| Package | Version | Updated | Used by |
|---------|---------|---------|---------|
| @elasticit-llc/app-bridge | 0.7.5 | 2026-04-30 | App build + test-shell |
| @elasticit-llc/shell | 0.12.11 | 2026-04-30 | local-dev test-shell |
| @elasticit-llc/ui-kit | 0.5.4 | 2026-04-24 | App build (components + tokens) |

## How to update

When a new version is published (you'll receive a GitHub issue alert):

1. Build + pack the updated package:
   ```bash
   cd <path-to>/elasticit-app-bridge   # or elasticit-shell
   git pull && npm run build && npm pack
   ```

2. Replace the .tgz in this directory

3. Update references in:
   - Root `package.json` (devDependencies) — for app-bridge
   - `local-dev/test-shell/package.json` (dependencies) — for shell

4. Update the version table above

5. Commit and push
</content>
</invoke>