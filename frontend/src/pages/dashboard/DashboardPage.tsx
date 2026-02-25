// DashboardPage.tsx
// Feature 1.1: Organizations & Setup Links
// Feature 1.2 (update): added Volunteers nav link and checklist shortcut.
// Logo feature: uses shared AppNav — coordinators can upload their org logo
//               by hovering over the logo mark and clicking the pencil icon.

import { Link } from 'react-router-dom'
import { useFlags } from 'launchdarkly-react-client-sdk'
import { useAuth } from '../../lib/auth-context'
import AppNav, { APP_NAV_LINKS } from '../../components/AppNav'

export default function DashboardPage() {
  const { user, organization } = useAuth()
  const { enableBackupFinder } = useFlags()

  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? 'Coordinator'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Shared nav bar — logo editable via pencil icon on hover */}
      <AppNav links={APP_NAV_LINKS} />

      {/* Page body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">
            Welcome, {fullName}! 👋
          </h1>
          <p className="mt-3 text-lg text-gray-500">
            Coordinator{organization?.name ? ` · ${organization.name}` : ''}
          </p>

          {/* Getting-started checklist — will be replaced by real dashboard in Feature 5.1 */}
          <div className="mt-10 max-w-md mx-auto bg-white rounded-lg shadow divide-y divide-gray-200 text-left">
            <div className="px-6 py-4">
              <p className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Next steps
              </p>
            </div>
            <div className="px-6 py-4 flex items-start gap-3">
              <span className="text-green-500 mt-0.5">✓</span>
              <div>
                <p className="text-sm font-medium text-gray-900">Account set up</p>
                <p className="text-xs text-gray-500">Done</p>
              </div>
            </div>
            <Link to="/volunteers" className="px-6 py-4 flex items-start gap-3 hover:bg-blue-50 transition-colors">
              <span className="text-blue-400 mt-0.5">→</span>
              <div>
                <p className="text-sm font-medium text-blue-700">Add &amp; import volunteers</p>
                <p className="text-xs text-gray-500">Click to manage your volunteer list</p>
              </div>
            </Link>
            <Link to="/shifts" className="px-6 py-4 flex items-start gap-3 hover:bg-blue-50 transition-colors">
              <span className="text-blue-400 mt-0.5">→</span>
              <div>
                <p className="text-sm font-medium text-blue-700">Create &amp; manage shifts</p>
                <p className="text-xs text-gray-500">Click to open the shift calendar</p>
              </div>
            </Link>
            {enableBackupFinder && (
              <Link to="/shifts" className="px-6 py-4 flex items-start gap-3 hover:bg-blue-50 transition-colors">
                <span className="text-blue-400 mt-0.5">→</span>
                <div>
                  <p className="text-sm font-medium text-blue-700">Use the backup finder</p>
                  <p className="text-xs text-gray-500">Cancel a volunteer on any shift to find a backup</p>
                </div>
              </Link>
            )}
          </div>

          <p className="mt-8 text-sm text-gray-400">
            Questions?{' '}
            <a
              href="mailto:support@volunteerflow.net"
              className="text-blue-600 underline"
            >
              Contact support
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}
