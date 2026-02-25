// app/(app)/shifts/new.tsx — Phase 3
// Create shift form. Date pre-populated from ?date= query param when coming from calendar.
// Uses React Hook Form + Zod; DateTimePicker for date, start time, and end time.
import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Modal, Platform, Pressable, Alert,
} from 'react-native'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { shiftsApi } from '../../../lib/api'
import { toISODate, toHHMM, formatTime } from '../../../lib/date'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const schema = z.object({
  title:                 z.string().min(1, 'Title is required'),
  location:              z.string().optional(),
  min_volunteers:        z.number().int().min(1, 'At least 1'),
  max_volunteers:        z.number().int().min(1, 'At least 1'),
  event_lead_first_name: z.string().min(1, 'Required'),
  event_lead_last_name:  z.string().min(1, 'Required'),
  event_lead_mobile:     z.string().optional(),
}).refine(d => d.max_volunteers >= d.min_volunteers, {
  message: 'Maximum must be ≥ minimum',
  path: ['max_volunteers'],
})

type FormValues = z.infer<typeof schema>
type PickerType = 'date' | 'start' | 'end'

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function NewShiftScreen() {
  const queryClient = useQueryClient()
  const params      = useLocalSearchParams<{ date?: string }>()

  const initialDate = params.date ? new Date(params.date + 'T12:00:00') : null

  const [shiftDate, setShiftDate]         = useState<Date | null>(initialDate)
  const [startTime, setStartTime]         = useState<Date | null>(null)
  const [endTime, setEndTime]             = useState<Date | null>(null)
  const [currentPicker, setCurrentPicker] = useState<PickerType | null>(null)
  const [submitting, setSubmitting]       = useState(false)

  const {
    control, handleSubmit, formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '', location: '',
      min_volunteers: 2, max_volunteers: 10,
      event_lead_first_name: '', event_lead_last_name: '', event_lead_mobile: '',
    },
  })

  // ── Submit ──────────────────────────────────────────────────────────────
  const onSubmit = async (values: FormValues) => {
    if (!shiftDate) { Alert.alert('Validation', 'Date is required.'); return }
    if (!startTime) { Alert.alert('Validation', 'Start time is required.'); return }
    if (!endTime)   { Alert.alert('Validation', 'End time is required.'); return }
    const s = toHHMM(startTime)
    const e = toHHMM(endTime)
    if (s >= e) { Alert.alert('Validation', 'End time must be after start time.'); return }

    setSubmitting(true)
    try {
      const res = await shiftsApi.create({
        title:                 values.title,
        date:                  toISODate(shiftDate),
        start_time:            s,
        end_time:              e,
        location:              values.location || undefined,
        min_volunteers:        values.min_volunteers,
        max_volunteers:        values.max_volunteers,
        event_lead_first_name: values.event_lead_first_name,
        event_lead_last_name:  values.event_lead_last_name,
        event_lead_mobile:     values.event_lead_mobile || undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
      router.replace(`/(app)/shifts/${res.data.id}`)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', detail ?? 'Failed to create shift.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Date/time picker helpers ─────────────────────────────────────────────
  const pickerValue = (): Date => {
    if (currentPicker === 'date')  return shiftDate  ?? new Date()
    if (currentPicker === 'start') return startTime  ?? new Date()
    return endTime ?? new Date()
  }

  const applyPickerValue = (date: Date) => {
    if (currentPicker === 'date')        setShiftDate(date)
    else if (currentPicker === 'start')  setStartTime(date)
    else                                 setEndTime(date)
  }

  const onAndroidChange = (event: DateTimePickerEvent, date?: Date) => {
    setCurrentPicker(null)
    if (event.type === 'set' && date) applyPickerValue(date)
  }

  const pickerTitle = currentPicker === 'date'  ? 'Shift Date'
    : currentPicker === 'start' ? 'Start Time'
    : 'End Time'
  const pickerMode: 'date' | 'time' = currentPicker === 'date' ? 'date' : 'time'

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-white">

      {/* Header */}
      <View className="bg-white border-b border-gray-200 px-4 py-4 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Text className="text-blue-600 text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-xl font-bold text-gray-900 flex-1">Create Shift</Text>
      </View>

      <ScrollView
        className="flex-1 px-4 py-5"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* ── Shift Details ── */}
        <Text className="text-xs font-semibold text-gray-400 uppercase mb-3">Shift Details</Text>

        {/* Title */}
        <View className="mb-4">
          <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Title *</Text>
          <Controller
            control={control}
            name="title"
            render={({ field }) => (
              <TextInput
                className={`px-3 py-2.5 border rounded-lg text-sm text-gray-900 ${
                  errors.title ? 'border-red-400 bg-red-50' : 'border-gray-200'
                }`}
                placeholder="e.g. Sunday Soup Kitchen"
                autoFocus
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          {errors.title && (
            <Text className="text-red-500 text-xs mt-1">{errors.title.message}</Text>
          )}
        </View>

        {/* Date + Start + End in one row */}
        <View className="flex-row mb-4" style={{ gap: 8 }}>
          <View className="flex-1">
            <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Date *</Text>
            <TouchableOpacity
              onPress={() => setCurrentPicker('date')}
              className="px-3 py-2.5 border border-gray-200 rounded-lg flex-row items-center justify-between"
            >
              <Text className={`text-sm ${shiftDate ? 'text-gray-900' : 'text-gray-400'}`}>
                {shiftDate ? toISODate(shiftDate) : 'Select'}
              </Text>
              <Text className="text-gray-400 text-xs">▾</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 0.75 }}>
            <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Start *</Text>
            <TouchableOpacity
              onPress={() => setCurrentPicker('start')}
              className="px-3 py-2.5 border border-gray-200 rounded-lg flex-row items-center justify-between"
            >
              <Text className={`text-sm ${startTime ? 'text-gray-900' : 'text-gray-400'}`}>
                {startTime ? formatTime(toHHMM(startTime) + ':00') : 'Time'}
              </Text>
              <Text className="text-gray-400 text-xs">▾</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 0.75 }}>
            <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">End *</Text>
            <TouchableOpacity
              onPress={() => setCurrentPicker('end')}
              className="px-3 py-2.5 border border-gray-200 rounded-lg flex-row items-center justify-between"
            >
              <Text className={`text-sm ${endTime ? 'text-gray-900' : 'text-gray-400'}`}>
                {endTime ? formatTime(toHHMM(endTime) + ':00') : 'Time'}
              </Text>
              <Text className="text-gray-400 text-xs">▾</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Location */}
        <View className="mb-6">
          <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Location</Text>
          <Controller
            control={control}
            name="location"
            render={({ field }) => (
              <TextInput
                className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900"
                placeholder="e.g. 123 Main St"
                value={field.value}
                onChangeText={field.onChange}
              />
            )}
          />
        </View>

        {/* ── Capacity ── */}
        <Text className="text-xs font-semibold text-gray-400 uppercase mb-3">Capacity</Text>
        <View className="flex-row mb-6" style={{ gap: 12 }}>
          <View className="flex-1">
            <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Min *</Text>
            <Controller
              control={control}
              name="min_volunteers"
              render={({ field }) => (
                <TextInput
                  className={`px-3 py-2.5 border rounded-lg text-sm text-gray-900 ${
                    errors.min_volunteers ? 'border-red-400 bg-red-50' : 'border-gray-200'
                  }`}
                  keyboardType="numeric"
                  value={String(field.value)}
                  onChangeText={t => field.onChange(Number(t.replace(/\D/g, '')) || 0)}
                  onBlur={field.onBlur}
                />
              )}
            />
            {errors.min_volunteers && (
              <Text className="text-red-500 text-xs mt-1">{errors.min_volunteers.message}</Text>
            )}
          </View>
          <View className="flex-1">
            <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Max *</Text>
            <Controller
              control={control}
              name="max_volunteers"
              render={({ field }) => (
                <TextInput
                  className={`px-3 py-2.5 border rounded-lg text-sm text-gray-900 ${
                    errors.max_volunteers ? 'border-red-400 bg-red-50' : 'border-gray-200'
                  }`}
                  keyboardType="numeric"
                  value={String(field.value)}
                  onChangeText={t => field.onChange(Number(t.replace(/\D/g, '')) || 0)}
                  onBlur={field.onBlur}
                />
              )}
            />
            {errors.max_volunteers && (
              <Text className="text-red-500 text-xs mt-1">{errors.max_volunteers.message}</Text>
            )}
          </View>
        </View>

        {/* ── Event Lead ── */}
        <Text className="text-xs font-semibold text-gray-400 uppercase mb-3">Event Lead</Text>
        <View className="flex-row mb-4" style={{ gap: 12 }}>
          <View className="flex-1">
            <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
              First Name *
            </Text>
            <Controller
              control={control}
              name="event_lead_first_name"
              render={({ field }) => (
                <TextInput
                  className={`px-3 py-2.5 border rounded-lg text-sm text-gray-900 ${
                    errors.event_lead_first_name ? 'border-red-400 bg-red-50' : 'border-gray-200'
                  }`}
                  placeholder="Jane"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            {errors.event_lead_first_name && (
              <Text className="text-red-500 text-xs mt-1">
                {errors.event_lead_first_name.message}
              </Text>
            )}
          </View>
          <View className="flex-1">
            <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
              Last Name *
            </Text>
            <Controller
              control={control}
              name="event_lead_last_name"
              render={({ field }) => (
                <TextInput
                  className={`px-3 py-2.5 border rounded-lg text-sm text-gray-900 ${
                    errors.event_lead_last_name ? 'border-red-400 bg-red-50' : 'border-gray-200'
                  }`}
                  placeholder="Smith"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            {errors.event_lead_last_name && (
              <Text className="text-red-500 text-xs mt-1">
                {errors.event_lead_last_name.message}
              </Text>
            )}
          </View>
        </View>

        <View className="mb-4">
          <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
            Event Lead Mobile
          </Text>
          <Controller
            control={control}
            name="event_lead_mobile"
            render={({ field }) => (
              <TextInput
                className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900"
                placeholder="+12125551234"
                keyboardType="phone-pad"
                value={field.value}
                onChangeText={field.onChange}
              />
            )}
          />
        </View>
      </ScrollView>

      {/* Footer */}
      <View className="bg-white border-t border-gray-100 px-4 py-4 flex-row items-center justify-between">
        <TouchableOpacity
          onPress={() => router.back()}
          className="px-4 py-2 border border-gray-200 rounded-lg"
        >
          <Text className="text-sm font-medium text-gray-600">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSubmit(onSubmit)}
          disabled={submitting}
          className={`px-6 py-2 bg-blue-600 rounded-lg ${submitting ? 'opacity-50' : ''}`}
        >
          <Text className="text-sm font-semibold text-white">
            {submitting ? 'Creating…' : 'Create Shift'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── iOS Picker Modal (single modal for date + times) ── */}
      {Platform.OS === 'ios' && currentPicker !== null && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setCurrentPicker(null)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
            onPress={() => setCurrentPicker(null)}
          >
            <Pressable className="bg-white rounded-t-2xl">
              <View className="flex-row items-center justify-between px-4 py-4 border-b border-gray-100">
                <TouchableOpacity onPress={() => setCurrentPicker(null)}>
                  <Text className="text-gray-500 text-base">Cancel</Text>
                </TouchableOpacity>
                <Text className="text-base font-semibold text-gray-900">{pickerTitle}</Text>
                <TouchableOpacity onPress={() => setCurrentPicker(null)}>
                  <Text className="text-blue-600 text-base font-medium">Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerValue()}
                mode={pickerMode}
                display="spinner"
                onChange={(_, date) => { if (date) applyPickerValue(date) }}
                minimumDate={pickerMode === 'date' ? new Date(2020, 0, 1) : undefined}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* ── Android Picker ── */}
      {Platform.OS === 'android' && currentPicker !== null && (
        <DateTimePicker
          value={pickerValue()}
          mode={pickerMode}
          display="default"
          onChange={onAndroidChange}
          minimumDate={pickerMode === 'date' ? new Date(2020, 0, 1) : undefined}
        />
      )}
    </View>
  )
}
