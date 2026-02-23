// PrivateRoute.tsx
// Feature 1.1: Organizations & Setup Links
//
// Route wrapper that redirects unauthenticated users to /login.
// Shows a full-screen spinner while the initial session check is in-flight
// (avoids a flash of the login page for already-authenticated users).

import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'

interface PrivateRouteProps {
  children: React.ReactNode
}

export function PrivateRoute({ children }: PrivateRouteProps) {
  const { user, loading } = useAuth()

  // Still resolving session from localStorage — show a neutral loading screen
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-r-transparent" />
          <p className="mt-3 text-sm text-gray-500">Loading…</p>
        </div>
      </div>
    )
  }

  // Not authenticated — redirect to login
  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
