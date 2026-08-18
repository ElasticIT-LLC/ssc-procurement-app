import { useRef, type InputHTMLAttributes } from 'react'

interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
}

export function DateInput({ value, onChange, className = '', ...rest }: DateInputProps) {
  const pickerRef = useRef<HTMLInputElement>(null)

  function openPicker() {
    try {
      pickerRef.current?.showPicker?.()
    } catch {
      // Some browsers do not allow programmatic showPicker(); ignore.
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={openPicker}
        onFocus={openPicker}
        placeholder="YYYY-MM-DD"
        pattern="\\d{4}-\\d{2}-\\d{2}"
        title="Enter date as YYYY-MM-DD"
        maxLength={10}
        autoComplete="off"
        className={`${className} pr-10`}
        {...rest}
      />
      {/* Hidden native date input used only as the calendar picker target. */}
      <input
        ref={pickerRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min="1900-01-01"
        max="9999-12-31"
        lang="en"
        className="absolute inset-0 -z-10 opacity-0"
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </div>
    </div>
  )
}

export default DateInput
