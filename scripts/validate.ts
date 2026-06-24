#!/usr/bin/env tsx
/**
 * App manifest & source consistency validator.
 *
 * Catches the silent-failure mistakes that let broken apps ship to the shell:
 *   - .from/.rpc/.api calls missing from manifest allowlists (→ 403 in prod)
 *   - currentPage switch cases with no matching manifest page (→ blank page in runtime mode)
 *   - hasPermission(X) with X not declared in manifest permissions (→ always false)
 *   - @import "tailwindcss" instead of "tailwindcss/utilities" (→ breaks shell brand colors)
 *   - showToast('msg', 'type') two-arg form (→ silent no-op)
 *   - Reserved / uncustomized / length-invalid slug, slug ↔ package.json name mismatch
 *   - react-router-dom or custom Supabase client imports
 *   - Schema-mode migrations referenced in manifest but missing on disk
 *   - Dual export missing from src/index.ts
 *
 * Invoked four ways:
 *   1. prebuild   — blocks `npm run build` if any errors
 *   2. PostToolUse hook — runs after Claude edits src/**, app.manifest.json, package.json
 *   3. husky pre-commit — blocks `git commit` if any errors
 *   4. scripts/package.ts — runs with --strict before building the .eitapp archive;
 *      strict mode promotes TEMPLATE_UNCUSTOMIZED_* warnings to errors so a still-
 *      unconfigured scaffold can't produce a shippable bundle.
 *
 * Exit code: 0 if clean, 1 if any errors (warnings don't fail unless --strict is set).
 *
 * Flags:
 *   --strict    Promote TEMPLATE_UNCUSTOMIZED_SLUG/_NAME/_ICON warnings to errors.
 *               Use this from the packager and pre-publish paths — never at dev time.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const STRICT = process.argv.includes('--strict')
const STRICT_PROMOTE_CODES = new Set([
  'TEMPLATE_UNCUSTOMIZED_SLUG',
  'TEMPLATE_UNCUSTOMIZED_NAME',
  'TEMPLATE_UNCUSTOMIZED_NOTIFICATION',
  'TEMPLATE_UNCUSTOMIZED_ICON',
])

const ROOT = resolve(process.cwd())
const MANIFEST_PATH = join(ROOT, 'app.manifest.json')
const PKG_PATH = join(ROOT, 'package.json')
const VITE_CONFIG_PATH = join(ROOT, 'vite.config.ts')
const APP_CSS_PATH = join(ROOT, 'src', 'app.css')
const APP_TSX_PATH = join(ROOT, 'src', 'App.tsx')
const INDEX_TS_PATH = join(ROOT, 'src', 'index.ts')
const SRC_DIR = join(ROOT, 'src')

// ── Types ────────────────────────────────────────────────────────────────────

type Level = 'error' | 'warn'
interface Issue {
  level: Level
  code: string
  message: string
  fix: string
  file?: string
  line?: number
}

interface Manifest {
  slug?: string
  name?: string
  permissions?: { key: string; label?: string; description?: string; group?: string }[]
  pages?: { key: string; label?: string; permission?: string }[]
  database?: {
    mode?: 'proxy' | 'schema'
    proxy?: {
      vault_prefix?: string
      allowed_tables?: string[]
      allowed_rpcs?: string[]
      allowed_api_endpoints?: string[]
      tenant_isolation?: { enabled?: boolean; column?: string; setting_key?: string }
      forward_to_functions?: boolean
      api_config?: {
        type?: 'bearer_token' | 'api_key' | 'oauth2_client_credentials'
        base_url?: string
        url_template?: string
        vault_keys?: Record<string, string>
        tenant_setting_key?: string
      }
    }
    schema?: string
    migrations?: { version: number; description?: string; up: string }[]
    tables?: { name: string; rls?: unknown }[]
  }
  vault_secrets?: { key: string; description: string }[]
}

const issues: Issue[] = []
const add = (i: Issue) => issues.push(i)

// ── File helpers ─────────────────────────────────────────────────────────────

function walk(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full, exts))
    else if (exts.some(e => entry.endsWith(e))) out.push(full)
  }
  return out
}

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function readJson<T = unknown>(path: string): T | null {
  const raw = read(path)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function lineOf(content: string, idx: number): number {
  return content.slice(0, idx).split('\n').length
}

function rel(path: string): string {
  return relative(ROOT, path).replace(/\\/g, '/')
}

// ── Load inputs ──────────────────────────────────────────────────────────────

const manifest = readJson<Manifest>(MANIFEST_PATH)
if (!manifest) {
  add({
    level: 'error',
    code: 'MANIFEST_MISSING',
    message: 'app.manifest.json is missing or invalid JSON',
    fix: 'Create app.manifest.json at repo root. Use types/app-manifest.schema.json for reference.',
    file: rel(MANIFEST_PATH),
  })
}

const pkg = readJson<Record<string, unknown>>(PKG_PATH)
const viteConfig = read(VITE_CONFIG_PATH) ?? ''
const appCss = read(APP_CSS_PATH) ?? ''
const appTsx = read(APP_TSX_PATH) ?? ''
const indexTs = read(INDEX_TS_PATH) ?? ''
const srcFiles = walk(SRC_DIR, ['.ts', '.tsx'])

// Collected references from source
const fromCalls = new Map<string, { file: string; line: number }[]>()
const rpcCalls = new Map<string, { file: string; line: number }[]>()
const apiCalls = new Map<string, { file: string; line: number }[]>()
const permissionChecks = new Map<string, { file: string; line: number }[]>()
const registerPageCalls = new Map<string, { file: string; line: number }[]>()

for (const file of srcFiles) {
  const content = read(file)
  if (!content) continue

  const collect = (re: RegExp, bucket: Map<string, { file: string; line: number }[]>) => {
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const key = m[1]
      const line = lineOf(content, m.index)
      if (!bucket.has(key)) bucket.set(key, [])
      bucket.get(key)!.push({ file: rel(file), line })
    }
  }

  collect(/\.from\(\s*['"]([^'"]+)['"]/g, fromCalls)
  collect(/\.rpc\(\s*['"]([^'"]+)['"]/g, rpcCalls)
  collect(/\.api\(\s*['"]([^'"]+)['"]/g, apiCalls)
  collect(/hasPermission\(\s*['"]([^'"]+)['"]/g, permissionChecks)
  collect(/registerPage\(\s*['"]([^'"]+)['"]/g, registerPageCalls)
}

// currentPage switch cases from App.tsx
const currentPageCases = new Set<string>()
{
  const re = /case\s+['"]([^'"]+)['"]\s*:/g
  let m: RegExpExecArray | null
  while ((m = re.exec(appTsx)) !== null) currentPageCases.add(m[1])
}

// ── Check: manifest schema basics ────────────────────────────────────────────

// App-name structural rules. The slug is the load-bearing identifier: it appears in
// permission keys (apps/{slug}/*), vault secret names ({slug}_supabase_url), the
// database schema (app_{slug}), and the generic app-proxy routing. Keep these in
// sync with the First-Turn Protocol in CLAUDE.md.
const RESERVED_SLUGS = new Set(['admin', 'shell', 'portal', 'app', 'apps', 'login'])
const SLUG_MIN_LEN = 3
const SLUG_MAX_LEN = 32
const TEMPLATE_DEFAULT_SLUG = 'my-app'
const TEMPLATE_DEFAULT_NAME = 'My App'
const TEMPLATE_DEFAULT_ICON = 'Puzzle'

if (manifest) {
  if (!manifest.slug) {
    add({
      level: 'error',
      code: 'MANIFEST_NO_SLUG',
      message: 'app.manifest.json missing required "slug" field',
      fix: 'Add a slug matching /^[a-z][a-z0-9-]*$/ (lowercase, hyphens only, 3-32 chars)',
      file: rel(MANIFEST_PATH),
    })
  } else {
    const slug = manifest.slug
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      add({
        level: 'error',
        code: 'MANIFEST_BAD_SLUG',
        message: `slug "${slug}" must be lowercase letters, digits, and hyphens only (start with a letter)`,
        fix: 'Rename slug to match /^[a-z][a-z0-9-]*$/',
        file: rel(MANIFEST_PATH),
      })
    }
    if (slug.length < SLUG_MIN_LEN) {
      add({
        level: 'error',
        code: 'SLUG_TOO_SHORT',
        message: `slug "${slug}" is ${slug.length} chars — minimum is ${SLUG_MIN_LEN}`,
        fix: `Use a slug of at least ${SLUG_MIN_LEN} characters (e.g., "inventory", "billing", "field-ops")`,
        file: rel(MANIFEST_PATH),
      })
    }
    if (slug.length > SLUG_MAX_LEN) {
      add({
        level: 'warn',
        code: 'SLUG_TOO_LONG',
        message: `slug "${slug}" is ${slug.length} chars — recommended max is ${SLUG_MAX_LEN}`,
        fix: 'Shorten the slug. Long slugs bloat permission keys, vault secret names, and the database schema name.',
        file: rel(MANIFEST_PATH),
      })
    }
    if (RESERVED_SLUGS.has(slug)) {
      add({
        level: 'error',
        code: 'SLUG_RESERVED',
        message: `slug "${slug}" is reserved — conflicts with shell / portal concepts`,
        fix: `Pick a different slug. Reserved: ${[...RESERVED_SLUGS].sort().join(', ')}`,
        file: rel(MANIFEST_PATH),
      })
    }
    if (slug === TEMPLATE_DEFAULT_SLUG) {
      add({
        level: 'warn',
        code: 'TEMPLATE_UNCUSTOMIZED_SLUG',
        message: `slug is still "${TEMPLATE_DEFAULT_SLUG}" — this is the template default`,
        fix: 'Change slug in app.manifest.json to match your app (e.g., "inventory", "field-ops"). The slug drives permission keys, vault secret names, and the database schema.',
        file: rel(MANIFEST_PATH),
      })
    }

    // package.json name should align with slug so it's clear which repo belongs to which app.
    // Accepted shapes: `{slug}`, `{slug}-app`, `@scope/{slug}`, `@scope/{slug}-app`.
    // Only skip the mismatch warning when BOTH the slug AND pkg name are still template
    // defaults (so TEMPLATE_UNCUSTOMIZED_SLUG covers it without double-reporting).
    // If one is customized and the other isn't, that's a real mismatch — fire the warning.
    if (pkg) {
      const pkgName = typeof pkg.name === 'string' ? pkg.name : ''
      const unscoped = pkgName.replace(/^@[^/]+\//, '')
      const bothStillDefault =
        slug === TEMPLATE_DEFAULT_SLUG && unscoped === TEMPLATE_DEFAULT_SLUG
      const matchesSlug =
        unscoped === slug ||
        unscoped === `${slug}-app` ||
        bothStillDefault
      if (pkgName && !matchesSlug) {
        add({
          level: 'warn',
          code: 'SLUG_PACKAGE_MISMATCH',
          message: `package.json "name" is "${pkgName}" but manifest slug is "${slug}"`,
          fix: `Rename package.json "name" to "${slug}" (or "${slug}-app", optionally scoped like "@your-org/${slug}") so the repo identity matches the app identity`,
          file: rel(PKG_PATH),
        })
      }
    }
  }

  if (!manifest.name) {
    add({
      level: 'error',
      code: 'MANIFEST_NO_NAME',
      message: 'app.manifest.json missing required "name" field',
      fix: 'Add a human-readable "name" to app.manifest.json',
      file: rel(MANIFEST_PATH),
    })
  } else if (manifest.name === TEMPLATE_DEFAULT_NAME) {
    add({
      level: 'warn',
      code: 'TEMPLATE_UNCUSTOMIZED_NAME',
      message: `name is still "${TEMPLATE_DEFAULT_NAME}" — this is the template default`,
      fix: 'Change name in app.manifest.json to your app\'s human-readable name (appears in the portal sidebar and Admin UI)',
      file: rel(MANIFEST_PATH),
    })
  }

  if (manifest.icon === TEMPLATE_DEFAULT_ICON) {
    add({
      level: 'warn',
      code: 'TEMPLATE_UNCUSTOMIZED_ICON',
      message: `icon is still "${TEMPLATE_DEFAULT_ICON}" — this is the template default`,
      fix: 'Change icon in app.manifest.json to a Lucide PascalCase name from the shell\'s AppIcon registry (e.g., "Calendar" for scheduling, "BarChart3" for analytics, "Building2" for field ops, "CreditCard" for billing, "Printer" for print apps). Emoji values still render via the shell\'s compat fallback but Lucide is the default going forward.',
      file: rel(MANIFEST_PATH),
    })
  }

  if (!manifest.permissions || manifest.permissions.length === 0) {
    add({
      level: 'error',
      code: 'MANIFEST_NO_PERMISSIONS',
      message: 'app.manifest.json has no permissions[] entries',
      fix: `Add at least the wildcard: { "key": "apps/${manifest.slug ?? '<slug>'}/*", "label": "Full Access", "description": "Full access to all features", "group": "Administration" }`,
      file: rel(MANIFEST_PATH),
    })
  } else if (manifest.slug) {
    const hasWildcard = manifest.permissions.some(p => p.key === `apps/${manifest.slug}/*`)
    if (!hasWildcard) {
      add({
        level: 'warn',
        code: 'MANIFEST_NO_WILDCARD',
        message: `permissions[] missing wildcard "apps/${manifest.slug}/*"`,
        fix: `Add { "key": "apps/${manifest.slug}/*", "label": "Full Access", "description": "...", "group": "Administration" } to permissions[]`,
        file: rel(MANIFEST_PATH),
      })
    }
  }

  if (!manifest.pages || manifest.pages.length === 0) {
    add({
      level: 'error',
      code: 'MANIFEST_NO_PAGES',
      message: 'app.manifest.json has no pages[] entries',
      fix: 'Add at least one page to pages[] (e.g., { "key": "dashboard", "label": "Dashboard", "permission": "apps/<slug>/dashboard/view" })',
      file: rel(MANIFEST_PATH),
    })
  }

  // Notifications are a required declaration. Every app must declare which
  // event types users can opt in to receive — even if the answer is "none"
  // (declare an empty array). Mirrors the publish-app server-side check.
  const mn = (manifest as any).notifications
  if (mn === undefined || mn === null) {
    add({
      level: 'error',
      code: 'MANIFEST_NO_NOTIFICATIONS',
      message: 'app.manifest.json is missing the required "notifications" field',
      fix: 'Add a "notifications" array to app.manifest.json declaring the events your app emits that users can opt in to. Each entry: { "key": "snake_case", "label": "Short label", "description": "When this fires" }. To explicitly opt out of notifications, use "notifications": [].',
      file: rel(MANIFEST_PATH),
    })
  } else if (!Array.isArray(mn)) {
    add({
      level: 'error',
      code: 'MANIFEST_BAD_NOTIFICATIONS',
      message: 'app.manifest.json "notifications" must be an array',
      fix: 'Change "notifications" to an array of { key, label, description? } entries.',
      file: rel(MANIFEST_PATH),
    })
  } else {
    const seen = new Set<string>()
    for (let i = 0; i < mn.length; i++) {
      const n = mn[i]
      if (!n || typeof n !== 'object') {
        add({
          level: 'error',
          code: 'NOTIFICATION_BAD_ENTRY',
          message: `notifications[${i}] is not an object`,
          fix: 'Each entry must be { "key": "...", "label": "...", "description"?: "..." }.',
          file: rel(MANIFEST_PATH),
        })
        continue
      }
      if (typeof n.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(n.key)) {
        add({
          level: 'error',
          code: 'NOTIFICATION_BAD_KEY',
          message: `notifications[${i}].key "${n.key}" must match /^[a-z][a-z0-9_]*$/ (snake_case, starts with a letter)`,
          fix: `Rename the key. The full event_type fired to send-notification will be "${manifest.slug ?? '<slug>'}:${n.key}".`,
          file: rel(MANIFEST_PATH),
        })
      } else if (seen.has(n.key)) {
        add({
          level: 'error',
          code: 'NOTIFICATION_DUPLICATE_KEY',
          message: `notifications[] has duplicate key "${n.key}"`,
          fix: 'Each event key must be unique within this app.',
          file: rel(MANIFEST_PATH),
        })
      } else if (n.key) {
        seen.add(n.key)
      }
      if (typeof n.label !== 'string' || n.label.trim().length === 0) {
        add({
          level: 'error',
          code: 'NOTIFICATION_NO_LABEL',
          message: `notifications[${i}] missing required "label"`,
          fix: 'Add a short user-facing label (this is what users see next to the opt-in checkbox).',
          file: rel(MANIFEST_PATH),
        })
      }
      if (n.key === 'example_event') {
        add({
          level: 'warn',
          code: 'TEMPLATE_UNCUSTOMIZED_NOTIFICATION',
          message: `notifications[${i}].key is still "example_event" — this is the template default`,
          fix: 'Replace the example_event stub with the actual events your app emits, OR remove it and declare "notifications": [] if your app emits nothing.',
          file: rel(MANIFEST_PATH),
        })
      }
    }
  }
}

// ── Check: page keys consistent across manifest / App.tsx / setup() ──────────

if (manifest?.pages) {
  const manifestPageKeys = new Set(manifest.pages.map(p => p.key))

  // Every manifest page should have a currentPage switch case
  for (const page of manifest.pages) {
    if (!currentPageCases.has(page.key)) {
      add({
        level: 'warn',
        code: 'PAGE_NO_SWITCH_CASE',
        message: `Manifest page "${page.key}" has no matching case in App.tsx currentPage switch`,
        fix: `Add \`case '${page.key}': return <${capitalize(page.key)}Page />\` to the switch in src/App.tsx`,
        file: rel(APP_TSX_PATH),
      })
    }
    if (!registerPageCalls.has(page.key)) {
      add({
        level: 'warn',
        code: 'PAGE_NO_REGISTER',
        message: `Manifest page "${page.key}" is not registered via api.registerPage() in setup()`,
        fix: `Add \`api.registerPage('${page.key}', lazy(() => import('./pages/${capitalize(page.key)}Page')))\` to setup() in src/index.ts (required for runtime-loaded apps)`,
        file: rel(INDEX_TS_PATH),
      })
    }
  }

  // Every currentPage case should have a manifest page
  for (const caseKey of currentPageCases) {
    if (!manifestPageKeys.has(caseKey)) {
      add({
        level: 'error',
        code: 'SWITCH_CASE_NO_PAGE',
        message: `App.tsx has \`case '${caseKey}'\` but no matching page in app.manifest.json pages[]`,
        fix: `Add { "key": "${caseKey}", "label": "...", "permission": "apps/<slug>/..." } to pages[] in app.manifest.json, OR remove the case from App.tsx`,
        file: rel(APP_TSX_PATH),
      })
    }
  }

  // Every registerPage call should have a manifest page
  for (const [key, refs] of registerPageCalls) {
    if (!manifestPageKeys.has(key)) {
      const first = refs[0]
      add({
        level: 'error',
        code: 'REGISTER_NO_PAGE',
        message: `registerPage('${key}') has no matching page in app.manifest.json pages[]`,
        fix: `Add { "key": "${key}", "label": "...", "permission": "..." } to pages[] in app.manifest.json, OR remove the registerPage call`,
        file: first.file,
        line: first.line,
      })
    }
  }

  // Page permission references must exist in permissions[]
  const manifestPermKeys = new Set((manifest.permissions ?? []).map(p => p.key))
  for (const page of manifest.pages) {
    if (page.permission && !manifestPermKeys.has(page.permission)) {
      add({
        level: 'error',
        code: 'PAGE_PERMISSION_UNDECLARED',
        message: `Page "${page.key}" references permission "${page.permission}" which is not in permissions[]`,
        fix: `Add { "key": "${page.permission}", "label": "...", "description": "...", "group": "..." } to permissions[] in app.manifest.json`,
        file: rel(MANIFEST_PATH),
      })
    }
  }
}

// ── Check: proxy allowlists ──────────────────────────────────────────────────

const proxy = manifest?.database?.mode === 'proxy' ? manifest.database.proxy : undefined
const allowedTables = new Set(proxy?.allowed_tables ?? [])
const allowedRpcs = new Set(proxy?.allowed_rpcs ?? [])
const allowedApis = new Set(proxy?.allowed_api_endpoints ?? [])

function checkAllowlist(
  calls: Map<string, { file: string; line: number }[]>,
  allowlist: Set<string>,
  allowlistField: string,
  method: string,
  code: string,
) {
  for (const [name, refs] of calls) {
    if (!allowlist.has(name)) {
      const first = refs[0]
      add({
        level: 'error',
        code,
        message: `${method}('${name}') but "${name}" is not in manifest.database.proxy.${allowlistField}`,
        fix: `Add "${name}" to database.proxy.${allowlistField} in app.manifest.json (currently: ${JSON.stringify([...allowlist])})`,
        file: first.file,
        line: first.line,
      })
    }
  }
}

if (manifest?.database?.mode === 'proxy') {
  checkAllowlist(fromCalls, allowedTables, 'allowed_tables', '.from', 'FROM_NOT_ALLOWED')
  checkAllowlist(rpcCalls, allowedRpcs, 'allowed_rpcs', '.rpc', 'RPC_NOT_ALLOWED')
  checkAllowlist(apiCalls, allowedApis, 'allowed_api_endpoints', '.api', 'API_NOT_ALLOWED')
} else if (fromCalls.size || rpcCalls.size || apiCalls.size) {
  // Proxy calls exist but manifest has no proxy config
  const sampleCall = fromCalls.size ? `.from('${[...fromCalls.keys()][0]}')` : rpcCalls.size ? `.rpc('${[...rpcCalls.keys()][0]}')` : `.api('${[...apiCalls.keys()][0]}')`
  add({
    level: 'error',
    code: 'PROXY_CONFIG_MISSING',
    message: `Source contains proxy calls (e.g., ${sampleCall}) but app.manifest.json has no database.mode: "proxy" config`,
    fix: `Add "database": { "mode": "proxy", "proxy": { "vault_prefix": "...", "allowed_tables": [...], "allowed_rpcs": [...], "allowed_api_endpoints": [...] } } to app.manifest.json`,
    file: rel(MANIFEST_PATH),
  })
}

// ── Check: hasPermission strings declared in manifest ────────────────────────

if (manifest?.permissions) {
  const manifestPermKeys = new Set(manifest.permissions.map(p => p.key))
  for (const [perm, refs] of permissionChecks) {
    // Allow wildcards that would match a manifest key
    const matches = [...manifestPermKeys].some(k => wildcardMatch(k, perm) || wildcardMatch(perm, k))
    if (!matches) {
      const first = refs[0]
      add({
        level: 'error',
        code: 'PERMISSION_UNDECLARED',
        message: `hasPermission('${perm}') but "${perm}" is not declared in manifest permissions[]`,
        fix: `Add { "key": "${perm}", "label": "...", "description": "...", "group": "..." } to permissions[] in app.manifest.json`,
        file: first.file,
        line: first.line,
      })
    }
  }
}

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === value) return true
  if (pattern === '*') return true
  if (!pattern.includes('*')) return false
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
  return re.test(value)
}

// ── Check: proxy mode declared but proxy block missing ─────────────────────

if (manifest?.database?.mode === 'proxy' && !manifest.database.proxy) {
  add({
    level: 'error',
    code: 'PROXY_BLOCK_MISSING',
    message: `database.mode is "proxy" but database.proxy block is missing — publish-app would persist db_mode='none' and the app would fail at runtime with "App not configured for proxy access".`,
    fix: `Add a database.proxy block with at least vault_prefix and either allowed_tables/allowed_rpcs (own remote Supabase) or api_config (external HTTP API). See "Setup: Bearer Token / API Key / OAuth2" walkthroughs.`,
    file: rel(MANIFEST_PATH),
  })
}

// ── Check: vault secrets validity for proxy mode ────────────────────────────
//
// Two distinct proxy patterns:
//  - "remote Supabase": app has its own separate Supabase project. Proxy
//    forwards table queries / RPCs / function calls. Requires
//    {prefix}_supabase_url + {prefix}_service_role_key.
//  - "external API only": app talks to a third-party REST API via Bearer /
//    API Key / OAuth2. No remote Supabase. The credential lives in
//    Credential Vault by app_id link. vault_secrets[] should be empty.
//
// Discriminator: "remote Supabase" iff the proxy ever queries a remote DB,
// signalled by non-empty allowed_tables / allowed_rpcs / forward_to_functions.
// An app with BOTH api_config AND allowed_tables matches "remote Supabase"
// (uses an external HTTP API for some calls but also queries a remote DB).
// An app with api_config and empty allowed_tables/rpcs and forward_to_functions=false
// matches "external API only".

if (proxy) {
  const usesRemoteSupabase =
    (proxy.allowed_tables?.length ?? 0) > 0 ||
    (proxy.allowed_rpcs?.length ?? 0) > 0 ||
    proxy.forward_to_functions === true

  const vaultKeys = new Set((manifest?.vault_secrets ?? []).map(v => v.key))
  const dangerousKeys = [...vaultKeys].filter(k => /_service_role_key$/.test(k))

  if (usesRemoteSupabase && proxy.vault_prefix) {
    // Remote-Supabase pattern: warn if expected vault secrets aren't declared.
    const expected = [`${proxy.vault_prefix}_supabase_url`, `${proxy.vault_prefix}_service_role_key`]
    for (const key of expected) {
      if (!vaultKeys.has(key)) {
        add({
          level: 'warn',
          code: 'VAULT_SECRET_MISSING',
          message: `proxy.vault_prefix="${proxy.vault_prefix}" + remote-Supabase usage (allowed_tables/allowed_rpcs/forward_to_functions) implies vault secret "${key}" but it is not in vault_secrets[]`,
          fix: `Add { "key": "${key}", "description": "..." } to vault_secrets[] in app.manifest.json so admins know to provision it.`,
          file: rel(MANIFEST_PATH),
        })
      }
    }
  } else if (!usesRemoteSupabase && dangerousKeys.length > 0) {
    // External-API-only pattern with service_role_key entries: hard reject.
    add({
      level: 'error',
      code: 'SERVICE_ROLE_KEY_FORBIDDEN',
      message: `vault_secrets[] declares ${dangerousKeys.join(', ')} but this proxy app does not use a remote Supabase project (allowed_tables=[], allowed_rpcs=[], forward_to_functions=false). Service role keys are admin-only and must never be exposed to clients via the Vault Secrets admin page.`,
      fix: `Remove the *_service_role_key entries from vault_secrets[]. The vendor API credential lives in Credential Vault via credential_requirements[] (looked up by app_id at runtime) — vault_secrets[] is unused for external-API-only proxy apps.`,
      file: rel(MANIFEST_PATH),
    })
  }

  // External-API-only with api_config.type='bearer_token': vault_secrets[] entries
  // are unused at runtime (app-proxy reads the credential from Credential Vault by
  // app_id link). Declaring them surfaces "Needs admin input" rows on the Vault
  // Secrets admin page that the admin would never need to fill in. Warn — don't
  // error — to avoid breaking apps built before this guidance landed.
  // OAuth2 client_credentials still legitimately uses vault_secrets[] for
  // {prefix}_client_id / _client_secret / _token_url, so skip the warning when
  // type='oauth2_client_credentials'.
  if (!usesRemoteSupabase && proxy.api_config?.type === 'bearer_token') {
    const settingKey = proxy.tenant_isolation?.setting_key
    const redundantKeys = [...vaultKeys].filter(k => k !== settingKey)
    if (redundantKeys.length > 0) {
      add({
        level: 'warn',
        code: 'VAULT_SECRETS_REDUNDANT',
        message: `vault_secrets[] declares ${redundantKeys.join(', ')} but api_config.type='bearer_token' reads the credential from Credential Vault (linked by app_id) — the vault_secrets entries are unused at runtime.`,
        fix: `Remove these entries from vault_secrets[]. The Bearer/API Key credential lives in Credential Vault and is provisioned via credential_requirements[]. Vault Secrets entries are only needed for OAuth2 Client Credentials (type='oauth2_client_credentials') or own-Supabase apps (vault_prefix flow with allowed_tables/allowed_rpcs).`,
        file: rel(MANIFEST_PATH),
      })
    }
  }

  const settingKey = proxy.tenant_isolation?.setting_key
  if (settingKey && !vaultKeys.has(settingKey)) {
    add({
      level: 'warn',
      code: 'TENANT_SETTING_MISSING',
      message: `tenant_isolation.setting_key="${settingKey}" but not in vault_secrets[]`,
      fix: `Add { "key": "${settingKey}", "description": "Tenant ID for row-level filtering" } to vault_secrets[]`,
      file: rel(MANIFEST_PATH),
    })
  }
}

// ── Check: schema-mode migrations exist on disk ──────────────────────────────

if (manifest?.database?.mode === 'schema') {
  for (const mig of manifest.database.migrations ?? []) {
    const path = join(ROOT, mig.up)
    if (!existsSync(path)) {
      add({
        level: 'error',
        code: 'MIGRATION_MISSING',
        message: `Manifest references migration "${mig.up}" (version ${mig.version}) but file does not exist`,
        fix: `Create ${mig.up} with the SQL for this migration, or remove the entry from database.migrations[]`,
        file: rel(MANIFEST_PATH),
      })
    }
  }
  if (manifest.database.schema && !/^app_[a-z0-9_]+$/.test(manifest.database.schema)) {
    add({
      level: 'error',
      code: 'SCHEMA_BAD_NAME',
      message: `database.schema="${manifest.database.schema}" must start with "app_" (enforced by Postgres event trigger)`,
      fix: `Rename schema to app_${manifest.database.schema.replace(/^app_/, '')}`,
      file: rel(MANIFEST_PATH),
    })
  }
}

// ── Check: package.json peer deps + no bundled runtime ──────────────────────

if (pkg) {
  const peerDeps = (pkg.peerDependencies as Record<string, string>) ?? {}
  if (!peerDeps['@elasticit-llc/app-bridge']) {
    add({
      level: 'error',
      code: 'PKG_NO_BRIDGE_PEER',
      message: 'package.json peerDependencies missing "@elasticit-llc/app-bridge"',
      fix: 'Add "@elasticit-llc/app-bridge": ">=0.7.0" to peerDependencies (NOT dependencies — bundling it breaks hook identity)',
      file: rel(PKG_PATH),
    })
  }
  if (!peerDeps.react) {
    add({
      level: 'error',
      code: 'PKG_NO_REACT_PEER',
      message: 'package.json peerDependencies missing "react"',
      fix: 'Add "react": "^19.0.0" to peerDependencies (NOT dependencies)',
      file: rel(PKG_PATH),
    })
  }

  // react/react-dom should NOT be in dependencies (only peerDeps + devDeps)
  const deps = (pkg.dependencies as Record<string, string>) ?? {}
  if (deps.react || deps['react-dom'] || deps['@elasticit-llc/app-bridge']) {
    const bundled = ['react', 'react-dom', '@elasticit-llc/app-bridge'].filter(k => deps[k])
    add({
      level: 'error',
      code: 'PKG_BUNDLED_PEER',
      message: `package.json "dependencies" includes ${bundled.join(', ')} — these must be peerDependencies only`,
      fix: `Move ${bundled.join(', ')} from dependencies to peerDependencies. Bundling them breaks React hook identity at runtime.`,
      file: rel(PKG_PATH),
    })
  }
}

// ── Check: vite config externals ─────────────────────────────────────────────

if (viteConfig) {
  const required = ['react', 'react-dom', 'react/jsx-runtime', '@elasticit-llc/app-bridge']
  for (const name of required) {
    const safe = name.replace(/[/.]/g, '\\$&')
    const re = new RegExp(`['"\`]${safe}['"\`]`)
    if (!re.test(viteConfig)) {
      add({
        level: 'error',
        code: 'VITE_MISSING_EXTERNAL',
        message: `vite.config.ts rollupOptions.external does not include "${name}"`,
        fix: `Add "${name}" to rollupOptions.external. Required shape: external: ['react', 'react-dom', 'react/jsx-runtime', '@elasticit-llc/app-bridge']`,
        file: rel(VITE_CONFIG_PATH),
      })
    }
  }
}

// ── Check: CSS utilities-only rule ───────────────────────────────────────────

if (appCss) {
  const hasFullImport = /@import\s+["']tailwindcss["']/.test(appCss)
  const hasUtilities = /@import\s+["']tailwindcss\/utilities["']/.test(appCss)
  if (hasFullImport && !hasUtilities) {
    const idx = appCss.search(/@import\s+["']tailwindcss["']/)
    add({
      level: 'error',
      code: 'CSS_FULL_TAILWIND_IMPORT',
      message: '@import "tailwindcss" bundles a full CSS reset + theme that overrides the shell\'s brand colors at runtime',
      fix: 'Replace `@import "tailwindcss"` with `@import "tailwindcss/utilities"` in src/app.css',
      file: rel(APP_CSS_PATH),
      line: idx >= 0 ? lineOf(appCss, idx) : undefined,
    })
  } else if (!hasUtilities) {
    add({
      level: 'warn',
      code: 'CSS_NO_TAILWIND',
      message: 'src/app.css does not import tailwindcss/utilities',
      fix: 'Add `@import "tailwindcss/utilities";` to the top of src/app.css',
      file: rel(APP_CSS_PATH),
    })
  }
}

// ── Check: TypeScript-only in src/ and scripts/ ──────────────────────────────

// Allowlist: any file in src/ or scripts/ with an extension NOT in this set is flagged.
// This catches .js/.jsx/.mjs/.cjs (JavaScript) AND any other language (.py/.rb/.go/.rs/etc.)
// in one rule. Extensionless files are skipped (README, LICENSE, Dockerfile don't need type checks).
const ALLOWED_SRC_EXTS = new Set([
  '.ts', '.tsx',                                      // TypeScript source
  '.css',                                             // Stylesheets
  '.json',                                            // Static data / config
  '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', // Images
  '.woff', '.woff2', '.ttf', '.otf', '.eot',          // Fonts
  '.md', '.txt',                                      // Occasional inline docs
])

const JS_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs'])

// Paths (relative to repo root) that are exempt from the TypeScript-only rule.
// - `src/shims/`: CJS→ESM Vite aliases (e.g. use-sync-external-store). Must stay .js
//   for the alias resolution chain to work.
// - `scripts/scaffold.sh`: bash script invoked before `npm install` to scaffold a new
//   app folder. Can't be TypeScript since tsx isn't available pre-install.
const TS_RULE_EXEMPT_PATHS = ['src/shims/', 'scripts/scaffold.sh']

function isExemptPath(absPath: string): boolean {
  const relPath = rel(absPath)
  return TS_RULE_EXEMPT_PATHS.some(p => relPath.startsWith(p))
}

function findDisallowedFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...findDisallowedFiles(full))
      continue
    }
    if (isExemptPath(full)) continue
    // .d.ts is valid (declaration file) — TypeScript source
    if (entry.endsWith('.d.ts')) continue
    const dotIdx = entry.lastIndexOf('.')
    if (dotIdx === -1) continue // extensionless file — not a source/asset concern
    const ext = entry.slice(dotIdx).toLowerCase()
    if (!ALLOWED_SRC_EXTS.has(ext)) out.push(full)
  }
  return out
}

for (const dir of [SRC_DIR, join(ROOT, 'scripts')]) {
  for (const file of findDisallowedFiles(dir)) {
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
    const isJs = JS_EXTS.has(ext)
    const tsEquivalent = ext === '.jsx' ? '.tsx' : '.ts'
    const fix = isJs
      ? `Rename to ${rel(file).slice(0, -ext.length)}${tsEquivalent} and add type annotations. This template is TypeScript-only — no JavaScript in src/ or scripts/.`
      : `Remove ${rel(file)} or move it outside src/ and scripts/. Source code must be TypeScript (${[...ALLOWED_SRC_EXTS].sort().join(' ')} are the allowed extensions in these directories).`
    add({
      level: 'error',
      code: 'NON_TYPESCRIPT_SOURCE',
      message: `${rel(file)} uses "${ext}" — not an allowed source/asset extension for this template`,
      fix,
      file: rel(file),
    })
  }
}

// ── Check: dual export (App + setup) in src/index.ts ────────────────────────

if (indexTs) {
  const hasAppExport = /export\s+\{[^}]*\bApp\b/.test(indexTs) || /export\s+default\s+App/.test(indexTs)
  const hasSetupExport = /export\s+(const|function)\s+setup\b/.test(indexTs) || /export\s+\{[^}]*\bsetup\b/.test(indexTs)
  if (!hasAppExport) {
    add({
      level: 'error',
      code: 'INDEX_NO_APP_EXPORT',
      message: 'src/index.ts does not export App (required — kept as fallback for older shell load paths)',
      fix: "Add `export { default as App } from './App'` to src/index.ts",
      file: rel(INDEX_TS_PATH),
    })
  }
  if (!hasSetupExport) {
    add({
      level: 'error',
      code: 'INDEX_NO_SETUP_EXPORT',
      message: 'src/index.ts does not export setup() (required for runtime loading by shell)',
      fix: "Add `export const setup = (api: AppAPI) => { api.registerPage('<key>', lazy(() => import('./pages/<Page>'))) }` to src/index.ts",
      file: rel(INDEX_TS_PATH),
    })
  }
}

// ── Check: forbidden imports + two-arg showToast ─────────────────────────────

for (const file of srcFiles) {
  const content = read(file)
  if (!content) continue

  // react-router-dom (shell controls navigation via currentPage)
  if (/from\s+['"]react-router-dom['"]/.test(content)) {
    const idx = content.search(/from\s+['"]react-router-dom['"]/)
    add({
      level: 'error',
      code: 'FORBIDDEN_ROUTER',
      message: `${rel(file)} imports react-router-dom — apps must use currentPage from useShellContext() instead`,
      fix: 'Remove the react-router-dom import and switch on `currentPage` from useShellContext() for page routing',
      file: rel(file),
      line: lineOf(content, idx),
    })
  }

  // Custom Supabase client (bypasses proxy + tenant isolation)
  if (/import\s+\{[^}]*\bcreateClient\b[^}]*\}\s+from\s+['"]@supabase\/supabase-js['"]/.test(content)) {
    const idx = content.search(/createClient/)
    add({
      level: 'error',
      code: 'FORBIDDEN_SUPABASE_CLIENT',
      message: `${rel(file)} imports createClient from @supabase/supabase-js — use useSupabase() or useProxyClient() from app-bridge instead`,
      fix: 'Remove the createClient import. For shell data use useSupabase(); for external data use useProxyClient("app-proxy", { app: "<slug>" })',
      file: rel(file),
      line: lineOf(content, idx),
    })
  }

  // Two-arg showToast
  {
    const re = /showToast\(\s*['"][^'"]+['"]\s*,\s*['"](?:success|error|info|warning)['"]\s*\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      add({
        level: 'error',
        code: 'SHOWTOAST_TWO_ARG',
        message: `showToast called with two positional arguments — this form silently no-ops`,
        fix: `Replace with object form: showToast({ message: '...', type: 'success' | 'error' | 'info' | 'warning' })`,
        file: rel(file),
        line: lineOf(content, m.index),
      })
    }
  }

  // timeout nested in body instead of top-level
  {
    const re = /\.api\(\s*['"][^'"]+['"]\s*,\s*\{[^}]*\bbody\s*:\s*\{[^}]*\btimeout\s*:/gs
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      add({
        level: 'warn',
        code: 'TIMEOUT_NESTED_IN_BODY',
        message: '.api() timeout appears to be nested inside body — the proxy will ignore it',
        fix: 'Move `timeout` to the top level of the options object, next to `method` and `body`: .api(ep, { method, body, timeout: 120000 })',
        file: rel(file),
        line: lineOf(content, m.index),
      })
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

// In strict mode, promote specific warning codes to errors so the packager
// won't produce a .eitapp with template-default slug/name/icon still in place.
if (STRICT) {
  for (const issue of issues) {
    if (issue.level === 'warn' && STRICT_PROMOTE_CODES.has(issue.code)) {
      issue.level = 'error'
    }
  }
}

const errors = issues.filter(i => i.level === 'error')
const warnings = issues.filter(i => i.level === 'warn')

if (issues.length === 0) {
  const modeLabel = STRICT ? ' (strict mode)' : ''
  console.log(`\x1b[32m✓\x1b[0m app-template validator: no issues found${modeLabel}`)
  process.exit(0)
}

console.log('')
console.log(`\x1b[1mApp template validation\x1b[0m — ${errors.length} error(s), ${warnings.length} warning(s)`)
console.log('')

for (const issue of [...errors, ...warnings]) {
  const color = issue.level === 'error' ? '\x1b[31m✗' : '\x1b[33m⚠'
  const loc = issue.file ? ` ${issue.file}${issue.line ? `:${issue.line}` : ''}` : ''
  console.log(`${color} [${issue.code}]\x1b[0m${loc}`)
  console.log(`    ${issue.message}`)
  console.log(`    \x1b[36mfix:\x1b[0m ${issue.fix}`)
  console.log('')
}

if (errors.length > 0) {
  console.log(`\x1b[31m${errors.length} error(s) must be fixed before publishing.\x1b[0m`)
  console.log('')
  process.exit(1)
}

console.log(`\x1b[33m${warnings.length} warning(s) — review before publishing.\x1b[0m`)
console.log('')
process.exit(0)
