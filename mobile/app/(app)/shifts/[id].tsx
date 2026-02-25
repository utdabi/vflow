// app/(app)/shifts/[id].tsx — Phase 3
// Dispatch board: assign and remove volunteers from a shift.
// Tablet (≥768dp): permanent two-panel side-by-side layout.
// Phone (<768dp): tab toggle between "Available" and "Assigned" panels.
import { useState, useMemo } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  ActivityIndicator, Alert, useWindowDimensions,
} from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import {
  shiftsApi, volunteersApi,
  type ShiftDetail, type ShiftAssignment, type Volunteer,
} from '../../../lib/api'
import { formatDate, formatTime } from '../../../lib/date'
import { useAuth } from '../../../lib/auth-context'
import CapacityBar from '../../../components/CapacityBar'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', published: 'Published', cancelled: 'Cancelled',
}
const STATUS_TEXT_COLORS: Record<string, string> = {
  draft: '#6b7280', published: '#16a34a', cancelled: '#dc2626',
}

const AVATAR_PALETTE = [
  '#0d9488', '#d97706', '#e11d48', '#7c3aed',
  '#059669', '#0284c7', '#b45309', '#6d28d9',
]

function avatarColor(name: string): string {
  let code = 0
  for (const c of name) code = (code + c.charCodeAt(0)) % AVATAR_PALETTE.length
  return AVATAR_PALETTE[code]
}

const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// ---------------------------------------------------------------------------
// Shift header (spans full width above both panels)
// ---------------------------------------------------------------------------
function ShiftHeader({ shift, dateFormat }: { shift: ShiftDetail; dateFormat: string }) {
  return (
    <View className="bg-white border-b border-gray-200 px-4 py-4">
      <View className="flex-row items-center mb-1">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Text className="text-blue-600 text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-xl font-bold text-gray-900 flex-1" numberOfLines={1}>
          {shift.title}
        </Text>
        <Text
          className="text-xs font-semibold ml-2"
          style={{ color: STATUS_TEXT_COLORS[shift.status] ?? '#6b7280' }}
        >
          {STATUS_LABELS[shift.status] ?? shift.status}
        </Text>
      </View>
      <Text className="text-sm text-gray-500 mb-1">
        {formatDate(shift.date, dateFormat as 'US' | 'INTL')}
        {'  ·  '}
        {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
        {shift.location ? `  ·  ${shift.location}` : ''}
      </Text>
      <Text className="text-xs text-gray-400 mb-3">
        Lead: {shift.event_lead_first_name} {shift.event_lead_last_name}
        {shift.event_lead_mobile ? `  ·  ${shift.event_lead_mobile}` : ''}
      </Text>
      <CapacityBar
        assigned={shift.assigned_count}
        min={shift.min_volunteers}
        max={shift.max_volunteers}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Available volunteer row
// ---------------------------------------------------------------------------
function AvailableRow({
  volunteer,
  onAssign,
  busy,
}: { volunteer: Volunteer; onAssign: () => void; busy: boolean }) {
  return (
    <TouchableOpacity
      onPress={busy ? undefined : onAssign}
      activeOpacity={0.7}
      className="flex-row items-center px-4 py-3 border-b border-gray-100"
    >
      <View
        className="w-9 h-9 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: avatarColor(volunteer.first_name + volunteer.last_name) }}
      >
        <Text className="text-white text-sm font-semibold">
          {volunteer.first_name[0]}{volunteer.last_name[0]}
        </Text>
      </View>
      <View className="flex-1 min-w-0">
        <Text className="text-sm font-medium text-gray-900" numberOfLines={1}>
          {volunteer.first_name} {volunteer.last_name}
        </Text>
        <Text className="text-xs text-gray-400">{volunteer.mobile}</Text>
        {volunteer.preferred_days.length > 0 && (
          <View className="flex-row flex-wrap mt-0.5" style={{ gap: 2 }}>
            {[...volunteer.preferred_days].sort((a, b) => a - b).map(d => (
              <View key={d} className="bg-blue-50 border border-blue-100 rounded px-1">
                <Text className="text-blue-600" style={{ fontSize: 9 }}>{DAY_SHORT[d]}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {busy ? (
        <ActivityIndicator size="small" color="#2563eb" />
      ) : (
        <Text className="text-blue-600 text-2xl font-light ml-2">+</Text>
      )}
    </TouchableOpacity>
  )
}

// ---------------------------------------------------------------------------
// Assigned volunteer row
// ---------------------------------------------------------------------------
function AssignedRow({
  assignment,
  onRemove,
  busy,
}: { assignment: ShiftAssignment; onRemove: () => void; busy: boolean }) {
  const v = assignment.volunteers
  return (
    <View className="flex-row items-center px-4 py-3 border-b border-gray-100">
      <View
        className="w-9 h-9 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: avatarColor(v.first_name + v.last_name) }}
      >
        <Text className="text-white text-sm font-semibold">
          {v.first_name[0]}{v.last_name[0]}
        </Text>
      </View>
      <View className="flex-1 min-w-0">
        <Text className="text-sm font-medium text-gray-900" numberOfLines={1}>
          {v.first_name} {v.last_name}
        </Text>
        <Text className="text-xs text-gray-400">{v.mobile}</Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color="#ef4444" />
      ) : (
        <TouchableOpacity
          onPress={onRemove}
          className="w-8 h-8 rounded-full bg-red-50 items-center justify-center ml-2"
        >
          <Text className="text-red-500 text-lg font-medium">×</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function ShiftDetailScreen() {
  const { id }         = useLocalSearchParams<{ id: string }>()
  const { organization } = useAuth()
  const dateFormat     = organization?.date_format ?? 'INTL'
  const queryClient    = useQueryClient()
  const { width }      = useWindowDimensions()
  const isTablet       = width >= 768

  const [search, setSearch]         = useState('')
  const [phoneTab, setPhoneTab]     = useState<'available' | 'assigned'>('assigned')
  const [busyAssign, setBusyAssign] = useState<string | null>(null)
  const [busyRemove, setBusyRemove] = useState<string | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────
  const {
    data: shift, isLoading: loadingShift, error: shiftError, refetch,
  } = useQuery<ShiftDetail>({
    queryKey: ['shift', id],
    queryFn: () => shiftsApi.getById(id).then(r => r.data),
    enabled: !!id,
  })

  const { data: allVolunteers = [] } = useQuery<Volunteer[]>({
    queryKey: ['volunteers', true],
    queryFn: () => volunteersApi.list(true).then(r => r.data),
  })

  // ── Derived data ─────────────────────────────────────────────────────────
  const assignedIds = useMemo(
    () => new Set((shift?.assignments ?? []).map(a => a.volunteer_id)),
    [shift],
  )

  const available = useMemo(() => {
    const q = search.toLowerCase()
    return allVolunteers.filter(v => {
      if (assignedIds.has(v.id)) return false
      if (!q) return true
      return (
        v.first_name.toLowerCase().includes(q) ||
        v.last_name.toLowerCase().includes(q) ||
        v.mobile.includes(q)
      )
    })
  }, [allVolunteers, assignedIds, search])

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleAssign = async (volunteerId: string) => {
    setBusyAssign(volunteerId)
    try {
      await shiftsApi.assignVolunteer(id, volunteerId)
      queryClient.invalidateQueries({ queryKey: ['shift', id] })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', detail ?? 'Failed to assign volunteer.')
    } finally {
      setBusyAssign(null)
    }
  }

  const handleRemove = (assignment: ShiftAssignment) => {
    const { first_name, last_name } = assignment.volunteers
    Alert.alert(
      'Remove Volunteer',
      `Remove ${first_name} ${last_name} from this shift?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusyRemove(assignment.volunteer_id)
            try {
              await shiftsApi.cancelAssignment(id, assignment.volunteer_id)
              queryClient.invalidateQueries({ queryKey: ['shift', id] })
            } catch {
              Alert.alert('Error', 'Failed to remove volunteer.')
            } finally {
              setBusyRemove(null)
            }
          },
        },
      ],
    )
  }

  // ── Loading / error states ────────────────────────────────────────────────
  if (loadingShift) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    )
  }

  if (shiftError || !shift) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-red-600 text-center mb-4">Failed to load shift.</Text>
        <TouchableOpacity onPress={() => refetch()} className="px-4 py-2 bg-blue-600 rounded-lg">
          <Text className="text-white text-sm font-medium">Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Panel content ─────────────────────────────────────────────────────────
  const availablePanel = (
    <View className="flex-1 bg-white">
      <View className="px-4 py-3 border-b border-gray-100">
        <Text className="text-sm font-semibold text-gray-700 mb-2">
          Available ({available.length})
        </Text>
        <TextInput
          className="bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-900"
          placeholder="Search volunteers…"
          placeholderTextColor="#9ca3af"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      {available.length === 0 ? (
        <View className="flex-1 items-center justify-center px-4">
          <Text className="text-gray-400 text-sm text-center">
            {search
              ? 'No volunteers match your search.'
              : 'All active volunteers are already assigned.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={available}
          keyExtractor={v => v.id}
          renderItem={({ item: v }) => (
            <AvailableRow
              volunteer={v}
              onAssign={() => handleAssign(v.id)}
              busy={busyAssign === v.id}
            />
          )}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  )

  const assignedPanel = (
    <View
      className="flex-1 bg-white"
      style={isTablet ? { borderLeftWidth: 1, borderColor: '#e5e7eb' } : {}}
    >
      <View className="px-4 py-3 border-b border-gray-100">
        <Text className="text-sm font-semibold text-gray-700">
          Assigned ({shift.assignments.length})
        </Text>
      </View>
      {shift.assignments.length === 0 ? (
        <View className="flex-1 items-center justify-center px-4">
          <Text className="text-gray-400 text-sm text-center">
            No volunteers assigned yet.{'\n'}Tap + on a volunteer to assign them.
          </Text>
        </View>
      ) : (
        <FlatList
          data={shift.assignments}
          keyExtractor={a => a.id}
          renderItem={({ item: a }) => (
            <AssignedRow
              assignment={a}
              onRemove={() => handleRemove(a)}
              busy={busyRemove === a.volunteer_id}
            />
          )}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-gray-50">
      <ShiftHeader shift={shift} dateFormat={dateFormat} />

      {isTablet ? (
        // Two panels side-by-side
        <View className="flex-1 flex-row">
          <View style={{ flex: 1 }}>{availablePanel}</View>
          <View style={{ flex: 1 }}>{assignedPanel}</View>
        </View>
      ) : (
        // Phone: tab toggle
        <View className="flex-1">
          <View className="flex-row bg-white border-b border-gray-200">
            {(['assigned', 'available'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                onPress={() => setPhoneTab(tab)}
                className={`flex-1 py-3 items-center border-b-2 ${
                  phoneTab === tab ? 'border-blue-600' : 'border-transparent'
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    phoneTab === tab ? 'text-blue-600' : 'text-gray-500'
                  }`}
                >
                  {tab === 'assigned'
                    ? `Assigned (${shift.assignments.length})`
                    : `Available (${available.length})`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {phoneTab === 'available' ? availablePanel : assignedPanel}
        </View>
      )}
    </View>
  )
}
