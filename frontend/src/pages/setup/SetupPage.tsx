// SetupPage.tsx
// Feature 1.1: Organizations & Setup Links
//
// The one-time setup flow that coordinators land on from their invite link.
// Logo feature: uses shared AppNav so the brand mark appears on every state
//               of this page (loading, error, form).

import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { setupApi, organizationsApi } from '../../lib/api'
import { useAuth } from '../../lib/auth-context'
import { analytics } from '../../lib/analytics'
import { supabase } from '../../lib/supabase'
import AppNav from '../../components/AppNav'
import { dateFormatExample } from '../../lib/date-format'

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const setupSchema = z
  .object({
    email: z.string().email('Please enter a valid email address'),
    full_name: z.string().min(2, 'Please enter your full name'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character (e.g. ! @ # $)'),
    confirm_password: z.string(),
    date_format: z.enum(['US', 'INTL']),
    tos_agreed: z
      .boolean()
      .refine((val) => val === true, {
        message: 'You must agree to the Terms of Service to continue',
      }),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })

type SetupFormValues = z.infer<typeof setupSchema>

// ---------------------------------------------------------------------------
// Token validation state
// ---------------------------------------------------------------------------

type TokenState =
  | { status: 'loading' }
  | { status: 'valid'; organizationId: string; organizationName: string }
  | { status: 'expired' }
  | { status: 'used' }
  | { status: 'not_found' }
  | { status: 'error'; message: string }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SetupPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setSessionFromToken } = useAuth()
  const token = searchParams.get('token') ?? ''

  const [tokenState, setTokenState] = useState<TokenState>({ status: 'loading' })
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { date_format: 'INTL', tos_agreed: false },
    mode: 'onChange',   // validate as user types so mismatch shows immediately
  })

  const selectedDateFormat = watch('date_format')
  const watchedPassword = watch('password')
  const watchedConfirm  = watch('confirm_password')
  const passwordsMatch  = !watchedConfirm || watchedPassword === watchedConfirm

  // ------------------------------------------------------------------
  // Validate token on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!token) {
      setTokenState({ status: 'not_found' })
      return
    }

    setupApi
      .validateToken(token)
      .then(({ data }) => {
        setTokenState({
          status: 'valid',
          organizationId: data.organization_id,
          organizationName: data.organization_name,
        })
      })
      .catch((err) => {
        const status: number = err?.response?.status
        if (status === 410) setTokenState({ status: 'expired' })
        else if (status === 409) setTokenState({ status: 'used' })
        else if (status === 404) setTokenState({ status: 'not_found' })
        else
          setTokenState({
            status: 'error',
            message: 'Unable to validate your link. Please try again or contact support.',
          })
      })
  }, [token])

  // ------------------------------------------------------------------
  // Submit handler
  // ------------------------------------------------------------------
  const onSubmit = async (values: SetupFormValues) => {
    setSubmitError(null)
    setSubmitting(true)

    try {
      const { data } = await setupApi.completeSetup({
        token,
        email: values.email,
        password: values.password,
        full_name: values.full_name,
      })

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      })

      if (signInError) {
        await setSessionFromToken(data.access_token)
      }

      // Save the chosen date format against the org.
      // The API call is authenticated because signInWithPassword above
      // has already stored the session in Supabase's localStorage store,
      // so the api.ts interceptor will pick up the JWT automatically.
      try {
        await organizationsApi.updateMe({ date_format: values.date_format })
      } catch {
        // Non-fatal — the org can change this later; proceed to dashboard.
      }

      analytics.track('setup_completed')
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const response = (err as { response?: { data?: { detail?: string }; status?: number } })
        ?.response
      const status = response?.status
      const detail = response?.data?.detail

      if (status === 409) {
        setSubmitError(detail ?? 'An account with this email already exists.')
      } else if (status === 410) {
        setTokenState({ status: 'expired' })
      } else {
        setSubmitError(detail ?? 'Something went wrong. Please try again or contact support.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  if (tokenState.status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppNav showSignOut={false} />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 64px)' }}>
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-r-transparent" />
            <p className="mt-3 text-sm text-gray-500">Checking your invite link…</p>
          </div>
        </div>
      </div>
    )
  }

  if (tokenState.status === 'expired') {
    return <TokenErrorScreen message="This setup link has expired. Please contact support for a new one." />
  }

  if (tokenState.status === 'used') {
    return <TokenErrorScreen message="This setup link has already been used. If you need access, please contact support." />
  }

  if (tokenState.status === 'not_found') {
    return <TokenErrorScreen message="Setup link not found. Please check the link in your email or contact support." />
  }

  if (tokenState.status === 'error') {
    return <TokenErrorScreen message={tokenState.message} />
  }

  // tokenState.status === 'valid' — show the form
  const { organizationName } = tokenState

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav bar — no sign-out, no links, always VF brand mark on setup page */}
      <AppNav showSignOut={false} forceBrandLogo />

      <div className="flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2 className="text-center text-3xl font-extrabold text-gray-900">
            Create your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Set up your coordinator account to get started.
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">

            {/* Organization name (read-only) */}
            <div className="mb-6 rounded-md bg-blue-50 p-4">
              <p className="text-sm text-blue-800">
                <span className="font-medium">Organization:</span> {organizationName}
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
              {/* Full name */}
              <div>
                <label htmlFor="full_name" className="block text-sm font-medium text-gray-700">
                  Your full name
                </label>
                <input
                  id="full_name"
                  type="text"
                  autoComplete="name"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  {...register('full_name')}
                />
                {errors.full_name && (
                  <p className="mt-1 text-xs text-red-600">{errors.full_name.message}</p>
                )}
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  {...register('email')}
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  {...register('password')}
                />
                {/* Live password requirements checklist */}
                {(watchedPassword !== undefined) && (
                  <ul className="mt-2 space-y-0.5">
                    {[
                      { ok: (watchedPassword?.length ?? 0) >= 8,          label: '8 or more characters' },
                      { ok: /[A-Z]/.test(watchedPassword ?? ''),           label: 'One uppercase letter' },
                      { ok: /[0-9]/.test(watchedPassword ?? ''),           label: 'One number' },
                      { ok: /[^A-Za-z0-9]/.test(watchedPassword ?? ''),   label: 'One special character (e.g. ! @ # $)' },
                    ].map(({ ok, label }) => (
                      <li key={label} className={`text-xs flex items-center gap-1 ${ok ? 'text-green-600' : 'text-gray-400'}`}>
                        <span className="font-bold">{ok ? '✓' : '○'}</span> {label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Confirm password — live mismatch feedback */}
              <div>
                <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700">
                  Confirm password
                </label>
                <input
                  id="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1
                    ${!passwordsMatch
                      ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
                    }`}
                  {...register('confirm_password')}
                />
                {/* Show live mismatch OR the submit-time zod error */}
                {watchedConfirm && !passwordsMatch && (
                  <p className="mt-1 text-xs text-red-600">Passwords do not match</p>
                )}
                {passwordsMatch && errors.confirm_password && (
                  <p className="mt-1 text-xs text-red-600">{errors.confirm_password.message}</p>
                )}
              </div>

              {/* ── Date format preference ── */}
              <div>
                <p className="block text-sm font-medium text-gray-700 mb-2">
                  Date format for your organisation
                </p>
                <p className="text-xs text-gray-500 mb-3">
                  This affects how <strong>all dates</strong> are displayed throughout the app —
                  volunteer date of birth, last worked date, shift history — and the
                  format expected in CSV imports.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { value: 'INTL', label: 'International', pattern: 'DD/MM/YYYY', eg: dateFormatExample('INTL') },
                      { value: 'US',   label: 'United States', pattern: 'MM/DD/YYYY', eg: dateFormatExample('US')   },
                    ] as const
                  ).map(({ value, label, pattern, eg }) => (
                    <label
                      key={value}
                      className={`
                        flex flex-col gap-0.5 rounded-lg border-2 p-3 cursor-pointer transition-colors
                        ${selectedDateFormat === value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'}
                      `}
                    >
                      <input type="radio" value={value} {...register('date_format')} className="sr-only" />
                      <span className="text-sm font-medium text-gray-900">{label}</span>
                      <span className="text-xs font-mono text-blue-600">{pattern}</span>
                      <span className="text-xs text-gray-400">e.g. {eg}</span>
                    </label>
                  ))}
                </div>
                {errors.date_format && (
                  <p className="mt-1 text-xs text-red-600">{errors.date_format.message}</p>
                )}
              </div>

              {/* ── Terms of Service consent ── */}
              <div className="flex items-start gap-3">
                <input
                  id="tos_agreed"
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  {...register('tos_agreed')}
                />
                <label htmlFor="tos_agreed" className="text-sm text-gray-700">
                  I agree to the{' '}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline"
                  >
                    Terms of Service
                  </a>
                </label>
              </div>
              {errors.tos_agreed && (
                <p className="-mt-3 text-xs text-red-600">{errors.tos_agreed.message}</p>
              )}

              {/* Submit error */}
              {submitError && (
                <div className="rounded-md bg-red-50 p-3">
                  <p className="text-sm text-red-800">{submitError}</p>
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? 'Creating your account…' : 'Create account & continue'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Token error screen — reused for expired / used / not found
// ---------------------------------------------------------------------------

function TokenErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav showSignOut={false} />
      <div className="flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 text-center">
            <div className="text-4xl mb-4">🔗</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Link problem</h3>
            <p className="text-sm text-gray-600">{message}</p>
            <p className="mt-4 text-sm text-gray-500">
              Need help?{' '}
              <a href="mailto:support@volunteerflow.net" className="text-blue-600 underline">
                Contact support
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
