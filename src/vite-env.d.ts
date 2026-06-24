// Type declarations for static asset imports.
// TypeScript 6 (TS2882) requires module declarations even for side-effect
// imports of non-TS files. These cover CSS, images, and other Vite-handled
// assets so the type checker doesn't complain about `import './app.css'`.
//
// Must live inside src/ — tsconfig.build.json's include is ["src"] only,
// so files in types/ are invisible at build time.

declare module '*.css'
declare module '*.scss'
declare module '*.sass'
declare module '*.svg' {
  const content: string
  export default content
}
declare module '*.png' {
  const content: string
  export default content
}
declare module '*.jpg' {
  const content: string
  export default content
}
declare module '*.jpeg' {
  const content: string
  export default content
}
declare module '*.webp' {
  const content: string
  export default content
}
