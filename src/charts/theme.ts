/**
 * Shell-brand-aware chart theme for Recharts (and compatible chart libs).
 *
 * Apps that use charting libraries should import this helper instead of
 * passing hardcoded hex values. Chart ticks, grid lines, tooltips, and
 * series colors will then resolve to the client shell's brand at runtime
 * and flip correctly with light/dark mode.
 *
 * Why this helper exists:
 * Chart libraries (Recharts, jspdf, html2canvas) ship default hex values
 * in their own bundled code — Recharts' `#ccc` tick fills, `#eee` grid
 * strokes, `#808080` axis lines, and so on. Tailwind utility classes
 * cannot override those because Recharts takes color as JS props, not
 * className. The only fix is to pass CSS-var props at the component
 * level, which this helper centralises.
 *
 * Without the helper: every chart component re-invents the pattern and
 * most forget pieces (ticks done, grid forgotten; grid done, tooltip
 * forgotten). The shipped bundle then renders per-client brands correctly
 * in most places but leaks Recharts defaults in one forgotten spot — a
 * dark island in light mode, or an off-brand color when the app loads
 * in a client portal whose brand differs from the one the developer
 * tested against.
 *
 * Usage:
 * ```tsx
 * import { chartTheme } from './charts/theme'
 * import { ResponsiveContainer, LineChart, XAxis, YAxis, Tooltip, Line, CartesianGrid } from 'recharts'
 *
 * // IMPORTANT: wrap in text-foreground so `currentColor` resolves correctly
 * <div className="text-foreground">
 *   <ResponsiveContainer height={300}>
 *     <LineChart data={data}>
 *       <XAxis dataKey="date" tick={{ fill: chartTheme.tickFill }} />
 *       <YAxis tick={{ fill: chartTheme.tickFill }} />
 *       <CartesianGrid stroke={chartTheme.gridStroke} />
 *       <Tooltip contentStyle={chartTheme.tooltipStyle} />
 *       <Line stroke={chartTheme.seriesColors[0]} />
 *     </LineChart>
 *   </ResponsiveContainer>
 * </div>
 * ```
 *
 * All values reference CSS variables the shell's brandCompiler emits per
 * client, so the same chart bundle automatically re-skins to whatever
 * primary hue the loading client's brand.json defines — with no per-client
 * code in the app.
 */
export const chartTheme = {
  /**
   * Tick fill for chart axes. `currentColor` inherits from the nearest
   * CSS `color` property — wrap your chart in
   * `<div className="text-foreground">` (or `text-muted-foreground` for
   * secondary charts) to make axis labels readable in both modes.
   */
  tickFill: 'currentColor',

  /**
   * Grid-line stroke. Uses the semantic `border` token so grid fades
   * to near-invisible on light mode and stays subtle on dark mode.
   */
  gridStroke: 'var(--color-border)',

  /**
   * Tooltip popover styling. Matches the shell's popover + card tokens
   * with a sensible fallback chain.
   */
  tooltipStyle: {
    backgroundColor: 'var(--color-popover, var(--color-card))',
    border: '1px solid var(--color-border)',
    color: 'var(--color-popover-foreground, var(--color-foreground))',
    borderRadius: 'var(--radius-md, 0.375rem)',
  },

  /**
   * Categorical series palette. Uses the brand spectrum first (so the
   * primary series renders in the client's brand color) and falls back
   * to semantic intents for additional series. Add more by continuing
   * the var() fallback chain — don't hardcode hex.
   */
  seriesColors: [
    'var(--color-brand-500)',
    'var(--color-brand-300)',
    'var(--color-secondary-500, var(--color-brand-700))',
    'var(--color-success)',
    'var(--color-warning)',
    'var(--color-danger)',
    'var(--color-info)',
  ],
} as const

export type ChartTheme = typeof chartTheme
