// Dev-mode shim: exposes React named exports from the shell's global window.
// Production uses the same pattern (see dist/shared/react.js). Using globals
// instead of file URLs avoids the dual-instance problem where Vite pre-bundles
// at /node_modules/.vite/deps/react.js but the shell imports with a version
// hash (?v=XXX) — those are treated as different modules by the browser.
const R = window.__ELASTICIT_REACT__
if (!R) {
  throw new Error(
    'shared/react-shim.js: window.__ELASTICIT_REACT__ not set. ' +
    'The shell must assign it before the first runtime-app import.',
  )
}
export default R
export const {
  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createFactory, createRef,
  forwardRef, isValidElement, lazy, memo, startTransition, use,
  useCallback, useContext, useDebugValue, useDeferredValue, useEffect,
  useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo,
  useOptimistic, useReducer, useRef, useState, useSyncExternalStore, useTransition,
  version,
} = R
