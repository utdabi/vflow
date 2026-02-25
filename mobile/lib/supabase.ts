// lib/supabase.ts
// Supabase client for React Native.
// Uses AsyncStorage instead of localStorage for session persistence.
// All database reads/writes go through the FastAPI backend — this client
// is used only for auth (sign-in, sign-out, session listening).

import { createClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[VolunteerFlow] Missing Supabase env vars. ' +
    'Fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in mobile/.env',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,          // persist session in AsyncStorage (RN safe)
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,      // no URL-based OAuth flow in this app
  },
})
