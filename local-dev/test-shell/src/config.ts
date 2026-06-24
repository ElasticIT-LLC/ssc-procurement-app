import type { ShellConfig } from '@elasticit-llc/shell'
import { brand } from './generated-brand'

export const config: ShellConfig = {
  clientId: brand.clientId,
  clientName: brand.clientName,
  logoUrl: brand.branding.logoFull,
  theme: {
    primary: brand.theme.colors.brand.primary,
  },
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  devMode: !import.meta.env.VITE_SUPABASE_URL,
}
