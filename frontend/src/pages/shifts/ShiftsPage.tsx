// ShiftsPage.tsx
// Feature 4.3: Shift Scheduling
//
// Monthly calendar view. Creating or editing a shift navigates to
// ShiftEditPage (/shifts/new or /shifts/:id) rather than opening a modal.
//
// Public routes:
//   /shifts         — this page
//   /shifts/new     — create (ShiftEditPage)
//   /shifts/:id     — detail / assign (ShiftEditPage)

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import AppNav, { APP_NAV_LINKS } from '../../components/AppNav'
import { shiftsApi, type Shift } from '../../lib/api'

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month - 1, 1).getDay()
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatTime(t: string) {
  return t.slice(0, 5)
}

// ---------------------------------------------------------------------------
// Pill colour logic
// ---------------------------------------------------------------------------

function shiftPillClass(shift: Shift): string {
  if (shift.status === 'cancelled') return 'bg-gray-100 text-gray-400 line-through'
  if (shift.status === 'draft')     return 'bg-gray-200 text-gray-600'
  if (shift.assigned_count >= shift.max_volunteers) return 'bg-green-100 text-green-800'
  if (shift.assigned_count >= shift.min_volunteers) return 'bg-yellow-100 text-yellow-800'
  return 'bg-red-100 text-red-700'
}

// ---------------------------------------------------------------------------
// Main ShiftsPage
// ---------------------------------------------------------------------------

const NAV_LINKS = APP_NAV_LINKS

export default function ShiftsPage() {
  const navigate = useNavigate()
  const today    = new Date()
  const [year,   setYear]   = useState(today.getFullYear())
  const [month,  setMonth]  = useState(today.getMonth() + 1)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)

  const loadShifts = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await shiftsApi.listByMonth(year, month)
      setShifts(resp.data.shifts)
    } catch {
      // silently fail — empty calendar is acceptable
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { loadShifts() }, [loadShifts])

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  // Build calendar grid
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay    = getFirstDayOfMonth(year, month)
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const shiftsByDate: Record<string, Shift[]> = {}
  for (const s of shifts) {
    if (!shiftsByDate[s.date]) shiftsByDate[s.date] = []
    shiftsByDate[s.date].push(s)
  }

  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear()

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav links={NAV_LINKS} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={prevMonth}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600"
              aria-label="Previous month">‹</button>
            <h1 className="text-2xl font-bold text-gray-900 min-w-[200px] text-center">
              {MONTH_NAMES[month - 1]} {year}
            </h1>
            <button onClick={nextMonth}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600"
              aria-label="Next month">›</button>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-200 inline-block" />Draft</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 inline-block" />Below min</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100 inline-block" />Partially filled</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 inline-block" />Full</span>
          </div>
        </div>

        {/* Calendar grid */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Day name headers */}
          <div className="grid grid-cols-7 border-b border-gray-200">
            {DAY_NAMES.map(d => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          {loading ? (
            <div className="py-20 text-center text-gray-400 text-sm">Loading shifts…</div>
          ) : (
            <div className="grid grid-cols-7">
              {cells.map((day, idx) => {
                const dateStr  = day ? `${year}-${pad2(month)}-${pad2(day)}` : ''
                const dayShifts = day ? (shiftsByDate[dateStr] ?? []) : []
                return (
                  <div
                    key={idx}
                    onClick={() => day && navigate(`/shifts/new?date=${dateStr}`)}
                    className={[
                      'min-h-[90px] p-1.5 border-b border-r border-gray-100',
                      day ? 'cursor-pointer hover:bg-blue-50/40 transition-colors' : 'bg-gray-50/40',
                      idx % 7 === 6 ? 'border-r-0' : '',
                    ].join(' ')}
                  >
                    {day && (
                      <>
                        <div className={[
                          'text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full',
                          isToday(day) ? 'bg-blue-600 text-white' : 'text-gray-700',
                        ].join(' ')}>
                          {day}
                        </div>
                        <div className="space-y-0.5">
                          {dayShifts.map(s => (
                            <button
                              key={s.id}
                              onClick={e => { e.stopPropagation(); navigate(`/shifts/${s.id}`) }}
                              className={[
                                'w-full text-left text-xs px-1.5 py-0.5 rounded truncate block',
                                shiftPillClass(s),
                              ].join(' ')}
                              title={`${s.title} (${formatTime(s.start_time)}–${formatTime(s.end_time)}) | ${s.assigned_count}/${s.max_volunteers}`}
                            >
                              {formatTime(s.start_time)} {s.title}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Empty state */}
        {!loading && shifts.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-6">
            No shifts this month. Click any day to create one.
          </p>
        )}
      </div>
    </div>
  )
}
