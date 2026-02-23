// date-format.ts
// Utility for displaying and hinting dates according to an organisation's
// preferred format.  Dates are always stored in the database as ISO 8601
// (YYYY-MM-DD).  This module converts them for display only.
//
//   'US'   → MM/DD/YYYY  (United States)
//   'INTL' → DD/MM/YYYY  (International / European)

import type { DateFormat } from './api'

/**
 * Convert a stored ISO 8601 date string (YYYY-MM-DD) to the organisation's
 * preferred display format.
 *
 * @param isoDate   - "2025-04-15" or null/undefined
 * @param format    - 'US' | 'INTL'  (default: 'INTL')
 * @returns         - "15/04/2025" (INTL) or "04/15/2025" (US), or "—" if empty
 */
export function formatDate(
  isoDate: string | null | undefined,
  format: DateFormat = 'INTL',
): string {
  if (!isoDate) return '—'
  const parts = isoDate.split('-')
  if (parts.length !== 3) return isoDate          // not ISO — return as-is
  const [year, month, day] = parts
  if (!year || !month || !day) return isoDate
  return format === 'US'
    ? `${month}/${day}/${year}`   // MM/DD/YYYY
    : `${day}/${month}/${year}`   // DD/MM/YYYY
}

/**
 * Human-readable pattern string for the given format.
 *   'US'   → "MM/DD/YYYY"
 *   'INTL' → "DD/MM/YYYY"
 */
export function dateFormatPattern(format: DateFormat = 'INTL'): string {
  return format === 'US' ? 'MM/DD/YYYY' : 'DD/MM/YYYY'
}

/**
 * A concrete example date string in the given format, used in hints and
 * CSV import instructions so coordinators see their own preferred format.
 *   'US'   → "04/15/1990"
 *   'INTL' → "15/04/1990"
 */
export function dateFormatExample(format: DateFormat = 'INTL'): string {
  return format === 'US' ? '04/15/1990' : '15/04/1990'
}

/**
 * Parse a date string in the org's display format back to ISO 8601 (YYYY-MM-DD).
 * Returns null if the input is empty or cannot be parsed.
 *
 *   'INTL' expects DD/MM/YYYY  → "15/04/1990" → "1990-04-15"
 *   'US'   expects MM/DD/YYYY  → "04/15/1990" → "1990-04-15"
 */
export function parseDateToISO(
  displayDate: string,
  format: DateFormat = 'INTL',
): string | null {
  if (!displayDate.trim()) return null
  const parts = displayDate.trim().split('/')
  if (parts.length !== 3) return null
  const [a, b, yearStr] = parts
  if (!a || !b || !yearStr || yearStr.length !== 4) return null
  const month = format === 'US' ? a.padStart(2, '0') : b.padStart(2, '0')
  const day   = format === 'US' ? b.padStart(2, '0') : a.padStart(2, '0')
  const m = Number(month), d = Number(day), y = Number(yearStr)
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null
  return `${yearStr}-${month}-${day}`
}
