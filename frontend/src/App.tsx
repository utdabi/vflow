// App.tsx
// Feature 1.1: Organizations & Setup Links
// Feature 4.3: Shift Scheduling — /shifts (calendar), /shifts/new, /shifts/:id
// Feature 4.3a: Data Quality — /volunteers/duplicates (duplicate detection + merge)
// Feature 4.5: Hours Tracking — added /reports/hours and /shared/reports/:token
// Top-level route configuration.
//
// Public routes:
//   /login                      — returning coordinators sign in
//   /setup                      — one-time invite link setup (no auth required)
//   /terms                      — Terms of Service (content gated by enable-tos-page LD flag)
//   /shared/reports/:token      — read-only shared report (no auth required)
//
// Protected routes (require authentication via <PrivateRoute>):
//   /dashboard              — main app entry point after login
//   /shifts                 — monthly calendar shift scheduling
//   /shifts/new             — create shift + assign volunteers (ShiftEditPage)
//   /shifts/:id             — view/edit shift + assign volunteers (ShiftEditPage)
//   /volunteers/duplicates  — data quality: find and merge duplicate volunteers (must come before /volunteers)
//   /volunteers             — volunteer list management
//   /reports/hours          — volunteer hours report with share link
//   /                       — redirects to /dashboard

import { Routes, Route, Navigate } from 'react-router-dom'
import { PrivateRoute } from './components/PrivateRoute'
import SetupPage from './pages/setup/SetupPage'
import LoginPage from './pages/login/LoginPage'
import DashboardPage from './pages/dashboard/DashboardPage'
import VolunteersPage from './pages/volunteers/VolunteersPage'
import DuplicatesPage from './pages/volunteers/DuplicatesPage'
import ShiftsPage from './pages/shifts/ShiftsPage'
import ShiftEditPage from './pages/shifts/ShiftEditPage'
import TermsPage from './pages/terms/TermsPage'

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/terms" element={<TermsPage />} />

      {/* Protected routes */}
      <Route
        path="/dashboard"
        element={
          <PrivateRoute>
            <DashboardPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/shifts"
        element={
          <PrivateRoute>
            <ShiftsPage />
          </PrivateRoute>
        }
      />
      {/* /shifts/new must be declared before /shifts/:id so React Router doesn't treat "new" as an ID */}
      <Route
        path="/shifts/new"
        element={
          <PrivateRoute>
            <ShiftEditPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/shifts/:id"
        element={
          <PrivateRoute>
            <ShiftEditPage />
          </PrivateRoute>
        }
      />
      {/* /volunteers/duplicates must be declared before /volunteers so it isn't caught as a sub-path */}
      <Route
        path="/volunteers/duplicates"
        element={
          <PrivateRoute>
            <DuplicatesPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/volunteers"
        element={
          <PrivateRoute>
            <VolunteersPage />
          </PrivateRoute>
        }
      />

      {/* Redirect root to dashboard (PrivateRoute will redirect to /login if not authed) */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Catch-all: redirect unknown paths to dashboard */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
