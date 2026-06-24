// Dev-mode shim: serves react/jsx-runtime via the global set by the shell.
// Same rationale as react-shim.js — avoids dual-instance React caused by
// Vite's versioned URLs for pre-bundled deps.
const J = window.__ELASTICIT_JSX_RUNTIME__
if (!J) {
  throw new Error(
    'shared/jsx-runtime-shim.js: window.__ELASTICIT_JSX_RUNTIME__ not set.',
  )
}
export default J
export const { jsx, jsxs, Fragment } = J
