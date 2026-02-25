// app/(auth)/setup.tsx
// One-time invite link setup screen.
// Reached via deep link: volunteerflow://setup?token=<uuid>
// Validates token → shows account creation form → signs user in.

import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { setupApi, organizationsApi } from '../../lib/api'
import { supabase } from '../../lib/supabase'

type TokenState = 'loading' | 'valid' | 'expired' | 'used' | 'not_found' | 'error'

export default function SetupScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>()

  const [tokenState, setTokenState]         = useState<TokenState>('loading')
  const [orgName, setOrgName]               = useState('')
  const [fullName, setFullName]             = useState('')
  const [email, setEmail]                   = useState('')
  const [password, setPassword]             = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [dateFormat, setDateFormat]         = useState<'INTL' | 'US'>('INTL')
  const [submitting, setSubmitting]         = useState(false)
  const [formError, setFormError]           = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setTokenState('not_found'); return }
    setupApi.validateToken(token)
      .then(({ data }) => {
        setOrgName(data.organization_name)
        setTokenState('valid')
      })
      .catch((err) => {
        const status = err?.response?.status
        if (status === 409) setTokenState('used')
        else if (status === 410) setTokenState('expired')
        else if (status === 404) setTokenState('not_found')
        else setTokenState('error')
      })
  }, [token])

  async function handleSubmit() {
    if (!token) return
    setFormError(null)

    if (!fullName.trim() || fullName.trim().length < 2) {
      return setFormError('Full name must be at least 2 characters.')
    }
    if (!email.trim()) return setFormError('Email is required.')
    if (password.length < 8) return setFormError('Password must be at least 8 characters.')
    if (password !== confirmPassword) return setFormError('Passwords do not match.')

    setSubmitting(true)
    try {
      const { data } = await setupApi.completeSetup({
        token, email, password, full_name: fullName.trim(),
      })
      // Sign in with the credentials we just created
      await supabase.auth.signInWithPassword({ email, password })
      // Save date format preference
      await organizationsApi.updateMe({ date_format: dateFormat })
      console.log('[Setup] Complete for org:', data.organization_id)
      router.replace('/(app)/')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(msg ?? 'Setup failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Error states ────────────────────────────────────────────────────────
  if (tokenState === 'loading') {
    return (
      <View className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#2563EB" />
        <Text className="mt-4 text-gray-500">Validating invite link…</Text>
      </View>
    )
  }

  if (tokenState !== 'valid') {
    const messages: Record<TokenState, string> = {
      expired: 'This invite link has expired. Ask your admin to send a new one.',
      used: 'This invite link has already been used.',
      not_found: 'Invite link not found. Please check the URL.',
      error: 'Something went wrong. Please try again.',
      loading: '', valid: '',
    }
    return (
      <View className="flex-1 bg-gray-50 items-center justify-center px-6">
        <Text className="text-lg font-semibold text-gray-900 mb-2">Invalid Link</Text>
        <Text className="text-sm text-gray-500 text-center">{messages[tokenState]}</Text>
      </View>
    )
  }

  // ── Setup form ───────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-gray-50"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerClassName="flex-grow justify-center items-center px-6 py-10">
        <View className="w-full max-w-sm">
          <Text className="text-2xl font-bold text-gray-900 mb-1">Welcome to VolunteerFlow</Text>
          <Text className="text-sm text-gray-500 mb-6">Setting up: <Text className="font-medium text-gray-700">{orgName}</Text></Text>

          {formError && (
            <View className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <Text className="text-sm text-red-700">{formError}</Text>
            </View>
          )}

          {/* Full name */}
          <Text className="text-sm font-medium text-gray-700 mb-1">Full name</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base text-gray-900 bg-white"
            value={fullName} onChangeText={setFullName}
            autoCapitalize="words" placeholder="Jane Smith" placeholderTextColor="#9CA3AF"
          />

          {/* Email */}
          <Text className="text-sm font-medium text-gray-700 mb-1">Email</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base text-gray-900 bg-white"
            value={email} onChangeText={setEmail}
            autoCapitalize="none" keyboardType="email-address" autoComplete="email"
            placeholder="you@example.com" placeholderTextColor="#9CA3AF"
          />

          {/* Password */}
          <Text className="text-sm font-medium text-gray-700 mb-1">Password</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base text-gray-900 bg-white"
            value={password} onChangeText={setPassword}
            secureTextEntry placeholder="Min 8 characters" placeholderTextColor="#9CA3AF"
          />

          {/* Confirm password */}
          <Text className="text-sm font-medium text-gray-700 mb-1">Confirm password</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 mb-6 text-base text-gray-900 bg-white"
            value={confirmPassword} onChangeText={setConfirmPassword}
            secureTextEntry placeholder="Re-enter password" placeholderTextColor="#9CA3AF"
          />

          {/* Date format */}
          <Text className="text-sm font-medium text-gray-700 mb-2">Date format</Text>
          <View className="flex-row gap-3 mb-6">
            {(['INTL', 'US'] as const).map((fmt) => (
              <TouchableOpacity
                key={fmt}
                onPress={() => setDateFormat(fmt)}
                className={`flex-1 border rounded-lg py-2.5 items-center ${
                  dateFormat === fmt
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-300 bg-white'
                }`}
              >
                <Text className={`text-sm font-medium ${dateFormat === fmt ? 'text-blue-700' : 'text-gray-600'}`}>
                  {fmt === 'INTL' ? 'DD/MM/YYYY' : 'MM/DD/YYYY'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting}
            className="bg-blue-600 rounded-lg py-3 items-center"
            activeOpacity={0.8}
          >
            {submitting
              ? <ActivityIndicator color="white" />
              : <Text className="text-white text-base font-semibold">Create account &amp; continue</Text>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
