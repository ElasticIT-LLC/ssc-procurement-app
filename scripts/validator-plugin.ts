import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Vite plugin that runs scripts/validate.ts at build start.
 *
 * Why: `prebuild` runs the validator when invoked via `npm run build`, but a
 * developer could bypass that by running `npx vite build` directly. This plugin
 * closes that gap — it runs the validator on EVERY vite build invocation.
 *
 * Skipped during `vite dev` and `vite build --watch` because the PostToolUse
 * hook already covers live editing, and we don't want to slow rebuilds.
 *
 * The plugin shells out to the existing validator via subprocess, so there's
 * no coupling between the plugin and validate.ts — if the validator evolves,
 * the plugin gets the changes for free.
 */
export function validatorPlugin(): Plugin {
  let isWatchOrServe = false
  return {
    name: 'app-template-validator',
    configResolved(config) {
      isWatchOrServe = !!config.build.watch || config.command === 'serve'
    },
    buildStart() {
      if (isWatchOrServe) return
      const validatorPath = resolve(process.cwd(), 'scripts', 'validate.ts')
      const result = spawnSync('npx', ['--no-install', 'tsx', validatorPath], {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: process.platform === 'win32',
      })
      if (result.status !== 0) {
        this.error('App template validation failed — fix the errors above before building.')
      }
    },
  }
}
