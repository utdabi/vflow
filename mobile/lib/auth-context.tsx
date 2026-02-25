// lib/auth-context.tsx
// Ported from frontend/src/lib/auth-context.tsx.
// Changes from web:
//   - Removed analytics.identify / analytics.reset (no PostHog in Phase 1)
//   - Navigation uses expo-router's router.replace() instead of React Router
//   - AsyncStorage-backed Supabase session (see lib/supabase.ts)

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { router } from 'expo-router'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { organizationsApi } from './api'
import type { Organization } from './api'

interface AuthContextValue {
  session: Session | null
  user: User | null
  organization: Organization | null
  loading: boolean
  signOut: () => Promise<void>
  setSessionFromToken: (accessToken: string) => Promise<void>
  refreshOrg: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchOrg = useCallback(async () => {
    try {
      const { data } = await organizationsApi.getMe()
      setOrganization(data)
    } catch {
      setOrganization(null)
    }
  }, [])

  // Bootstrap: restore session from AsyncStorage on first render
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session
      setSession(s)
      setUser(s?.user ?? null)
      if (s) {
        fetchOrg().finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    // Keep session in sync (token refresh, sign-out)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s) {
        fetchOrg()
      } else {
        setOrganization(null)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [fetchOrg])

  const setSessionFromToken = useCallback(async (accessToken: string) => {
    const { data, error } = await supabase.auth.getUser(accessToken)
    if (error || !data.user) return
    setUser(data.user)
    await fetchOrg()
  }, [fetchOrg])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
    setOrganization(null)
    router.replace('/(auth)/login')
  }, [])

  return (
    <AuthContext.Provider
      value={{ session, user, organization, loading, signOut, setSessionFromToken, refreshOrg: fetchOrg }}
    >
      {children}
    </AuthContext.Provider>
  )
}
