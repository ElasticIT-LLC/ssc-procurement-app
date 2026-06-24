#!/usr/bin/env tsx
/**
 * Package app artifacts into a single .eitapp ZIP for upload via Admin UI.
 *
 * Usage:
 *   npm run package
 *   # or directly:
 *   npx tsx scripts/package.ts
 *
 * What it does:
 * 1. Reads app.manifest.json (or package.json) for slug + version
 * 2. Validates that dist/index.js exists (build must run first)
 * 3. Checks dist/index.css for CSS safety (warns if :root declarations found)
 * 4. Creates a ZIP (.eitapp) containing: index.js, index.css, app.manifest.json, migrations/
 * 5. Writes to dist/{slug}-{version}.eitapp
 */

import { createWriteStream, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { ZipArchive } from 'archiver'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const root = resolve(__dirname, '..')

// --- 0. Soft nudge: did the developer ever spin up local-dev? ---
//
// Heuristic: presence of local-dev/test-shell/node_modules signals that
// `npm run local-dev` (or at least its first install step) has run on this
// machine. Missing → developer is shipping without ever previewing.
// We warn and pause briefly — never block — so experienced devs can iterate
// fast on hotfixes / quick repackages without friction.
const localDevMarker = resolve(root, 'local-dev/test-shell/node_modules')
if (!existsSync(localDevMarker)) {
  console.warn('')
  console.warn('⚠  local-dev has never been set up on this machine.')
  console.warn('   Strongly recommend running `npm run local-dev` to verify your app')
  console.warn('   renders before publishing. See local-dev/README.md.')
  console.warn('   Continuing in 3 seconds...')
  console.warn('')
  await new Promise((r) => setTimeout(r, 3000))
}

// --- 1. Read metadata ---

interface AppMeta {
  slug: string
  version: string
  name: string
  icon: string
}

/** Check if a string contains at least one emoji character */
// Lucide icon names from the shell's AppIcon registry (shell v0.11.4+). If the
// manifest's `icon` is one of these, it's an intentional PascalCase Lucide name
// — do NOT try to resolve it to an emoji. Keep in sync with
// elasticit-shell/src/components/AppIcon.tsx.
const LUCIDE_REGISTRY = new Set([
  'Printer', 'ShieldCheck', 'BookOpen', 'Calculator', 'Calendar', 'Clock',
  'Puzzle', 'Package', 'Database', 'Briefcase', 'Settings', 'Activity',
  'CreditCard', 'Users', 'FileText', 'BarChart3', 'Mail', 'FolderOpen',
  'Building2', 'Wrench',
])

function isEmoji(str: string): boolean {
  // Matches most emoji: emoticons, symbols, flags, skin tones, etc.
  return /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(str)
}

// Common emoji text names → emoji character.
// Windows terminals and apps like Teams paste emojis as their Unicode CLDR
// short name (e.g., "Spiral calendar" instead of 🗓️). This table converts
// the most common app icon names back to the actual emoji.
// Keys are normalized: lowercase, spaces and underscores stripped.
const EMOJI_NAME_TO_CHAR: Record<string, string> = {
  'calendar': '📅', 'spiralcalendar': '🗓️', 'tearoffcalendar': '📆', 'clock': '🕐', 'alarmclock': '⏰', 'hourglass': '⌛', 'stopwatch': '⏱️',
  'package': '📦', 'inbox': '📥', 'outbox': '📤', 'envelope': '✉️', 'memo': '📝', 'pencil': '✏️', 'paperclip': '📎', 'pushpin': '📌',
  'clipboard': '📋', 'spiralnotepad': '🗒️', 'bookmark': '🔖', 'label': '🏷️', 'folder': '📁', 'openfolder': '📂', 'cardindex': '📇', 'filecabinet': '🗄️',
  'wastebasket': '🗑️', 'scroll': '📜', 'pageoverview': '📄', 'pagewithcurl': '📃', 'newspaper': '📰', 'book': '📖', 'closedbook': '📕',
  'greenbook': '📗', 'bluebook': '📘', 'orangebook': '📙', 'books': '📚', 'notebook': '📓', 'ledger': '📒',
  'gear': '⚙️', 'wrench': '🔧', 'hammer': '🔨', 'hammerandwrench': '🛠️', 'toolbox': '🧰', 'screwdriver': '🪛', 'lock': '🔒', 'unlock': '🔓',
  'key': '🔑', 'oldkey': '🗝️', 'shield': '🛡️', 'magnifyingglassleft': '🔍', 'magnifyingglassright': '🔎',
  'moneybag': '💰', 'creditcard': '💳', 'banknote': '💵', 'chart': '📈', 'chartdecreasing': '📉', 'barchart': '📊', 'briefcase': '💼',
  'bank': '🏦', 'office': '🏢', 'departmentstore': '🏬', 'receipt': '🧾', 'abacus': '🧮',
  'computer': '💻', 'desktopcomputer': '🖥️', 'printer': '🖨️', 'keyboard': '⌨️', 'mobilephone': '📱', 'telephone': '☎️',
  'satellite': '📡', 'rocket': '🚀', 'electricplug': '🔌', 'battery': '🔋', 'bulb': '💡', 'flashlight': '🔦',
  'floppydisk': '💾', 'opticaldisk': '💿', 'dvd': '📀',
  'person': '👤', 'people': '👥', 'busts': '👥', 'doctor': '🧑‍⚕️', 'pill': '💊', 'syringe': '💉', 'stethoscope': '🩺',
  'thermometer': '🌡️', 'hospital': '🏥', 'firstaidkit': '🩹',
  'speechballoon': '💬', 'thoughtballoon': '💭', 'bell': '🔔', 'megaphone': '📢', 'loudspeaker': '📣', 'mailbox': '📫',
  'star': '⭐', 'sparkles': '✨', 'fire': '🔥', 'rainbow': '🌈', 'globe': '🌐', 'globewithmeridians': '🌐',
  'pin': '📍', 'roundpushpin': '📍', 'compass': '🧭', 'map': '🗺️', 'puzzle': '🧩', 'gameplaycontroller': '🎮',
  'checkmark': '✅', 'crossmark': '❌', 'warning': '⚠️', 'noentry': '⛔', 'redcircle': '🔴', 'greencircle': '🟢',
}

function tryResolveEmoji(input: string): string | null {
  const key = input.toLowerCase().replace(/[\s_-]/g, '')
  return EMOJI_NAME_TO_CHAR[key] ?? null
}

function readMeta(): AppMeta {
  // Priority: app.manifest.json > permissions.json > package.json
  const manifestPath = join(root, 'app.manifest.json')
  const permsPath = join(root, 'permissions.json')
  const pkgPath = join(root, 'package.json')

  let slug = ''
  let version = '0.1.0'
  let name = ''
  let icon = ''

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    slug = manifest.slug || ''
    version = manifest.version || version
    name = manifest.name || ''
    icon = manifest.icon || ''
  }

  if (!slug && existsSync(permsPath)) {
    const perms = JSON.parse(readFileSync(permsPath, 'utf-8'))
    slug = perms.slug || ''
    name = name || perms.name || ''
  }

  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    if (!slug) {
      // Extract slug from package name: @scope/my-app → my-app, strip -app suffix
      const pkgName = pkg.name || ''
      slug = pkgName.replace(/^@[^/]+\//, '').replace(/-app$/, '')
    }
    version = version || pkg.version || '0.1.0'
    name = name || slug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  }

  if (!slug) {
    console.error('ERROR: Could not determine app slug. Ensure app.manifest.json has a "slug" field.')
    process.exit(1)
  }

  // Lucide PascalCase names are intentional — do NOT convert them to emoji.
  // Under shell v0.11.4+ the AppIcon component renders registry names as Lucide
  // icons and falls through to raw text for anything else (including emojis).
  // Keep registry names as-is; only try emoji resolution for non-registry,
  // non-emoji strings (e.g. "Spiral calendar" pasted from Windows emoji picker).
  if (icon && !isEmoji(icon) && !LUCIDE_REGISTRY.has(icon)) {
    const resolved = tryResolveEmoji(icon)
    if (resolved) {
      console.log(`Auto-fixing icon: "${icon}" → "${resolved}" (updating app.manifest.json)`)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      manifest.icon = resolved
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
      // Also update permissions.json if it exists and has an icon field
      if (existsSync(permsPath)) {
        const perms = JSON.parse(readFileSync(permsPath, 'utf-8'))
        if (perms.icon === icon) {
          perms.icon = resolved
          writeFileSync(permsPath, JSON.stringify(perms, null, 2) + '\n')
        }
      }
      icon = resolved
    } else {
      console.warn(
        `WARNING: Icon "${icon}" in app.manifest.json is not a recognized Lucide name or emoji.\n` +
        `  Preferred: use a Lucide PascalCase name from the shell's registry\n` +
        `  (${[...LUCIDE_REGISTRY].sort().join(', ')}).\n` +
        `  Emoji values also render via shell compat but are legacy — Lucide is the new default.\n`
      )
    }
  }

  return { slug, version, name, icon }
}

// --- 2. Validate build output ---

function validateBuild(): void {
  const jsPath = join(root, 'dist', 'index.js')
  if (!existsSync(jsPath)) {
    console.error('ERROR: dist/index.js not found. Run "npm run build" first.')
    process.exit(1)
  }
}

// --- 3. CSS safety check ---

function checkCssSafety(): void {
  const cssPath = join(root, 'dist', 'index.css')
  if (!existsSync(cssPath)) return

  const css = readFileSync(cssPath, 'utf-8')

  // Check for :root declarations that could override shell brand colors
  if (/^:root\s*\{/m.test(css)) {
    console.warn(
      'WARNING: dist/index.css contains :root declarations.\n' +
      '  This likely means src/app.css uses `@import "tailwindcss"` instead of\n' +
      '  `@import "tailwindcss/utilities"`, or `@theme` instead of `@theme reference`.\n' +
      '  The shell\'s brand colors may be overridden by your app.\n'
    )
  }

  // Also check source CSS if available
  const srcCssPath = join(root, 'src', 'app.css')
  if (existsSync(srcCssPath)) {
    const srcCss = readFileSync(srcCssPath, 'utf-8')
    // Match @import "tailwindcss" but NOT @import "tailwindcss/utilities" or similar sub-paths
    if (/^@import\s+["']tailwindcss["']\s*;/m.test(srcCss)) {
      console.warn(
        'WARNING: src/app.css uses `@import "tailwindcss"` (full import).\n' +
        '  Use `@import "tailwindcss/utilities"` instead to avoid overriding the shell\'s theme.\n'
      )
    }
    if (/^@theme\s*\{/m.test(srcCss) && !/^@theme\s+reference\s*\{/m.test(srcCss)) {
      console.warn(
        'WARNING: src/app.css uses `@theme { ... }` without the `reference` keyword.\n' +
        '  Use `@theme reference { ... }` to generate utility classes without emitting :root variables.\n'
      )
    }
  }
}

// --- 4. Create .eitapp ZIP ---

async function createPackage(meta: AppMeta): Promise<void> {
  const outputName = `${meta.slug}-${meta.version}.eitapp`
  const outputPath = join(root, 'dist', outputName)

  const output = createWriteStream(outputPath)
  const archive = new ZipArchive({ zlib: { level: 9 } })

  const files: string[] = []

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      const sizeKb = (archive.pointer() / 1024).toFixed(1)
      console.log(`\nPackage created: dist/${outputName} (${sizeKb} KB)`)
      console.log('Contents:')
      for (const f of files) {
        console.log(`  ${f}`)
      }
      console.log(`\nUpload this file via Admin > App Management > Publish App`)
      resolve()
    })

    archive.on('error', reject)
    archive.pipe(output)

    // Add JS bundle (required)
    const jsPath = join(root, 'dist', 'index.js')
    archive.file(jsPath, { name: 'index.js' })
    files.push('index.js')

    // Add CSS (optional)
    const cssPath = join(root, 'dist', 'index.css')
    if (existsSync(cssPath)) {
      archive.file(cssPath, { name: 'index.css' })
      files.push('index.css')
    }

    // Add app.manifest.json (required for new apps).
    // This is the unified source of truth for slug, name, icon, permissions,
    // pages, and database config. Do NOT also ship permissions.json — when
    // both are present, publish-app prefers permissions.json and overrides
    // the manifest's slug/icon/pages, which silently breaks the upload.
    const manifestPath = join(root, 'app.manifest.json')
    if (existsSync(manifestPath)) {
      archive.file(manifestPath, { name: 'app.manifest.json' })
      files.push('app.manifest.json')
    }

    // Add migrations (optional, for schema-mode apps).
    // Filenames must start with an optional 'v' followed by digits so the
    // shell's upload code can extract the version number. Recognized:
    // 1.sql, 001.sql, v1.sql, v01.sql, 1_initial.sql, 001_initial.sql,
    // v1_initial.sql.
    const migrationsDir = join(root, 'migrations')
    if (existsSync(migrationsDir) && statSync(migrationsDir).isDirectory()) {
      const sqlFiles = readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort()
      const seenVersions = new Set<number>()
      for (const sqlFile of sqlFiles) {
        const match = sqlFile.match(/^v?(\d+)/i)
        if (!match?.[1]) {
          console.warn(
            `WARNING: migration "${sqlFile}" has no recognized version prefix.\n` +
            `  Rename it to start with a version number: v1.sql, 001_initial.sql, etc.\n` +
            `  This file will be SKIPPED by the shell during upload.\n`
          )
          continue
        }
        const ver = parseInt(match[1], 10)
        if (seenVersions.has(ver)) {
          console.warn(
            `WARNING: migration "${sqlFile}" duplicates version ${ver} from another file.\n` +
            `  The shell will only apply ONE file per version. Rename or merge.\n`
          )
          continue
        }
        seenVersions.add(ver)
        archive.file(join(migrationsDir, sqlFile), { name: `migrations/${sqlFile}` })
        files.push(`migrations/${sqlFile}`)
      }
    }

    archive.finalize()
  })
}

// --- Strict validator pass (pre-publish gate) ---

import { spawnSync } from 'child_process'

function runStrictValidator(): void {
  const validatorPath = join(root, 'scripts', 'validate.ts')
  if (!existsSync(validatorPath)) {
    // No validator present — skip silently. Happens in extremely minimal template forks.
    return
  }
  const result = spawnSync('npx', ['--no-install', 'tsx', validatorPath, '--strict'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    console.error('\nPackaging aborted — validator (strict mode) reported errors above.')
    console.error('Fix the errors above. Template-default slug/name/icon are blocked in strict mode so unconfigured scaffolds can\'t produce a shippable .eitapp.')
    process.exit(1)
  }
}

// --- Main ---

async function main() {
  console.log('Packaging app for portal upload...\n')

  const meta = readMeta()
  console.log(`App: ${meta.name} (${meta.slug}) v${meta.version}\n`)

  runStrictValidator()
  validateBuild()
  checkCssSafety()
  await createPackage(meta)
}

main().catch(err => {
  console.error('Package failed:', err)
  process.exit(1)
})
