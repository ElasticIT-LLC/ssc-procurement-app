import { describe, it, expect } from 'vitest'
import { groupGlCategories } from './glCategories'

// The client's 18 GL categories verbatim (seed order = sort_order).
const CODES = [
  'Facility: Facility/Building Supplies/In-House Maintenance',
  'Facility: Small Kitchen equipment, supplies, smallware',
  'General Office and Administrative Expenses: Small Furniture for Staff Use',
  'General Office and Administrative Expenses: Office Supplies',
  'HR & Recruiting: Human Resources Onboarding/ Appreciation/Retention',
  'IT: Computer Accessories',
  'Marketing: Alumni Program',
  'Marketing: Marketing Materials & Promotional/Branded Products',
  'Medical: Clinical Supplies',
  'Medical: Medical Supplies',
  'Medical: Pharmacy and OTC',
  'Medical: Small Medical Equipment',
  'Automobile Expense',
  'Client Services: Small Furniture for Client Use',
  'Client Services: Food Supplies',
  'Client Services: Bedding & Towels',
  'Client Services: Program Expense',
  'Client Services: Hygiene/personal care',
]

describe('groupGlCategories', () => {
  it('groups the client list in first-appearance department order', () => {
    const groups = groupGlCategories(CODES)
    expect(groups.map((g) => g.group)).toEqual([
      'Facility',
      'General Office and Administrative Expenses',
      'HR & Recruiting',
      'IT',
      'Marketing',
      'Medical',
      'Other',
      'Client Services',
    ])
    expect(groups.map((g) => g.codes.length)).toEqual([2, 2, 1, 1, 2, 4, 1, 5])
  })

  it('places codes without a "dept: " prefix in Other', () => {
    const groups = groupGlCategories(['Automobile Expense'])
    expect(groups).toEqual([{ group: 'Other', codes: ['Automobile Expense'] }])
  })

  it('preserves within-group order from the input', () => {
    const medical = groupGlCategories(CODES).find((g) => g.group === 'Medical')!
    expect(medical.codes).toEqual([
      'Medical: Clinical Supplies',
      'Medical: Medical Supplies',
      'Medical: Pharmacy and OTC',
      'Medical: Small Medical Equipment',
    ])
  })

  it('returns an empty list for no codes', () => {
    expect(groupGlCategories([])).toEqual([])
  })
})
