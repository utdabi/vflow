// lib/date.ts
// Date formatting helpers — respects org's date_format preference.

import type { DateFormat } from './api'

/** Format a YYYY-MM-DD ISO date string for display, using org's date_format. */
export function formatDate(iso: string | null | undefined, format: DateFormat = 'INTL'): string {
  if (!iso) return '—'
  const [year, month, day] = iso.split('-')
  return format === 'US'
    ? `${month}/${day}/${year}`   // MM/DD/YYYY
    : `${day}/${month}/${year}`   // DD/MM/YYYY
}

/** Format HH:MM:SS time string for display (strips seconds). */
export function formatTime(time: string | null | undefined): string {
  if (!time) return '—'
  const [h, m] = time.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'pm' : 'am'
  const hour12 = hour % 12 || 12
  return `${hour12}:${m}${ampm}`
}

/** Convert a JS Date to YYYY-MM-DD ISO string for API submission. */
export function toISODate(date: Date): string {
  return date.toISOString().split('T')[0]
}

/** Convert a JS Date to HH:MM string for API submission. */
export function toHHMM(date: Date): string {
  return date.toTimeString().slice(0, 5)
}

/** Day-of-week label map (0=Sun … 6=Sat). */
export const DAY_LABELS: Record<number, string> = {
  0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat',
}
