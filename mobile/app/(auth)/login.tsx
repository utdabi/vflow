// app/(auth)/login.tsx
// Sign-in screen for returning coordinators.
// Calls Supabase signInWithPassword — on success, Expo Router redirects to (app).

import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../../lib/supabase'

export default function LoginScreen() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)

  async function handleSignIn() {
    setError(null)
    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        setError('Invalid email or password. Please try again.')
      } else {
        router.replace('/(app)/')
      }
    } catch {
      setError('Something went wrong. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-gray-50"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 justify-center items-center px-6">
        {/* Logo / brand */}
        <View className="mb-8 items-center">
          <View className="w-14 h-14 rounded-2xl bg-blue-600 items-center justify-center mb-3">
            <Text className="text-white text-2xl font-bold">VF</Text>
          </View>
          <Text className="text-2xl font-bold text-gray-900">VolunteerFlow</Text>
          <Text className="text-sm text-gray-500 mt-1">Coordinator sign in</Text>
        </View>

        {/* Card */}
        <View className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-6">
          {error && (
            <View className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <Text className="text-sm text-red-700">{error}</Text>
            </View>
          )}

          <Text className="text-sm font-medium text-gray-700 mb-1">Email</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base text-gray-900 bg-white"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholder="you@example.com"
            placeholderTextColor="#9CA3AF"
          />

          <Text className="text-sm font-medium text-gray-700 mb-1">Password</Text>
          <TextInput
            className="border border-gray-300 rounded-lg px-4 py-3 mb-6 text-base text-gray-900 bg-white"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            placeholder="••••••••"
            placeholderTextColor="#9CA3AF"
            onSubmitEditing={handleSignIn}
          />

          <TouchableOpacity
            onPress={handleSignIn}
            disabled={loading}
            className="bg-blue-600 rounded-lg py-3 items-center"
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="white" />
              : <Text className="text-white text-base font-semibold">Sign in</Text>
            }
          </TouchableOpacity>
        </View>

        <Text className="mt-6 text-sm text-gray-400 text-center">
          New to VolunteerFlow?{'\n'}Check your email for your invite link.
        </Text>
      </View>
    </KeyboardAvoidingView>
  )
}
