import { lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import { ShellProvider, ShellLayout, NativeAppHost, ProtectedRoute, AuthCallback } from '@elasticit-llc/shell'
import type { NativeAppRegistry } from '@elasticit-llc/shell'
import { useShell } from '@elasticit-llc/shell/hooks'
import { AdminRoutes } from '@elasticit-llc/shell/admin'
import { config } from './config'
import { LocalLoginPage } from './LocalLoginPage'

// Compile-time mode: import the local app directly from ../../dist.
// The slug here MUST match `app.manifest.json` "slug" so useAppSync
// in the shell finds the row seeded by local-dev/seed.sql instead of
// inserting a duplicate placeholder. When you scaffold a real app from
// this template, the scaffolder updates both files together.
//
// Comment out this line and upload via Admin UI to test runtime mode instead.
const appRegistry: NativeAppRegistry = {
  'my-app': lazy(() => import('@local-app/index.js').then(m => ({ default: m.App }))),
}

function WelcomePage() {
  const { config: shellConfig } = useShell()
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-foreground mb-2">Welcome to {shellConfig.clientName}</h1>
      <p className="text-muted-foreground">Select an app from the sidebar to get started.</p>
      <div className="mt-6 p-4 bg-card rounded-lg border border-border text-sm text-muted-foreground space-y-2">
        <p><strong className="text-foreground">Compile-time mode:</strong> Your app is loaded directly from <code className="text-primary">../../dist</code>. Run <code className="text-primary">npm run dev</code> in the app directory for live rebuilds.</p>
        <p><strong className="text-foreground">Runtime mode:</strong> Comment out the <code className="text-primary">appRegistry</code> entry in <code className="text-primary">App.tsx</code>, then upload your <code className="text-primary">.eitapp</code> package via Admin &gt; App Management.</p>
      </div>
    </div>
  )
}

export function App() {
  return (
    <ShellProvider config={{ ...config, appRegistry }}>
      <Routes>
        <Route path="/login" element={<LocalLoginPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/*" element={
          <ProtectedRoute>
            <ShellLayout>
              <Routes>
                <Route path="/" element={<WelcomePage />} />
                <Route path="/admin/*" element={<AdminRoutes />} />
                <Route path="/apps/:appId/:page?" element={<NativeAppHost appRegistry={appRegistry} />} />
              </Routes>
            </ShellLayout>
          </ProtectedRoute>
        } />
      </Routes>
    </ShellProvider>
  )
}
