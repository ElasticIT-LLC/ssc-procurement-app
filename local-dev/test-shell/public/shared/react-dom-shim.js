// Dev-mode shim: exposes react-dom named exports via the shell's global.
// Same globals-based pattern as react-shim.js / production build.
const R = window.__ELASTICIT_REACT_DOM__
if (!R) {
  throw new Error(
    'shared/react-dom-shim.js: window.__ELASTICIT_REACT_DOM__ not set.',
  )
}
export default R
export const {
  createPortal, flushSync, hydrate, render, unmountComponentAtNode,
  unstable_batchedUpdates, version,
} = R
