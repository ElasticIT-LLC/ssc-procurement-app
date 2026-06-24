import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { validatorPlugin } from './scripts/validator-plugin'

export default defineConfig({
  plugins: [react(), tailwindcss(), validatorPlugin()],
  define: {
    // Replace process.env.NODE_ENV in CJS dependencies (e.g., Redux in recharts).
    // Vite 8/Rolldown doesn't auto-replace this in CJS code like Rollup did.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  resolve: {
    alias: [
      // use-sync-external-store ships CJS only. When Vite 8 / Rolldown bundles
      // it with externalized react, it emits require('react') shims that crash
      // in the browser. React 19 has useSyncExternalStore built-in, so we alias
      // to ESM shims. Order matters: longer/more-specific paths must come first.
      { find: 'use-sync-external-store/shim/with-selector', replacement: resolve(__dirname, 'src/shims/use-sync-external-store-with-selector.js') },
      { find: 'use-sync-external-store/with-selector.js', replacement: resolve(__dirname, 'src/shims/use-sync-external-store-with-selector.js') },
      { find: 'use-sync-external-store/with-selector', replacement: resolve(__dirname, 'src/shims/use-sync-external-store-with-selector.js') },
      { find: 'use-sync-external-store/shim', replacement: resolve(__dirname, 'src/shims/use-sync-external-store-shim.js') },
      { find: 'use-sync-external-store', replacement: resolve(__dirname, 'src/shims/use-sync-external-store-shim.js') },
    ],
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      // ESM only — the template is a private app bundle uploaded via .eitapp,
      // not an npm package. The shell's runtime loader imports ESM directly.
      formats: ['es'],
      fileName: 'index',
    },
    cssCodeSplit: false,
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', '@elasticit-llc/app-bridge'],
      output: {
        // Bundle all dynamic imports (lazy pages) into index.js.
        // Runtime-loaded apps are fetched from Supabase Storage via signed
        // URLs — separate chunks would require signing each chunk URL
        // individually, which the browser can't do for relative imports.
        inlineDynamicImports: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
})
