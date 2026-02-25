// TermsPage.tsx
// Feature 1.1: Organizations & Setup Links
//
// Public page at /terms — linked from the ToS consent checkbox on the setup form.
// Content is gated by the 'enable-tos-page' LaunchDarkly flag:
//   false (default) → "coming soon" stub
//   true            → real Terms of Service content (Termly embed or static copy)

import { useFlags } from 'launchdarkly-react-client-sdk'
import AppNav from '../../components/AppNav'

export default function TermsPage() {
  const { enableTosPage } = useFlags()

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav showSignOut={false} />
      <div className="max-w-3xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-6">Terms of Service</h1>

        {enableTosPage ? (
          // Real Terms of Service content goes here.
          // Replace with a Termly embed script or static legal copy when ready.
          <div className="prose prose-sm text-gray-700">
            <p>Terms of Service content coming soon.</p>
          </div>
        ) : (
          <div className="rounded-md bg-blue-50 p-6 text-center">
            <p className="text-sm text-blue-800">
              Our Terms of Service are being prepared and will be published here shortly.
            </p>
            <p className="mt-3 text-sm text-blue-600">
              Questions?{' '}
              <a href="mailto:support@volunteerflow.net" className="underline">
                Contact support
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
