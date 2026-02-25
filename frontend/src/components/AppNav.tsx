// AppNav.tsx
// Logo + navigation bar used on every screen (not modals).
//
// Features:
//   - Top-left: VolunteerFlow default brand mark (inline SVG, no file load needed).
//     When an org has uploaded their own logo it replaces the default mark entirely.
//   - Logged-in coordinators see a pencil ✏ icon on hover over the logo area.
//     Clicking it opens a native file picker accepting JPG/PNG/GIF/WebP/SVG (≤ 2 MB).
//     The selected file is sent to POST /api/organizations/logo which base64-encodes
//     it and stores it in the DB.  On success the org is re-fetched so the new logo
//     appears immediately across every tab/page without a reload.
//   - Optional nav links prop (e.g. [{label:'Volunteers', to:'/volunteers'}])
//   - Optional sign-out button (hidden on public pages like /login and /setup)
//
// Seeing their own organisation logo in the nav is the clearest signal to
// coordinators that their data is private to them.

import { useRef, useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { organizationsApi } from '../lib/api'

// ---------------------------------------------------------------------------
// Default VolunteerFlow brand mark (inline SVG — no network request, no FOUC)
// A blue rounded square with a volunteer silhouette (head + raised arms).
// ---------------------------------------------------------------------------
function DefaultLogoMark() {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-9 h-9 flex-shrink-0"
      aria-label="VolunteerFlow logo"
    >
      {/* Blue rounded background */}
      <rect width="40" height="40" rx="9" fill="#2563EB" />
      {/* Head */}
      <circle cx="20" cy="12" r="4.5" fill="white" />
      {/* Body / shoulders arc */}
      <path
        d="M12 30c0-4.418 3.582-8 8-8s8 3.582 8 8"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Left arm raised */}
      <path d="M16 22L11 16" stroke="white" strokeWidth="2" strokeLinecap="round" />
      {/* Right arm raised */}
      <path d="M24 22L29 16" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Pencil icon (12 × 12 px, drawn with paths so no icon library needed)
// ---------------------------------------------------------------------------
function PencilIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-3 h-3"
      aria-hidden="true"
    >
      <path
        d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z"
        stroke="#4B5563"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface NavLink {
  label: string
  to: string
}

/** Shared nav links used on every authenticated page — import this instead of defining per-page. */
export const APP_NAV_LINKS: NavLink[] = [
  { label: 'Home',       to: '/dashboard'  },
  { label: 'Shifts',     to: '/shifts'     },
  { label: 'Volunteers', to: '/volunteers' },
]

interface AppNavProps {
  /** Navigation links shown in the left side of the bar (authenticated pages) */
  links?: NavLink[]
  /** Show the Sign out button — set false on public pages like /login */
  showSignOut?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function AppNav({ links = [], showSignOut = true }: AppNavProps) {
  const { organization, user, signOut, refreshOrg } = useAuth()
  const { pathname } = useLocation()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const userMenuRef   = useRef<HTMLDivElement>(null)

  const isLoggedIn = !!user

  // ── Derive display name + initials ──────────────────────────────────────
  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? ''
  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
    || (user?.email?.[0]?.toUpperCase() ?? '?')

  // ── Click-outside: close user menu ──────────────────────────────────────
  useEffect(() => {
    if (!userMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [userMenuOpen])

  // ── Logo click: open file picker (only for logged-in coordinators) ──────
  const handleLogoClick = () => {
    if (!isLoggedIn) return
    setUploadError(null)
    fileInputRef.current?.click()
  }

  // ── File selected: validate + upload ────────────────────────────────────
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Client-side size guard (2 MB)
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Logo must be under 2 MB. Please choose a smaller image.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setUploading(true)
    setUploadError(null)
    try {
      await organizationsApi.uploadLogo(file)
      // Re-fetch the org so logo_url updates across all components immediately
      await refreshOrg()
    } catch {
      setUploadError('Upload failed. Please try a smaller image (JPG/PNG/WebP, ≤ 2 MB).')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">

          {/* ── Left side: logo + nav links ─────────────────────────────── */}
          <div className="flex items-center gap-6">

            {/* Logo area — always links to /dashboard (or / on public pages) */}
            <div className="relative group">
              <Link
                to={isLoggedIn ? '/dashboard' : '/'}
                className="flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                aria-label="Go to dashboard"
              >
                {organization?.logo_url ? (
                  /* Org has uploaded their own logo */
                  <img
                    src={organization.logo_url}
                    alt={organization.name ?? 'Organisation logo'}
                    className="h-9 w-auto max-w-[160px] object-contain rounded"
                  />
                ) : user && !organization ? (
                  /* Logged in but org still loading — show skeleton to avoid flash */
                  <div className="h-9 w-28 bg-gray-100 rounded animate-pulse" />
                ) : (
                  /* Default VolunteerFlow brand mark (not logged in) */
                  <>
                    <DefaultLogoMark />
                    <span className="text-lg font-bold text-blue-600 hidden sm:block select-none">
                      VolunteerFlow
                    </span>
                  </>
                )}
              </Link>

              {/* Pencil edit button — visible on hover, only when logged in */}
              {isLoggedIn && (
                <button
                  onClick={handleLogoClick}
                  title="Upload your organisation logo (JPG/PNG/WebP/SVG, max 2 MB)"
                  disabled={uploading}
                  className={`
                    absolute -top-1.5 -right-1.5
                    w-6 h-6 rounded-full bg-white border border-gray-300 shadow-sm
                    flex items-center justify-center
                    transition-opacity duration-150
                    opacity-0 group-hover:opacity-100
                    hover:bg-blue-50 hover:border-blue-400
                    disabled:cursor-wait
                    cursor-pointer
                    z-10
                  `}
                >
                  {uploading ? (
                    <span className="text-gray-400 animate-spin inline-block" style={{ fontSize: 11, lineHeight: 1 }}>
                      ⟳
                    </span>
                  ) : (
                    <PencilIcon />
                  )}
                </button>
              )}
            </div>

            {/* Nav links */}
            {links.map(({ label, to }) => (
              <Link
                key={to}
                to={to}
                className={`text-sm font-medium transition-colors ${
                  pathname.startsWith(to)
                    ? 'text-blue-600 font-semibold'
                    : 'text-gray-600 hover:text-blue-600'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* ── Right side: avatar button + dropdown ────────────────────── */}
          <div className="flex items-center">
            {isLoggedIn && showSignOut && (
              <div ref={userMenuRef} className="relative">
                <button
                  onClick={() => setUserMenuOpen(o => !o)}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-gray-100 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0 select-none">
                    {initials}
                  </div>
                  {fullName && (
                    <span className="text-sm font-bold text-gray-800 whitespace-nowrap">{fullName}</span>
                  )}
                  <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                    viewBox="0 0 12 12" fill="none">
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
                      strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
                    <Link
                      to="/volunteers/duplicates"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Data Quality
                    </Link>
                    <div className="border-t border-gray-100 my-1" />
                    <button
                      onClick={() => { setUserMenuOpen(false); signOut() }}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Upload error banner (below the nav bar, dismissible) */}
      {uploadError && (
        <div className="bg-red-50 border-t border-red-200 px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-red-700">{uploadError}</span>
          <button
            onClick={() => setUploadError(null)}
            className="ml-4 text-red-500 hover:text-red-700 font-bold text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}

      {/* Hidden file input — accepts common image formats */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        className="sr-only"
        onChange={handleFileSelected}
        aria-hidden="true"
      />
    </nav>
  )
}
