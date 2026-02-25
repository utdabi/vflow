// app/(app)/volunteers/new.tsx — Phase 2
// Add volunteer form: two-tab layout (Basic info / Availability).
// Uses React Hook Form + Zod. DOB uses native DateTimePicker; gender uses a sheet modal.
import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Modal, Platform, Pressable,
} from 'react-native'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { volunteersApi } from '../../../lib/api'
import { toISODate } from '../../../lib/date'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const E164_RE = /^\+[1-9]\d{9,14}$/

const schema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name:  z.string().min(1, 'Last name is required'),
  mobile:     z.string().min(1, 'Mobile is required')
                .regex(E164_RE, 'Include country code, e.g. +12125551234'),
  email:      z.string().email('Invalid email').optional().or(z.literal('')),
  gender:     z.string().optional(),
  skills:     z.string().optional(),
  notes:      z.string().optional(),
})

type FormValues = z.infer<typeof schema>

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say', 'Other']
const DAY_LABELS     = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function NewVolunteerScreen() {
  const queryClient = useQueryClient()

  const [tab, setTab]                         = useState<'basic' | 'availability'>('basic')
  const [preferredDays, setPreferredDays]     = useState<number[]>([])
  const [dob, setDob]                         = useState<Date | null>(null)
  const [showDatePicker, setShowDatePicker]   = useState(false)
  const [showGenderModal, setShowGenderModal] = useState(false)
  const [submitting, setSubmitting]           = useState(false)
  const [apiError, setApiError]               = useState<string | null>(null)

  const {
    control, handleSubmit, trigger, setValue, watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      first_name: '', last_name: '', mobile: '',
      email: '', gender: '', skills: '', notes: '',
    },
  })

  const selectedGender = watch('gender')

  // ── Submit ──────────────────────────────────────────────────────────────
  const onSubmit = async (values: FormValues) => {
    setSubmitting(true)
    setApiError(null)
    try {
      await volunteersApi.create({
        first_name:     values.first_name,
        last_name:      values.last_name,
        gender:         values.gender || undefined,
        date_of_birth:  dob ? toISODate(dob) : undefined,
        email:          values.email || undefined,
        mobile:         values.mobile,
        skills:         values.skills
          ? values.skills.split(',').map(s => s.trim()).filter(Boolean)
          : [],
        notes:          values.notes || undefined,
        preferred_days: preferredDays,
      })
      queryClient.invalidateQueries({ queryKey: ['volunteers'] })
      router.back()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setApiError(detail ?? 'Failed to add volunteer. Please try again.')
      setTab('basic')
    } finally {
      setSubmitting(false)
    }
  }

  const goToAvailability = async () => {
    const ok = await trigger(['first_name', 'last_name', 'mobile', 'email'])
    if (ok) { setApiError(null); setTab('availability') }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-white">

      {/* Header */}
      <View className="bg-white border-b border-gray-200 px-4 py-4 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Text className="text-blue-600 text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-xl font-bold text-gray-900 flex-1">Add Volunteer</Text>
      </View>

      {/* Tabs */}
      <View className="flex-row border-b border-gray-200 bg-white px-4">
        {(['basic', 'availability'] as const).map((t, i) => (
          <TouchableOpacity
            key={t}
            onPress={() => { if (t === 'availability') goToAvailability(); else setTab('basic') }}
            className={`py-3 mr-6 border-b-2 ${tab === t ? 'border-blue-600' : 'border-transparent'}`}
          >
            <Text className={`text-sm font-medium ${tab === t ? 'text-blue-600' : 'text-gray-500'}`}>
              {i + 1}. {t === 'basic' ? 'Basic info' : 'Availability'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Form body */}
      <ScrollView
        className="flex-1 px-4 py-5"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        {apiError && (
          <View className="bg-red-50 border border-red-200 rounded-lg px-3 py-3 mb-4">
            <Text className="text-red-700 text-sm">{apiError}</Text>
          </View>
        )}

        {/* ── Tab 1: Basic info ── */}
        {tab === 'basic' && (
          <View style={{ gap: 16 }}>

            {/* First + Last Name */}
            <View className="flex-row" style={{ gap: 12 }}>
              <View className="flex-1">
                <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
                  First Name *
                </Text>
                <Controller
                  control={control}
                  name="first_name"
                  render={({ field }) => (
                    <TextInput
                      className={`px-3 py-2.5 border rounded-lg text-sm text-gray-900 ${
                        errors.first_name ? 'border-red-400 bg-red-50' : 'border-gray-200'
                      }`}
                      placeholder="Jane"
                      autoFocus
                      value={field.value}
                      onChangeText={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
                {errors.first_name && (
                  <Text className="text-red-500 text-xs mt-1">{errors.first_name.message}</Text>
                )}
              </View>
              <View className="flex-1">
                <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
                  Last Name *
                </Text>
                <Controller
                  control={control}
                  name="last_name"
                  render={({ field }) => (
                    <TextInput
                      className={`px-3 py-2.5 border rounded-lg text-sm text-gray-900 ${
                        errors.last_name ? 'border-red-400 bg-red-50' : 'border-gray-200'
                      }`}
                      placeholder="Smith"
                      value={field.value}
                      onChangeText={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
                {errors.last_name && (
                  <Text className="text-red-500 text-xs mt-1">{errors.last_name.message}</Text>
                )}
              </View>
            </View>

            {/* Mobile */}
            <View>
              <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Mobile *
              </Text>
              <Controller
                control={control}
                name="mobile"
                render={({ field }) => (
                  <TextInput
                    className={`px-3 py-2.5 border rounded-lg text-sm text-gray-900 ${
                      errors.mobile ? 'border-red-400 bg-red-50' : 'border-gray-200'
                    }`}
                    placeholder="+12125551234  (include country code)"
                    keyboardType="phone-pad"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
              {errors.mobile && (
                <Text className="text-red-500 text-xs mt-1">{errors.mobile.message}</Text>
              )}
            </View>

            {/* Email */}
            <View>
              <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Email</Text>
              <Controller
                control={control}
                name="email"
                render={({ field }) => (
                  <TextInput
                    className={`px-3 py-2.5 border rounded-lg text-sm text-gray-900 ${
                      errors.email ? 'border-red-400 bg-red-50' : 'border-gray-200'
                    }`}
                    placeholder="jane@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
              {errors.email && (
                <Text className="text-red-500 text-xs mt-1">{errors.email.message}</Text>
              )}
            </View>

            {/* Gender + DOB */}
            <View className="flex-row" style={{ gap: 12 }}>
              {/* Gender */}
              <View className="flex-1">
                <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
                  Gender
                </Text>
                <TouchableOpacity
                  onPress={() => setShowGenderModal(true)}
                  className="px-3 py-2.5 border border-gray-200 rounded-lg flex-row items-center justify-between"
                >
                  <Text className={`text-sm ${selectedGender ? 'text-gray-900' : 'text-gray-400'}`}>
                    {selectedGender || '— select —'}
                  </Text>
                  <Text className="text-gray-400">▾</Text>
                </TouchableOpacity>
              </View>

              {/* DOB */}
              <View className="flex-1">
                <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
                  Date of Birth
                </Text>
                <TouchableOpacity
                  onPress={() => setShowDatePicker(true)}
                  className="px-3 py-2.5 border border-gray-200 rounded-lg flex-row items-center justify-between"
                >
                  <Text className={`text-sm ${dob ? 'text-gray-900' : 'text-gray-400'}`}>
                    {dob ? toISODate(dob) : 'Optional'}
                  </Text>
                  <Text className="text-gray-400">▾</Text>
                </TouchableOpacity>
                {dob && (
                  <TouchableOpacity onPress={() => setDob(null)} className="mt-1">
                    <Text className="text-xs text-gray-400">Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}

        {/* ── Tab 2: Availability ── */}
        {tab === 'availability' && (
          <View style={{ gap: 16 }}>
            <View className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              <Text className="text-xs text-blue-700">
                Optional — helps the backup finder suggest this volunteer for the right shifts.
              </Text>
            </View>

            {/* Preferred Days */}
            <View>
              <Text className="text-xs font-semibold text-gray-500 uppercase mb-2">
                Preferred Days
              </Text>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {DAY_LABELS.map((day, i) => (
                  <TouchableOpacity
                    key={day}
                    onPress={() =>
                      setPreferredDays(prev =>
                        prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i],
                      )
                    }
                    className={`px-4 py-2 rounded-lg border ${
                      preferredDays.includes(i)
                        ? 'bg-blue-600 border-blue-600'
                        : 'bg-white border-gray-200'
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        preferredDays.includes(i) ? 'text-white' : 'text-gray-600'
                      }`}
                    >
                      {day}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Skills */}
            <View>
              <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
                Skills (comma-separated)
              </Text>
              <Controller
                control={control}
                name="skills"
                render={({ field }) => (
                  <TextInput
                    className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900"
                    placeholder="first aid, driving, cooking"
                    value={field.value}
                    onChangeText={field.onChange}
                    autoCorrect={false}
                  />
                )}
              />
            </View>

            {/* Notes */}
            <View>
              <Text className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Notes</Text>
              <Controller
                control={control}
                name="notes"
                render={({ field }) => (
                  <TextInput
                    className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900"
                    placeholder="Anything useful to know about this volunteer"
                    multiline
                    textAlignVertical="top"
                    style={{ minHeight: 90 }}
                    value={field.value}
                    onChangeText={field.onChange}
                  />
                )}
              />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <View className="bg-white border-t border-gray-100 px-4 py-4 flex-row items-center justify-between">
        <TouchableOpacity
          onPress={() => router.back()}
          className="px-4 py-2 border border-gray-200 rounded-lg"
        >
          <Text className="text-sm font-medium text-gray-600">Cancel</Text>
        </TouchableOpacity>

        {tab === 'basic' ? (
          <TouchableOpacity
            onPress={goToAvailability}
            className="px-5 py-2 bg-blue-600 rounded-lg"
          >
            <Text className="text-sm font-semibold text-white">Next: Availability →</Text>
          </TouchableOpacity>
        ) : (
          <View className="flex-row" style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={() => setTab('basic')}
              className="px-4 py-2 border border-gray-200 rounded-lg"
            >
              <Text className="text-sm font-medium text-gray-600">← Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSubmit(onSubmit)}
              disabled={submitting}
              className={`px-5 py-2 bg-blue-600 rounded-lg ${submitting ? 'opacity-50' : ''}`}
            >
              <Text className="text-sm font-semibold text-white">
                {submitting ? 'Adding…' : 'Add Volunteer'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── Gender picker modal ── */}
      <Modal
        visible={showGenderModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGenderModal(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
          onPress={() => setShowGenderModal(false)}
        >
          <Pressable className="bg-white rounded-t-2xl pb-8">
            <View className="flex-row items-center justify-between px-4 py-4 border-b border-gray-100">
              <Text className="text-base font-semibold text-gray-900">Select Gender</Text>
              <TouchableOpacity onPress={() => setShowGenderModal(false)}>
                <Text className="text-blue-600 text-base font-medium">Done</Text>
              </TouchableOpacity>
            </View>
            {GENDER_OPTIONS.map(g => (
              <TouchableOpacity
                key={g}
                onPress={() => { setValue('gender', g); setShowGenderModal(false) }}
                className="px-4 py-4 border-b border-gray-50 flex-row items-center justify-between"
              >
                <Text
                  className={`text-base ${
                    selectedGender === g ? 'text-blue-600 font-semibold' : 'text-gray-900'
                  }`}
                >
                  {g}
                </Text>
                {selectedGender === g && <Text className="text-blue-600">✓</Text>}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => { setValue('gender', ''); setShowGenderModal(false) }}
              className="px-4 py-4"
            >
              <Text className="text-base text-gray-400 text-center">Clear selection</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── iOS Date Picker Modal ── */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showDatePicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDatePicker(false)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
            onPress={() => setShowDatePicker(false)}
          >
            <Pressable className="bg-white rounded-t-2xl">
              <View className="flex-row items-center justify-between px-4 py-4 border-b border-gray-100">
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text className="text-gray-500 text-base">Cancel</Text>
                </TouchableOpacity>
                <Text className="text-base font-semibold text-gray-900">Date of Birth</Text>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text className="text-blue-600 text-base font-medium">Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={dob ?? new Date(1990, 0, 1)}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                minimumDate={new Date(1900, 0, 1)}
                onChange={(_, date) => {
                  if (date) setDob(date)
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* ── Android Date Picker ── */}
      {Platform.OS === 'android' && showDatePicker && (
        <DateTimePicker
          value={dob ?? new Date(1990, 0, 1)}
          mode="date"
          display="default"
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
          onChange={(event, date) => {
            setShowDatePicker(false)
            if (event.type === 'set' && date) setDob(date)
          }}
        />
      )}
    </View>
  )
}
