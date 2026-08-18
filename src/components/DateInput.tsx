import { useRef, type InputHTMLAttributes } from 'react'

interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
}

export function DateInput({ value, onChange, className = '', ...rest }: DateInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function openPicker() {
    try {
      inputRef.current?.showPicker?.()
    } catch {
      // Some browsers do not support showPicker(); the native input still works normally.
    }
  }

  return (
    <input
      ref={inputRef}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={openPicker}
      onFocus={openPicker}
      placeholder="YYYY-MM-DD"
      pattern="\\d{4}-\\d{2}-\\d{2}"
      title="Enter date as YYYY-MM-DD"
      lang="en"
      className={className}
      {...rest}
    />
  )
}

export default DateInput
