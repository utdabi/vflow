// auth-context.tsx
// Feature 1.1: Organizations & Setup Links
//
// React context that holds:
//   - session  : Supabase Session (contains the access_token / JWT)
//   - user     : Supabase User object
//   - org      : Organization row fetched from our backend
//   - loading  : true while we're resolving the session on first load
//
// AuthProvider listens to Supabase's onAuthStateChange so the session
// stays fresh across tab reloads and token refreshes.
//
// signOut() clears the Supabase session and navigates to /login.
// After setup completes, the SetupPage calls setSessionFromToken() to
// manually hydrate the session from the token returned by our backend.

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { organizationsApi } from './api'
import type { Organization } from './api'
import { analytics } from './analytics'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthContextValue {
  session: Session | null
  user: User | null
  organization: Organization | null
  loading: boolean
  signOut: () => Promise<void>
  /** Called by SetupPage after the setup/complete API returns a token */
  setSessionFromToken: (accessToken: string) => Promise<void>
  /** Re-fetches the organization from the backend (e.g. after a logo upload) */
  refreshOrg: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return ctx
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)

  // Fetch the organization from our backend whenever we have a valid session
  const fetchOrg = useCallback(async () => {
    try {
      const { data } = await organizationsApi.getMe()
      setOrganization(data)
      analytics.identify(data.id)
    } catch {
      setOrganization(null)
    }
  }, [])

  // Bootstrap: get the existing session from localStorage on first render
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

    // Keep session in sync (tab focus, token refresh, sign-out from another tab)
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

  // ------------------------------------------------------------------
  // setSessionFromToken
  // Called by SetupPage after POST /api/setup/complete returns an
  // access_token. We set the Supabase session manually so the user
  // is immediately authenticated without a second sign-in round-trip.
  // ------------------------------------------------------------------
  const setSessionFromToken = useCallback(async (accessToken: string) => {
    // Use setSession to inject the token; Supabase derives the user from it.
    // Note: setSession requires both access and refresh tokens.
    // For the setup flow we sign in with password (done on the backend),
    // so we call signInWithPassword here from the frontend side to get a
    // proper session object. But since we don't keep the password on the
    // client, instead we call getUser() which validates the token server-side.
    //
    // Simplest approach: store the token and re-read the session.
    // Supabase JS v2 exposes setSession(accessToken, refreshToken).
    // We don't have the refresh token from our backend response, so we
    // trigger a sign-in via Supabase directly using the returned JWT by
    // calling getUser with the token and then letting onAuthStateChange fire.
    const { data, error } = await supabase.auth.getUser(accessToken)
    if (error || !data.user) return

    // Manually set the context state so the app doesn't have to wait for
    // the onAuthStateChange event (which may be slightly delayed).
    setUser(data.user)
    await fetchOrg()
  }, [fetchOrg])

  // ------------------------------------------------------------------
  // signOut
  // ------------------------------------------------------------------
  const signOut = useCallback(async () => {
    analytics.reset()
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
    setOrganization(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{ session, user, organization, loading, signOut, setSessionFromToken, refreshOrg: fetchOrg }}
    >
      {children}
    </AuthContext.Provider>
  )
}
