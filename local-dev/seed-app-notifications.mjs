#!/usr/bin/env node
//
// Emits SQL that populates public.app_notifications for the dev's app, based
// on app.manifest.json's notifications[]. setup.sh pipes the output into the
// local Supabase's postgres container right after seed.sql.
//
// In production, publish-app upserts this catalog on every .eitapp upload.
// Local-dev never runs publish-app, so without this step the bundled portal's
// Notifications page would show only system + access events — the dev's own
// app events wouldn't appear. This script closes that gap.
//
// Re-runnable: clears existing rows for the app before inserting, so editing
// manifest.notifications[] and re-running setup.sh reflects the change.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(here, '..', 'app.manifest.json')

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (err) {
  console.error(`[seed-app-notifications] cannot read ${manifestPath}: ${err.message}`)
  process.exit(1)
}

const slug = manifest.slug
if (!slug || typeof slug !== 'string') {
  console.error('[seed-app-notifications] manifest.slug missing or not a string — nothing to seed')
  process.exit(0)
}

const notifs = Array.isArray(manifest.notifications) ? manifest.notifications : []

const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const out = [
  `-- Auto-generated from ../app.manifest.json by seed-app-notifications.mjs`,
  `DELETE FROM public.app_notifications WHERE app_slug = ${q(slug)};`,
]
for (const n of notifs) {
  if (!n || typeof n.key !== 'string' || typeof n.label !== 'string') continue
  out.push(
    `INSERT INTO public.app_notifications (app_slug, key, label, description, sort_order) VALUES (`
      + `${q(slug)}, ${q(n.key)}, ${q(n.label)}, `
      + `${typeof n.description === 'string' ? q(n.description) : 'NULL'}, `
      + `${Number.isInteger(n.sort_order) ? n.sort_order : 0});`,
  )
}

process.stdout.write(out.join('\n') + '\n')
