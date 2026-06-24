// Shim: provides the shell's app-bridge instance to runtime-loaded apps.
// The shell exposes its app-bridge on window.__ELASTICIT_APP_BRIDGE__
// at startup. This shim re-exports from that global, guaranteeing the
// SAME React context (ShellBridgeContext) used by ShellBridgeProvider.
const bridge = window.__ELASTICIT_APP_BRIDGE__
if (!bridge) throw new Error('app-bridge shim: shell has not initialized __ELASTICIT_APP_BRIDGE__')
export const {
  ShellBridgeContext,
  useShellContext,
  useAuth,
  useSupabase,
  useTheme,
  useToast,
  usePermissions,
  useCredentials,
  useProxyClient,
  useEventBus,
  useSharedData,
  useExtensionSlot,
  ExtensionSlot,
  registerExtension,
  clearExtensions,
  getExtensions,
  emit,
  on,
  off,
} = bridge
export default bridge
