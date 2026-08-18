import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'

interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function parseIso(value: string): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null
  }
  return date
}

function toIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function toDisplay(value: string): string {
  if (!value) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return `${match[2]}/${match[3]}/${match[1]}`
}

function fromDisplay(display: string): string | null {
  const match = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{4})$/.exec(display)
  if (!match) return null
  const [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null
  }
  return toIso(date)
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function Calendar({
  value,
  onChange,
  onClose,
}: {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  const [monthDate, setMonthDate] = useState(() => startOfMonth(parseIso(value) ?? new Date()))
  const calendarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startDay = new Date(year, month, 1).getDay()

  const weeks: number[][] = []
  const week: number[] = []
  for (let i = 0; i < startDay; i++) week.push(0)
  for (let day = 1; day <= daysInMonth; day++) {
    week.push(day)
    if (week.length === 7) {
      weeks.push([...week])
      week.length = 0
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(0)
    weeks.push([...week])
  }

  const selectedDate = parseIso(value)

  function selectDate(day: number) {
    onChange(toIso(new Date(year, month, day)))
    onClose()
  }

  return (
    <div
      ref={calendarRef}
      className="absolute z-50 mt-1 w-64 rounded-md border border-border bg-card p-2 shadow-lg"
      style={{ top: '100%', left: 0 }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMonthDate(addMonths(monthDate, -12))}
            className="rounded p-1 hover:bg-muted"
            aria-label="Previous year"
          >
            «
          </button>
          <button
            type="button"
            onClick={() => setMonthDate(addMonths(monthDate, -1))}
            className="rounded p-1 hover:bg-muted"
            aria-label="Previous month"
          >
            ‹
          </button>
        </div>
        <span className="text-sm font-medium">
          {MONTH_NAMES[month]} {year}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMonthDate(addMonths(monthDate, 1))}
            className="rounded p-1 hover:bg-muted"
            aria-label="Next month"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => setMonthDate(addMonths(monthDate, 12))}
            className="rounded p-1 hover:bg-muted"
            aria-label="Next year"
          >
            »
          </button>
        </div>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {weeks.map((days, weekIndex) =>
          days.map((day, dayIndex) => {
            const key = `${weekIndex}-${dayIndex}`
            if (!day) return <div key={key} />
            const isSelected =
              selectedDate != null &&
              selectedDate.getFullYear() === year &&
              selectedDate.getMonth() === month &&
              selectedDate.getDate() === day
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectDate(day)}
                className={`rounded p-1 hover:bg-primary hover:text-primary-foreground ${
                  isSelected ? 'bg-primary text-primary-foreground' : ''
                }`}
              >
                {day}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

export function DateInput({ value, onChange, className = '', ...rest }: DateInputProps) {
  const [displayValue, setDisplayValue] = useState(() => toDisplay(value))
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setDisplayValue(toDisplay(value))
  }, [value])

  function handleTextChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDisplayValue(e.target.value)
  }

  function handleBlur() {
    const iso = fromDisplay(displayValue)
    if (iso !== null) {
      onChange(iso)
    } else if (displayValue === '') {
      onChange('')
    } else {
      // Invalid text: clear the stored value so validation shows an error,
      // but keep the typed text so the user can correct it.
      onChange('')
    }
  }

  function handleCalendarSelect(iso: string) {
    onChange(iso)
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape' && open) {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        value={displayValue}
        onChange={handleTextChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="MM/DD/YYYY"
        pattern="^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/\d{4}$"
        title="Enter date as MM/DD/YYYY"
        maxLength={10}
        autoComplete="off"
        className={`${className} pr-10`}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        aria-label="Toggle calendar"
        aria-expanded={open}
      >
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
      </button>
      {open && (
        <Calendar value={value} onChange={handleCalendarSelect} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

export default DateInput
