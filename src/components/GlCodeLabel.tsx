// Read-only GL code line for item surfaces (same visual style as the
// "Location:" lines). NULL renders as "—".
export function GlCodeLabel({ glCode }: { glCode?: string | null }) {
  return (
    <p className="text-xs text-muted-foreground">
      GL: {glCode || '—'}
    </p>
  )
}
