import { Location, Department } from '../data/db'

export interface LineItemDraft {
  ship_to_name: string
  // null = not yet chosen (placeholder shown). location_other distinguishes the
  // explicit "Other" choice (also null id, but with the custom text input revealed).
  location_id: string | null
  location_other: boolean
  custom_location: string
  department_id: string | null
  department_other: boolean
  custom_department: string
  item_url: string
  item_description: string
  memo: string
  quantity: number
  substitution_ok: boolean
  date_needed: string
}

export interface LineItemDraftErrors {
  item_description?: string
  quantity?: string
  location?: string
  department?: string
  memo?: string
  date_needed?: string
}

interface LineItemFormRowProps {
  index: number
  value: LineItemDraft
  onChange: (updated: LineItemDraft) => void
  onRemove: () => void
  disableRemove: boolean
  locations: Location[]
  departments: Department[]
  errors: LineItemDraftErrors
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function LineItemFormRow({
  index, value, onChange, onRemove, disableRemove, locations, departments, errors,
}: LineItemFormRowProps) {
  const set = (patch: Partial<LineItemDraft>) => onChange({ ...value, ...patch })

  const showCustomLocation = value.location_other
  const showCustomDepartment = value.department_other
  // Empty string = placeholder "Select…"; '__other__' = the Other option.
  const locationValue = value.location_other ? '__other__' : (value.location_id ?? '')
  const departmentValue = value.department_other ? '__other__' : (value.department_id ?? '')

  return (
    <div className="rounded-lg border border-border bg-card p-4 grid gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Item #{index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disableRemove}
          className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={`Remove item ${index + 1}`}
        >
          Remove
        </button>
      </div>

      {/* Location */}
      <Field label="Location" error={errors.location}>
        <select
          value={locationValue}
          onChange={(e) => {
            if (e.target.value === '__other__') {
              set({ location_id: null, location_other: true, custom_location: '' })
            } else {
              set({ location_id: e.target.value, location_other: false, custom_location: '' })
            }
          }}
          className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="" disabled>Select a location</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>{loc.name}</option>
          ))}
          <option value="__other__">Other</option>
        </select>
        {showCustomLocation && (
          <input
            type="text"
            placeholder="Enter custom location"
            value={value.custom_location}
            onChange={(e) => set({ custom_location: e.target.value })}
            className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        )}
      </Field>

      {/* Ship to Name */}
      <Field label="Ship to Name">
        <input
          type="text"
          value={value.ship_to_name}
          onChange={(e) => set({ ship_to_name: e.target.value })}
          className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </Field>

      {/* Department */}
      <Field label="Department" error={errors.department}>
        <select
          value={departmentValue}
          onChange={(e) => {
            if (e.target.value === '__other__') {
              set({ department_id: null, department_other: true, custom_department: '' })
            } else {
              set({ department_id: e.target.value, department_other: false, custom_department: '' })
            }
          }}
          className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="" disabled>Select a department</option>
          {departments.map((dept) => (
            <option key={dept.id} value={dept.id}>{dept.name}</option>
          ))}
          <option value="__other__">Other</option>
        </select>
        {showCustomDepartment && (
          <input
            type="text"
            placeholder="Enter custom department"
            value={value.custom_department}
            onChange={(e) => set({ custom_department: e.target.value })}
            className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        )}
      </Field>

      {/* Item URL */}
      <Field label="Item URL (optional)">
        <input
          type="url"
          placeholder="https://..."
          value={value.item_url}
          onChange={(e) => set({ item_url: e.target.value })}
          className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </Field>

      {/* Quantity + Substitution OK */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Quantity" error={errors.quantity}>
          <input
            type="number"
            min={1}
            value={value.quantity}
            onChange={(e) => set({ quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </Field>
        <div className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            id={`subst-${index}`}
            checked={value.substitution_ok}
            onChange={(e) => set({ substitution_ok: e.target.checked })}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <label htmlFor={`subst-${index}`} className="text-sm text-foreground">Substitution OK</label>
        </div>
      </div>

      {/* Item Description */}
      <Field label="Item Description" error={errors.item_description}>
        <textarea
          rows={2}
          value={value.item_description}
          onChange={(e) => set({ item_description: e.target.value })}
          className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </Field>

      {/* Memo */}
      <Field label="Memo (reason for item)" error={errors.memo}>
        <textarea
          rows={2}
          value={value.memo}
          onChange={(e) => set({ memo: e.target.value })}
          className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </Field>

      {/* Date Needed */}
      <Field label="Date Needed" error={errors.date_needed}>
        <input
          type="date"
          value={value.date_needed}
          onChange={(e) => set({ date_needed: e.target.value })}
          className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </Field>
    </div>
  )
}
