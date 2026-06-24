import { type Plugin, type ResolvedConfig } from 'vite'
import { resolve } from 'path'
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'

/**
 * Vite plugin that enables runtime-loaded apps to share dependencies with the shell.
 *
 * How it works:
 * 1. During build, marks shared deps (react, react-dom, app-bridge) as separate chunks
 * 2. After build, creates ESM wrapper files in dist/shared/ that re-export from the chunks
 * 3. Injects an <script type="importmap"> into index.html mapping bare specifiers to wrappers
 *
 * This allows dynamically imported app bundles (which externalize these deps) to resolve
 * them at runtime via the browser's native import map support.
 */

interface SharedDepsOptions {
  /** Dependencies to share. Defaults to react ecosystem + app-bridge. */
  deps?: string[]
}

const DEFAULT_SHARED_DEPS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@elasticit-llc/app-bridge',
]

export function sharedDeps(options: SharedDepsOptions = {}): Plugin {
  const deps = options.deps ?? DEFAULT_SHARED_DEPS
  let config: ResolvedConfig
  const chunkFileMap = new Map<string, string>() // dep name → output chunk filename

  return {
    name: 'elasticit-shared-deps',
    enforce: 'post',

    configResolved(resolvedConfig) {
      config = resolvedConfig
    },

    // Configure Vite/Rollup to put shared deps into separate named chunks
    config() {
      return {
        build: {
          rollupOptions: {
            output: {
              manualChunks(id: string) {
                // Sort by length descending so longer (more specific) paths match first.
                // Without this, 'react' matches 'react-dom' and 'react/jsx-runtime'
                // because node_modules/react is a prefix of both paths.
                const sorted = [...deps].sort((a, b) => b.length - a.length)
                for (const dep of sorted) {
                  const depPath = dep.replace(/\//g, '/')
                  const needle = `node_modules/${depPath}`
                  const idx = id.indexOf(needle)
                  if (idx === -1) continue
                  // Check that the match ends at a path boundary: '/', '.', or end of string.
                  // This prevents 'react' from matching 'react-dom' (next char would be '-').
                  const charAfter = id[idx + needle.length]
                  if (!charAfter || charAfter === '/' || charAfter === '.') {
                    const chunkName = 'shared-' + dep.replace(/\//g, '-').replace(/@/g, '').replace(/elasticit-llc-/g, '')
                    return chunkName
                  }
                }
              },
            },
          },
        },
      }
    },

    // After build, create globals-based wrapper files in dist/shared/.
    // These read from window.__ELASTICIT_* globals set by the shell's appLoader.ts,
    // guaranteeing runtime-loaded apps use the SAME React/app-bridge instances as
    // the shell. This avoids the dual-copy hooks crash that occurs when Rolldown
    // splits React core away from the shared chunk.
    closeBundle() {
      if (config.command === 'serve') return // Dev mode uses existing shim files

      const outDir = config.build.outDir || 'dist'
      const sharedDir = resolve(outDir, 'shared')

      if (!existsSync(sharedDir)) {
        mkdirSync(sharedDir, { recursive: true })
      }

      // React — re-export all named hooks + default from the global
      const reactWrapper = `const R = window.__ELASTICIT_REACT__;
if (!R) throw new Error('shared/react.js: shell has not initialized __ELASTICIT_REACT__');
export default R;
export const {
  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createFactory, createRef,
  forwardRef, isValidElement, lazy, memo, startTransition, use,
  useCallback, useContext, useDebugValue, useDeferredValue, useEffect,
  useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo,
  useOptimistic, useReducer, useRef, useState, useSyncExternalStore, useTransition,
  version
} = R;
`
      writeFileSync(resolve(sharedDir, 'react.js'), reactWrapper)
      chunkFileMap.set('react', '/shared/react.js')

      // react-dom — re-export from global
      const reactDomWrapper = `const R = window.__ELASTICIT_REACT_DOM__;
if (!R) throw new Error('shared/react-dom.js: shell has not initialized __ELASTICIT_REACT_DOM__');
export default R;
export const { createPortal, flushSync, hydrate, render, unmountComponentAtNode, unstable_batchedUpdates, version } = R;
`
      writeFileSync(resolve(sharedDir, 'react-dom.js'), reactDomWrapper)
      chunkFileMap.set('react-dom', '/shared/react-dom.js')

      // react/jsx-runtime — re-export from global
      const jsxWrapper = `const J = window.__ELASTICIT_JSX_RUNTIME__;
if (!J) throw new Error('shared/react-jsx-runtime.js: shell has not initialized __ELASTICIT_JSX_RUNTIME__');
export default J;
export const { jsx, jsxs, Fragment } = J;
`
      writeFileSync(resolve(sharedDir, 'react-jsx-runtime.js'), jsxWrapper)
      chunkFileMap.set('react/jsx-runtime', '/shared/react-jsx-runtime.js')

      // @elasticit-llc/app-bridge — re-export from global
      const bridgeWrapper = `const B = window.__ELASTICIT_APP_BRIDGE__;
if (!B) throw new Error('shared/app-bridge.js: shell has not initialized __ELASTICIT_APP_BRIDGE__');
export default B;
export const {
  ShellBridgeContext, useShellContext, useAuth, useSupabase, useTheme, useToast,
  usePermissions, useCredentials, useProxyClient, useEventBus, useSharedData,
  useExtensionSlot, ExtensionSlot, registerExtension, clearExtensions, getExtensions,
  emit, on, off
} = B;
`
      writeFileSync(resolve(sharedDir, 'app-bridge.js'), bridgeWrapper)
      chunkFileMap.set('@elasticit-llc/app-bridge', '/shared/app-bridge.js')
    },

    // Inject the import map into index.html
    transformIndexHtml(html) {
      const imports: Record<string, string> = {}

      if (config.command === 'serve') {
        // Dev mode: point to Vite's pre-bundled deps
        // These are served by Vite's dev server at /node_modules/.vite/deps/
        const devImports: Record<string, string> = {
          'react': '/shared/react-shim.js',
          'react-dom': '/shared/react-dom-shim.js',
          'react/jsx-runtime': '/shared/jsx-runtime-shim.js',
          '@elasticit-llc/app-bridge': '/shared/app-bridge-shim.js',
        }
        for (const dep of deps) {
          if (devImports[dep]) imports[dep] = devImports[dep]
        }
      } else {
        // Production: use built chunks
        for (const dep of deps) {
          const path = chunkFileMap.get(dep)
          if (path) {
            imports[dep] = path
          }
        }

        // If no chunks were found yet (first pass), use placeholder paths
        if (Object.keys(imports).length === 0) {
          for (const dep of deps) {
            const name = dep.replace(/\//g, '-').replace(/@/g, '').replace(/elasticit-llc-/g, '')
            imports[dep] = `/shared/${name}.js`
          }
        }
      }

      const importMap = JSON.stringify({ imports }, null, 2)
      const scriptTag = `<script type="importmap">\n${importMap}\n</script>`

      // Insert before the first <script> tag
      return html.replace('<script', `${scriptTag}\n    <script`)
    },
  }
}
