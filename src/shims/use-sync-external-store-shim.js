// ESM shim — React 19 exports useSyncExternalStore natively.
// Avoids bundling the CJS-only use-sync-external-store package,
// which causes require('react') calls that break in the browser.
export { useSyncExternalStore } from 'react'
