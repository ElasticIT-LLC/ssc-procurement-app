import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import './index.css'
// Load the built app's compiled CSS so custom CSS classes (e.g. grid layouts
// defined in the app's app.css) are present in compile-time mode. The
// test-shell's Tailwind `@source` scan only regenerates Tailwind UTILITY
// classes from the app's dist JS — it does NOT pull custom classes out of
// the app's compiled stylesheet. Without this import, custom-class layouts
// silently fall back to block layout and look broken here even though they
// render correctly in production, where the shell injects the app's CSS.
// `@local-app` aliases to ../../dist (the built app).
import '@local-app/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
