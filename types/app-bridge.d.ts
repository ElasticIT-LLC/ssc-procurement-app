/**
 * Vendored type declarations for @elasticit-llc/app-bridge v0.7.x
 *
 * Provides the TypeScript API contract so client apps compile without needing
 * access to the private @elasticit-llc/app-bridge package. At runtime, the shell
 * provides the actual implementation via import maps.
 *
 * Keep in sync with the app-bridge package when hooks or types change.
 */

declare module '@elasticit-llc/app-bridge' {
  import type { ComponentType, Context, ReactNode } from 'react'

  // ── Core Interfaces ──────────────────────────────────────────────

  export interface AppContext {
    user: BridgeUser | null
    theme: BridgeTheme
    token: string | null
    supabase: any
    showToast: (toast: { message: string; type: 'success' | 'error' | 'info' | 'warning' }) => void
    hasAppAccess: (appSlug: string) => boolean
    currentPage?: string
    config: Record<string, unknown>
  }

  export interface BridgeUser {
    id: string
    email: string
    name: string
    role: 'admin' | 'user'
    /** Permission keys the user has for the current app */
    appPermissions?: string[]
  }

  export interface BridgeTheme {
    primary: string
    background: string
    surface: string
    text: string
    textMuted: string
  }

  export interface AppProps {}

  // ── Proxy Types ──────────────────────────────────────────────────

  export interface ProxyResponse<T = unknown> {
    data: T | null
    error: { message: string } | null
    count?: number | null
    _meta?: Record<string, unknown>
  }

  export interface ProxyClient {
    /** Select a schema (e.g., .schema('my_schema').from('my_table')) */
    schema(name: string): ProxySchemaBuilder
    /** Query a table in the default schema */
    from(table: string): ProxyQueryBuilder
    /** Call an RPC function */
    rpc(fn: string, params?: Record<string, unknown>): PromiseLike<ProxyResponse>
    /** Call an API endpoint through the proxy */
    api(
      endpoint: string,
      opts?: {
        method?: string
        params?: Record<string, string>
        body?: unknown
        normalize?: boolean
        /** Top-level only — nesting inside body causes the proxy to ignore it. */
        timeout?: number
      },
    ): Promise<ProxyResponse>
  }

  export interface ProxySchemaBuilder {
    from(table: string): ProxyQueryBuilder
  }

  export interface ProxyQueryBuilder {
    select(columns?: string): ProxyFilterBuilder
    insert(
      data: Record<string, unknown> | Record<string, unknown>[],
    ): PromiseLike<ProxyResponse>
    update(data: Record<string, unknown>): ProxyFilterBuilder
    upsert(
      data: Record<string, unknown> | Record<string, unknown>[],
      opts?: { onConflict?: string },
    ): PromiseLike<ProxyResponse>
    delete(): ProxyFilterBuilder
  }

  export interface ProxyFilterBuilder extends PromiseLike<ProxyResponse> {
    eq(column: string, value: unknown): ProxyFilterBuilder
    neq(column: string, value: unknown): ProxyFilterBuilder
    gt(column: string, value: unknown): ProxyFilterBuilder
    gte(column: string, value: unknown): ProxyFilterBuilder
    lt(column: string, value: unknown): ProxyFilterBuilder
    lte(column: string, value: unknown): ProxyFilterBuilder
    like(column: string, pattern: string): ProxyFilterBuilder
    ilike(column: string, pattern: string): ProxyFilterBuilder
    in(column: string, values: unknown[]): ProxyFilterBuilder
    is(column: string, value: null | boolean): ProxyFilterBuilder
    not(column: string, op: string, value: unknown): ProxyFilterBuilder
    order(column: string, opts?: { ascending?: boolean }): ProxyFilterBuilder
    limit(count: number): ProxyFilterBuilder
    range(from: number, to: number): ProxyFilterBuilder
    single(): PromiseLike<ProxyResponse>
    maybeSingle(): PromiseLike<ProxyResponse>
  }

  // ── Credential Types ─────────────────────────────────────────────

  export interface CredentialEntry {
    id: string
    label: string
    credential_type: string
    data: Record<string, unknown>
    metadata: Record<string, unknown>
  }

  // ── Context ──────────────────────────────────────────────────────

  export const ShellBridgeContext: Context<AppContext | null>

  // ── Hooks ────────────────────────────────────────────────────────

  /** Full shell context — user, theme, supabase, toast, permissions, config, currentPage */
  export function useShellContext(): AppContext

  /** Auth shortcut */
  export function useAuth(): {
    user: BridgeUser | null
    hasAppAccess: (appSlug: string) => boolean
  }

  /** Supabase client instance (client's own project). For external data, use useProxyClient(). */
  export function useSupabase(): any

  /** Theme colors */
  export function useTheme(): BridgeTheme

  /** Toast notifications — ALWAYS pass an object: { message, type }. Two-arg form silently no-ops. */
  export function useToast(): {
    showToast: (toast: {
      message: string
      type: 'success' | 'error' | 'info' | 'warning'
    }) => void
  }

  /** RBAC permissions. Wildcard support: '*' matches everything, 'apps/foo/*' matches all foo permissions. */
  export function usePermissions(): {
    hasAppAccess: (appSlug: string) => boolean
    hasRole: (role: string) => boolean
    hasPermission: (key: string) => boolean
    appPermissions: string[]
  }

  /** Credential vault access (admins always; non-admins require proper RBAC). */
  export function useCredentials(): {
    getCredentials: (appId: string) => Promise<CredentialEntry[]>
  }

  /**
   * Generic proxy client for external data access (proxy mode only — NOT for schema mode).
   * Use with 'app-proxy' + { app: '<slug>' } — the shell's generic proxy routes by slug.
   */
  export function useProxyClient(
    functionName: string,
    optionsOrSchema?: string | { app?: string; defaultSchema?: string },
  ): ProxyClient

  // ── Cross-App Composition (v0.6.0+) ──────────────────────────────

  /**
   * Subscribe to a cross-app event. If handler is provided, subscribes for the
   * component's lifetime. Returns an emit function for publishing events.
   */
  export function useEventBus<T = unknown>(
    eventName?: string,
    handler?: (data: T) => void,
  ): { emit: <U = unknown>(name: string, data: U) => void }

  /** Raw event bus utilities (module-level, not hooks). */
  export function emit<T = unknown>(eventName: string, data: T): void
  export function on<T = unknown>(eventName: string, handler: (data: T) => void): () => void
  export function off<T = unknown>(eventName: string, handler: (data: T) => void): void

  /** Reactive cross-app shared data store (in-memory, synced via the event bus). */
  export function useSharedData<T = unknown>(
    key?: string,
  ): {
    data: T | undefined
    setSharedData: (value: T) => void
    getSharedData: () => T | undefined
  }

  // ── Extension System ─────────────────────────────────────────────

  export interface ExtensionRegistration {
    slotName: string
    component: ComponentType<any>
    appSlug: string
    priority: number
  }

  /** Get all extensions registered for a named slot. Reactive. */
  export function useExtensionSlot(slotName: string): ExtensionRegistration[]

  /** Register a UI component into a named slot. Returns unregister fn. */
  export function registerExtension(
    slotName: string,
    component: ComponentType<any>,
    appSlug: string,
    priority?: number,
  ): () => void

  export function getExtensions(slotName: string): ExtensionRegistration[]
  export function clearExtensions(slotName?: string): void

  /** Renders all extensions registered for a named slot. */
  export const ExtensionSlot: ComponentType<{ name: string; fallback?: ReactNode }>

  // ── setup() API (runtime loading) ───────────────────────────────

  export interface AppAPI {
    readonly meta: { slug: string; name: string; version?: string }
    registerPage(pageKey: string, component: ComponentType<any>): void
    unregisterPage(pageKey: string): void
    registerExtension(
      slotName: string,
      component: ComponentType<any>,
      priority?: number,
    ): void
    on<T = unknown>(eventName: string, handler: (data: T) => void): () => void
    emit<T = unknown>(eventName: string, data: T): void
    setSharedData<T>(key: string, value: T): void
    getSharedData<T>(key: string): T | undefined
  }

  export type AppSetupFunction = (api: AppAPI) => void | Promise<void>
}
