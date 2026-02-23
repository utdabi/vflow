// analytics.ts
// Thin wrapper around PostHog so components never import posthog-js directly.
// Swap the implementation here if we ever change analytics providers.
//
// Initialisation happens in main.tsx before the React app renders.
// Events map directly to prd.md §2 Success Metrics.

import posthog from 'posthog-js'

export type AnalyticsEvent =
  | 'setup_completed'
  | 'volunteer_added'
  | 'volunteer_csv_imported'
  | 'shift_created'
  | 'shift_published'
  | 'assignment_added'
  | 'backup_finder_opened'
  | 'backup_request_sent'
  | 'api_key_created'

export const analytics = {
  /** Fire a named event with optional non-PII properties. */
  track(event: AnalyticsEvent, props?: Record<string, unknown>) {
    posthog.capture(event, props)
  },

  /** Associate subsequent events with this org UUID (no PII). */
  identify(orgId: string) {
    posthog.identify(orgId)
  },

  /** Clear the identity on logout so events are no longer tied to the org. */
  reset() {
    posthog.reset()
  },
}
