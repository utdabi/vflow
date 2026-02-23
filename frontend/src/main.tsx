// main.tsx
// Feature 1.1: Organizations & Setup Links
// React app entry point. Wraps the app in:
//   - LDProvider           (LaunchDarkly feature flags — prd.md §4.4)
//   - QueryClientProvider  (TanStack Query for server-state caching)
//   - BrowserRouter        (React Router v6 client-side routing)
//   - AuthProvider         (Supabase session + organization context)

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LDProvider } from 'launchdarkly-react-client-sdk'
import posthog from 'posthog-js'
import { AuthProvider } from './lib/auth-context'
import App from './App'
import './index.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = (import.meta as any).env ?? {}

// ---------------------------------------------------------------------------
// PostHog — analytics (prd.md §9)
// autocapture disabled: the app handles sensitive volunteer data (names, DOBs,
// mobiles) in forms. Explicit track() calls in components cover all metrics.
// maskAllInputs ensures session recordings never capture form field content.
// ---------------------------------------------------------------------------
const POSTHOG_KEY: string = env.VITE_POSTHOG_KEY ?? ''
if (POSTHOG_KEY && !POSTHOG_KEY.includes('your-key')) {
  posthog.init(POSTHOG_KEY, {
    api_host: 'https://eu.i.posthog.com',
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: false,
    session_recording: {
      maskAllInputs: true,
    },
    loaded: (ph) => {
      if (env.DEV) ph.debug()
    },
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
})

const LD_CLIENT_ID: string = env.VITE_LAUNCHDARKLY_CLIENT_ID ?? ''

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* LDProvider uses an anonymous context; flags are evaluated server-side per org. */}
    <LDProvider
      clientSideID={LD_CLIENT_ID}
      context={{ kind: 'user', key: 'anonymous' }}
      options={{ streaming: false }}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </LDProvider>
  </React.StrictMode>,
)
