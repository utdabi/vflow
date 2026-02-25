// app/(app)/shifts/index.tsx — Phase 3
// Monthly calendar. Tap a day to create a shift; tap a pill to open dispatch board.
import { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { shiftsApi, type Shift } from '../../../lib/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad2(n: number) { return String(n).padStart(2, '0') }

function buildCalendarCells(year: number, month: number): (number | null)[] {
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDay    = new Date(year, month - 1, 1).getDay()
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function pillStyle(s: Shift): { bg: string; text: string } {
  if (s.status === 'cancelled') return { bg: '#f3f4f6', text: '#9ca3af' }
  if (s.status === 'draft')     return { bg: '#e5e7eb', text: '#4b5563' }
  if (s.assigned_count >= s.max_volunteers) return { bg: '#dcfce7', text: '#166534' }
  if (s.assigned_count >= s.min_volunteers) return { bg: '#fef9c3', text: '#854d0e' }
  return { bg: '#fee2e2', text: '#991b1b' }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function ShiftsScreen() {
  const today = new Date()
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const { data, isLoading } = useQuery({
    queryKey: ['shifts', year, month],
    queryFn: () => shiftsApi.listByMonth(year, month).then(r => r.data),
  })

  const shifts = data?.shifts ?? []

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const cells = buildCalendarCells(year, month)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const shiftsByDate: Record<string, Shift[]> = {}
  for (const s of shifts) {
    if (!shiftsByDate[s.date]) shiftsByDate[s.date] = []
    shiftsByDate[s.date].push(s)
  }

  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear()

  return (
    <View className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="bg-white border-b border-gray-200 px-4 py-4">
        <View className="flex-row items-center justify-between">
          <TouchableOpacity
            onPress={prevMonth}
            className="w-9 h-9 items-center justify-center rounded-lg border border-gray-200"
          >
            <Text className="text-gray-600 text-lg">‹</Text>
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-900">
            {MONTH_NAMES[month - 1]} {year}
          </Text>
          <TouchableOpacity
            onPress={nextMonth}
            className="w-9 h-9 items-center justify-center rounded-lg border border-gray-200"
          >
            <Text className="text-gray-600 text-lg">›</Text>
          </TouchableOpacity>
        </View>

        {/* Legend */}
        <View className="flex-row items-center justify-center mt-2" style={{ gap: 12 }}>
          {[
            { color: '#e5e7eb', label: 'Draft' },
            { color: '#fee2e2', label: 'Below min' },
            { color: '#fef9c3', label: 'Partial' },
            { color: '#dcfce7', label: 'Full' },
          ].map(({ color, label }) => (
            <View key={label} className="flex-row items-center" style={{ gap: 4 }}>
              <View
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: color, borderWidth: 1, borderColor: '#e5e7eb' }}
              />
              <Text className="text-xs text-gray-500">{label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Calendar grid */}
      <ScrollView className="flex-1">
        <View className="bg-white mx-2 my-2 rounded-xl border border-gray-200 overflow-hidden">
          {/* Day headers */}
          <View className="flex-row border-b border-gray-200">
            {DAY_NAMES.map(d => (
              <View key={d} style={{ flex: 1 }} className="py-2 items-center">
                <Text className="text-xs font-semibold text-gray-500 uppercase">{d}</Text>
              </View>
            ))}
          </View>

          {isLoading && (
            <View className="py-16 items-center">
              <ActivityIndicator color="#2563eb" />
            </View>
          )}

          {/* Week rows */}
          {!isLoading && weeks.map((week, wi) => (
            <View key={wi} className="flex-row border-b border-gray-100">
              {week.map((day, di) => {
                const dateStr   = day ? `${year}-${pad2(month)}-${pad2(day)}` : ''
                const dayShifts = day ? (shiftsByDate[dateStr] ?? []) : []
                const isLastCol = di === 6
                return (
                  <TouchableOpacity
                    key={di}
                    activeOpacity={day ? 0.7 : 1}
                    onPress={() => {
                      if (day) router.push(`/(app)/shifts/new?date=${dateStr}`)
                    }}
                    style={{
                      flex: 1,
                      minHeight: 80,
                      borderRightWidth: isLastCol ? 0 : 1,
                      borderColor: '#f3f4f6',
                      backgroundColor: day ? undefined : '#fafafa',
                    }}
                  >
                    {day && (
                      <View className="p-1">
                        {/* Day number */}
                        <View
                          className={`w-6 h-6 rounded-full items-center justify-center mb-0.5 ${
                            isToday(day) ? 'bg-blue-600' : ''
                          }`}
                        >
                          <Text
                            className={`text-xs font-medium ${
                              isToday(day) ? 'text-white' : 'text-gray-700'
                            }`}
                          >
                            {day}
                          </Text>
                        </View>

                        {/* Shift pills */}
                        <View style={{ gap: 2 }}>
                          {dayShifts.map(s => {
                            const { bg, text } = pillStyle(s)
                            return (
                              <TouchableOpacity
                                key={s.id}
                                onPress={() => router.push(`/(app)/shifts/${s.id}`)}
                                style={{
                                  backgroundColor: bg,
                                  borderRadius: 3,
                                  paddingHorizontal: 3,
                                  paddingVertical: 1,
                                }}
                              >
                                <Text style={{ color: text, fontSize: 10 }} numberOfLines={1}>
                                  {s.start_time.slice(0, 5)} {s.title}
                                </Text>
                              </TouchableOpacity>
                            )
                          })}
                        </View>
                      </View>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>
          ))}
        </View>

        {!isLoading && shifts.length === 0 && (
          <Text className="text-center text-gray-400 text-sm mt-4 px-4">
            No shifts this month. Tap any day to create one.
          </Text>
        )}
      </ScrollView>
    </View>
  )
}
