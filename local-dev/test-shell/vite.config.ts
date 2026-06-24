import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { brandCompiler } from '@elasticit-llc/ui-kit/vite'
import { resolve } from 'path'
import { sharedDeps } from './vite-plugin-shared-deps'

export default defineConfig({
  plugins: [
    // brandCompiler reads ../brand.json (one level up — local-dev/brand.json,
    // populated by setup.sh from brand.json.example) and emits
    // src/generated-brand.css + src/generated-brand.ts each build.
    brandCompiler({ brandFile: '../brand.json' }),
    react(),
    tailwindcss(),
    // sharedDeps lets runtime-uploaded apps (.eitapp packages installed via
    // Admin → App Management) resolve bare specifiers like `react` and
    // `@elasticit-llc/app-bridge` at runtime through an import map. Without
    // it, dynamically imported app bundles fail with "App not installed"
    // because the browser can't resolve their bare specifier imports.
    // The plugin reads window.__ELASTICIT_*__ globals set by the shell's
    // appLoader so runtime apps share the SAME React instance as the shell
    // (avoiding the dual-React hooks crash).
    sharedDeps(),
  ],
  resolve: {
    alias: {
      // Resolve the local app's dist output for compile-time testing
      '@local-app': resolve(__dirname, '../../dist'),
    },
    // Match production client shells: 'development' conditions resolves
    // dual-export packages via their ESM entry, which avoids the
    // "require not defined" error vite 8 throws when a CJS-bundled dep
    // tries to require('react') at runtime.
    conditions: ['development'],
    // Prevent duplicate React/app-bridge instances between shell and app
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', '@elasticit-llc/app-bridge'],
  },
  optimizeDeps: {
    include: [
      '@elasticit-llc/app-bridge',
      '@elasticit-llc/app-bridge > react',
      '@elasticit-llc/app-bridge > react-dom',
      'react',
      'react-dom',
      'react/jsx-runtime',
    ],
  },
  server: {
    watch: {
      // Watch the app's dist directory for changes (vite build --watch)
      ignored: ['!**/dist/**'],
    },
  },
})
