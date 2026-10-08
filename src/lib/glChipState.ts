// GlCodeChip state machine (pure — the timer/async side effects live in the
// component). token = suggestion generation: INPUT_CHANGED and USER_PICKED bump
// it; late SUGGESTED/SUGGEST_FAILED replies carrying a stale token are dropped,
// so an in-flight reply can never overwrite a value the user picked.

export type GlChipPhase = 'idle' | 'suggesting' | 'suggested' | 'edited' | 'unavailable'

export interface GlChipState {
  phase: GlChipPhase
  value: string
  token: number
}

export type GlChipEvent =
  | { type: 'INPUT_CHANGED'; name: string }
  | { type: 'TIMER_FIRED'; token: number }
  | { type: 'SUGGESTED'; token: number; code: string }
  | { type: 'SUGGEST_FAILED'; token: number }
  | { type: 'USER_PICKED'; code: string }

export const GL_CHIP_INIT: GlChipState = { phase: 'idle', value: '', token: 0 }

export function glChipReducer(state: GlChipState, ev: GlChipEvent): GlChipState {
  switch (ev.type) {
    case 'INPUT_CHANGED': {
      const name = ev.name.trim()
      if (!name) return { phase: 'idle', value: '', token: state.token + 1 }
      return { phase: 'suggesting', value: state.value, token: state.token + 1 }
    }
    case 'TIMER_FIRED':
      // Debounce gating happens in the component (token check before the async
      // call); the reducer never transitions on a timer event.
      return state
    case 'SUGGESTED':
      return ev.token === state.token ? { phase: 'suggested', value: ev.code, token: state.token } : state
    case 'SUGGEST_FAILED':
      return ev.token === state.token ? { phase: 'unavailable', value: state.value, token: state.token } : state
    case 'USER_PICKED':
      return { phase: 'edited', value: ev.code, token: state.token + 1 }
  }
}
