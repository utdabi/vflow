// VolunteersPage.tsx
// Feature 1.2: Volunteer Management
//
// Fields: first_name, last_name, gender (opt), date_of_birth (opt),
//         email (opt), mobile (E.164 required), skills, notes, preferred_days
//
// Features:
//   - Sortable list (last name)
//   - Search (client-side, name / mobile / email)
//   - Active / Inactive toggle
//   - "Add Volunteer" modal — two-tab layout (no scroll needed per tab):
//       Tab 1 "Basic info":   First/Last, Mobile, Email, Gender, DOB
//       Tab 2 "Availability": Preferred days, Skills, Notes
//   - "Import CSV" 3-step flow: upload → preview → confirm
//   - "Download Template" — grabs the official blank CSV from the backend

import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  volunteersApi,
  type Volunteer,
  type ImportPreviewResponse,
} from '../../lib/api'
import AppNav, { APP_NAV_LINKS } from '../../components/AppNav'
import ConfirmModal from '../../components/ConfirmModal'
import { useAuth } from '../../lib/auth-context'
import { dateFormatPattern, parseDateToISO } from '../../lib/date-format'
import { analytics } from '../../lib/analytics'

// ---------------------------------------------------------------------------
// Zod schema — mirrors backend validation
// ---------------------------------------------------------------------------
// E.164 format — but we use plain language in the UI
const E164_RE = /^\+[1-9]\d{9,14}$/

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say', 'Other']

const addVolunteerSchema = z.object({
  first_name:    z.string().min(1, 'First name is required'),
  last_name:     z.string().min(1, 'Last name is required'),
  gender:        z.string().optional(),
  date_of_birth: z.string().optional(),   // display format (DD/MM/YYYY or MM/DD/YYYY), converted to ISO on submit
  email:         z.string().email('Invalid email address').optional().or(z.literal('')),
  mobile:        z
    .string()
    .min(1, 'Mobile is required')
    .regex(E164_RE, 'Must start with + and contain 10–15 digits, e.g. +12125551234'),
  skills: z.string().optional(),  // comma-separated in the form field
  notes:  z.string().optional(),
})

type FormValues = z.infer<typeof addVolunteerSchema>

// ---------------------------------------------------------------------------

// Component
// ---------------------------------------------------------------------------
export default function VolunteersPage() {
  const { organization } = useAuth()
  const orgDateFmt = organization?.date_format ?? 'INTL'

  const [volunteers,    setVolunteers]    = useState<Volunteer[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [activeFilter,  setActiveFilter]  = useState(true)
  const [search,        setSearch]        = useState('')

  // Add modal
  const [showAdd,       setShowAdd]       = useState(false)
  const [addTab,        setAddTab]        = useState<'basic' | 'availability'>('basic')
  const [addError,      setAddError]      = useState<string | null>(null)
  const [addBusy,       setAddBusy]       = useState(false)
  const [preferredDays, setPreferredDays] = useState<number[]>([]) // 0=Sun…6=Sat

  // Confirm modal
  const [confirmModal, setConfirmModal] = useState<{
    title: string; message: string; confirmLabel: string
    variant: 'danger' | 'primary'; onConfirm: () => void
  } | null>(null)

  // CSV import
  const [showImport,      setShowImport]      = useState(false)
  const [importPreview,   setImportPreview]   = useState<ImportPreviewResponse | null>(null)
  const [importBusy,      setImportBusy]      = useState(false)
  const [importError,     setImportError]     = useState<string | null>(null)
  const [importSuccess,   setImportSuccess]   = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const form = useForm<FormValues>({ resolver: zodResolver(addVolunteerSchema) })
  const { register, handleSubmit, reset, formState: { errors } } = form

  // ------------------------------------------------------------------
  // Load
  // ------------------------------------------------------------------
  const load = async () => {
    setLoading(true); setError(null)
    try {
      const res = await volunteersApi.list(activeFilter)
      setVolunteers(res.data)
    } catch {
      setError('Failed to load volunteers.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [activeFilter])

  // ------------------------------------------------------------------
  // Search filter (client-side)
  // ------------------------------------------------------------------
  const filtered = volunteers.filter(v => {
    const q = search.toLowerCase()
    return (
      v.first_name.toLowerCase().includes(q) ||
      v.last_name.toLowerCase().includes(q) ||
      v.mobile.includes(q) ||
      (v.email ?? '').toLowerCase().includes(q)
    )
  })

  // ------------------------------------------------------------------
  // Add volunteer
  // ------------------------------------------------------------------
  const onAddSubmit = async (values: FormValues) => {
    setAddBusy(true); setAddError(null)
    // Convert DOB from display format (DD/MM/YYYY or MM/DD/YYYY) to ISO 8601
    let dobISO: string | undefined
    if (values.date_of_birth?.trim()) {
      dobISO = parseDateToISO(values.date_of_birth, orgDateFmt) ?? undefined
      if (!dobISO) {
        setAddError(`Invalid date of birth. Please use ${dateFormatPattern(orgDateFmt)} format.`)
        setAddBusy(false)
        return
      }
    }
    try {
      await volunteersApi.create({
        first_name:    values.first_name,
        last_name:     values.last_name,
        gender:        values.gender || undefined,
        date_of_birth: dobISO,
        email:         values.email   || undefined,
        mobile:        values.mobile,
        skills:        values.skills
          ? values.skills.split(',').map(s => s.trim()).filter(Boolean)
          : [],
        notes:          values.notes || undefined,
        preferred_days: preferredDays,
      })
      analytics.track('volunteer_added')
      reset()
      setPreferredDays([])
      setShowAdd(false)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setAddError(detail ?? 'Failed to add volunteer. Please try again.')
    } finally {
      setAddBusy(false)
    }
  }

  // ------------------------------------------------------------------
  // Mark inactive / active
  // ------------------------------------------------------------------
  const handleMarkInactive = (v: Volunteer) => {
    setConfirmModal({
      title: 'Mark Inactive',
      message: `Mark ${v.first_name} ${v.last_name} as inactive? Their history will be kept and they can be reactivated later.`,
      confirmLabel: 'Mark Inactive',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal(null)
        try {
          await volunteersApi.deactivate(v.id)
          await load()
        } catch {
          setError('Failed to mark volunteer as inactive.')
        }
      },
    })
  }

  const handleMarkActive = (v: Volunteer) => {
    setConfirmModal({
      title: 'Reactivate Volunteer',
      message: `Reactivate ${v.first_name} ${v.last_name}?`,
      confirmLabel: 'Reactivate',
      variant: 'primary',
      onConfirm: async () => {
        setConfirmModal(null)
        try {
          await volunteersApi.update(v.id, { active: true })
          await load()
        } catch {
          setError('Failed to reactivate volunteer.')
        }
      },
    })
  }

  // ------------------------------------------------------------------
  // CSV import
  // ------------------------------------------------------------------
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError(null); setImportPreview(null); setImportBusy(true)
    try {
      const res = await volunteersApi.importPreview(file, orgDateFmt)
      setImportPreview(res.data)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setImportError(detail ?? 'Failed to parse CSV.')
    } finally {
      setImportBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const confirmImport = async () => {
    if (!importPreview?.valid_rows.length) return
    setImportBusy(true); setImportError(null)
    try {
      const res = await volunteersApi.importConfirm(importPreview.valid_rows)
      const { created_count, updated_count } = res.data
      analytics.track('volunteer_csv_imported', { count: created_count + updated_count })
      const parts: string[] = []
      if (created_count) parts.push(`${created_count} added`)
      if (updated_count) parts.push(`${updated_count} updated`)
      setImportSuccess(`Import complete: ${parts.join(', ')}.`)
      setImportPreview(null); setShowImport(false)
      await load()
    } catch {
      setImportError('Import failed. Please try again.')
    } finally {
      setImportBusy(false)
    }
  }

  const handleExportList = () => {
    const label = activeFilter ? 'active' : 'inactive'
    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const rows = [
      // ID is first so re-importing this file updates existing records instead of creating duplicates
      ['ID (DO NOT MODIFY)', 'First Name', 'Last Name', 'Mobile', 'Email', 'Gender', 'Date of Birth', 'Preferred Days', 'Skills', 'Notes', 'Status'],
      ...filtered.map(v => [
        v.id,
        v.first_name,
        v.last_name,
        v.mobile,
        v.email ?? '',
        v.gender ?? '',
        v.date_of_birth ?? '',
        [...v.preferred_days].sort((a, b) => a - b).map(d => DAY_LABELS[d]).join('; '),
        v.skills.join('; '),
        v.notes ?? '',
        v.active ? 'Active' : 'Inactive',
      ]),
    ]
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `volunteers_${label}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadTemplate = async () => {
    try {
      const res = await volunteersApi.downloadSampleCsv(orgDateFmt)
      const blob = new Blob([res.data as string], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'volunteer_template.csv'; a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Failed to download template.')
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Shared nav bar — logo editable via pencil icon on hover */}
      <AppNav links={APP_NAV_LINKS} />

      <div className="max-w-6xl mx-auto p-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Volunteers</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowImport(true); setImportPreview(null); setImportError(null) }}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
              Import CSV
            </button>
            <button onClick={() => { setShowAdd(true); setAddTab('basic'); setAddError(null); setPreferredDays([]); reset() }}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">
              + Add Volunteer
            </button>
          </div>
        </div>

        {/* ── Success banner ── */}
        {importSuccess && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-800 rounded-md flex justify-between items-center">
            <span>{importSuccess}</span>
            <button onClick={() => setImportSuccess(null)} className="text-green-600 font-bold text-lg leading-none">×</button>
          </div>
        )}

        {/* ── Search + Segmented toggle + Export ── */}
        <div className="flex gap-3 mb-3">
          <input
            type="text"
            placeholder="Search by name, mobile, or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-72 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex rounded-md border border-gray-300 overflow-hidden">
            <button
              onClick={() => setActiveFilter(true)}
              className={`px-4 py-2 text-sm transition-colors ${
                activeFilter
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setActiveFilter(false)}
              className={`px-4 py-2 text-sm border-l border-gray-300 transition-colors ${
                !activeFilter
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Inactive
            </button>
          </div>
          <button
            onClick={handleExportList}
            disabled={filtered.length === 0}
            className="px-3 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ⬇ Export list
          </button>
        </div>

        {/* ── Count above table — hidden while loading ── */}
        {!loading && (
          <p className="text-sm text-gray-500 mb-3">
            <span className="font-semibold text-gray-700">{filtered.length}</span>
            {' '}{activeFilter ? 'active' : 'inactive'} volunteer{filtered.length !== 1 ? 's' : ''}
            {search.trim() && <> matching <em>"{search.trim()}"</em></>}
          </p>
        )}

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md">{error}</div>}

        {/* ── Table ── */}
        {loading ? (
          <div className="text-center py-16 text-gray-400">Loading volunteers…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            {search
              ? 'No volunteers match your search.'
              : activeFilter
              ? 'No active volunteers yet. Add your first volunteer or import a CSV above.'
              : 'No inactive volunteers.'}
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['First Name', 'Last Name', 'Preferred Days', 'Mobile', 'Email', 'Gender', 'Age', 'Skills', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(v => (
                  <tr key={v.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{v.first_name}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{v.last_name}</td>
                    <td className="px-4 py-3">
                      {v.preferred_days.length > 0 ? (
                        <div className="flex gap-0.5 flex-wrap">
                          {[...v.preferred_days].sort((a, b) => a - b).map(d => (
                            <span key={d} className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-1 py-0.5 rounded font-normal">
                              {['Su','Mo','Tu','We','Th','Fr','Sa'][d]}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.mobile}</td>
                    <td className="px-4 py-3 text-gray-600">{v.email ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{v.gender ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{v.age ?? '—'}</td>
                    <td className="px-4 py-3">
                      {v.skills.length
                        ? v.skills.map(s => (
                            <span key={s} className="inline-block bg-blue-50 text-blue-700 text-xs px-1.5 py-0.5 rounded mr-1 mb-0.5">{s}</span>
                          ))
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {activeFilter ? (
                        <button onClick={() => handleMarkInactive(v)}
                          className="text-xs text-amber-600 hover:text-amber-800 hover:underline whitespace-nowrap">
                          Mark Inactive
                        </button>
                      ) : (
                        <button onClick={() => handleMarkActive(v)}
                          className="text-xs text-green-600 hover:text-green-800 hover:underline whitespace-nowrap">
                          Mark Active
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Starter Template footer ── */}
        <div className="mt-6 flex items-center gap-3 text-sm text-gray-400">
          <span>New to VolunteerFlow?</span>
          <button
            onClick={downloadTemplate}
            className="text-blue-500 hover:text-blue-700 hover:underline transition-colors"
          >
            ⬇ Download starter template
          </button>
        </div>
      </div>

      {/* ================================================================== */}
      {/* Add Volunteer Modal — two-tab layout (no scroll, each tab fits)       */}
      {/* ================================================================== */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">Add Volunteer</h2>
              <button
                onClick={() => setShowAdd(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-xl leading-none"
              >&times;</button>
            </div>

            {/* ── Tabs ── */}
            <div className="flex border-b border-gray-100 px-6">
              {(['basic', 'availability'] as const).map((t, i) => (
                <button
                  key={t}
                  type="button"
                  onClick={async () => {
                    if (t === 'availability' && addTab === 'basic') {
                      const ok = await form.trigger(['first_name', 'last_name', 'mobile', 'email'])
                      if (!ok) return
                    }
                    setAddTab(t)
                    setAddError(null)
                  }}
                  className={[
                    'py-2.5 px-1 mr-6 text-sm font-medium border-b-2 -mb-px transition-colors',
                    addTab === t
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700',
                  ].join(' ')}
                >
                  {i + 1}. {t === 'basic' ? 'Basic info' : 'Availability'}
                </button>
              ))}
            </div>

            {/* ── Form body (no scroll — each tab fits in viewport) ── */}
            <form id="add-volunteer-form" onSubmit={handleSubmit(onAddSubmit)} className="px-6 py-5">
              {addError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg mb-4">{addError}</div>
              )}

              {/* ── Tab 1: Basic info ── */}
              {addTab === 'basic' && (
                <div className="space-y-4">
                  {/* First + Last name */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">First Name *</label>
                      <input {...register('first_name')} autoFocus
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Jane" />
                      {errors.first_name && <p className="text-red-500 text-xs mt-1">{errors.first_name.message}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Last Name *</label>
                      <input {...register('last_name')}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Smith" />
                      {errors.last_name && <p className="text-red-500 text-xs mt-1">{errors.last_name.message}</p>}
                    </div>
                  </div>

                  {/* Mobile */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Mobile *</label>
                    <input {...register('mobile')}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="+12125551234  (include country code: +1 US · +44 UK · +61 AU)" />
                    {errors.mobile && <p className="text-red-500 text-xs mt-1">{errors.mobile.message}</p>}
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Email</label>
                    <input {...register('email')} type="email"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="jane@example.com" />
                    {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
                  </div>

                  {/* Gender + DOB */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Gender</label>
                      <select {...register('gender')}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white">
                        <option value="">— select —</option>
                        {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                        Date of Birth
                      </label>
                      <input {...register('date_of_birth')} type="text"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder={dateFormatPattern(orgDateFmt)} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Tab 2: Availability ── */}
              {addTab === 'availability' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    Optional — helps the backup finder suggest this volunteer for the right shifts.
                  </p>

                  {/* Preferred Days */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Preferred Days
                    </label>
                    <div className="flex gap-1.5 flex-wrap">
                      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, i) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setPreferredDays(prev =>
                            prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
                          )}
                          className={[
                            'px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                            preferredDays.includes(i)
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600',
                          ].join(' ')}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Skills */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      Skills <span className="normal-case font-normal text-gray-400">(comma-separated)</span>
                    </label>
                    <input {...register('skills')}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="first aid, driving, cooking" />
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
                    <textarea {...register('notes')} rows={3}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                      placeholder="Anything useful to know about this volunteer" />
                  </div>
                </div>
              )}
            </form>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>

              {addTab === 'basic' ? (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await form.trigger(['first_name', 'last_name', 'mobile', 'email'])
                    if (ok) { setAddError(null); setAddTab('availability') }
                  }}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Next: Availability →
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setAddTab('basic'); setAddError(null) }}
                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    ← Back
                  </button>
                  <button
                    type="submit"
                    form="add-volunteer-form"
                    disabled={addBusy}
                    className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {addBusy ? 'Adding…' : 'Add Volunteer'}
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* CSV Import Modal                                                      */}
      {/* ================================================================== */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Import Volunteers from CSV</h2>
              <button
                onClick={() => { setShowImport(false); setImportPreview(null); setImportError(null) }}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1">

              {/* Step 1 — upload */}
              {!importPreview && (
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
                    <strong>Add new volunteers:</strong> Use the{' '}
                    <button onClick={downloadTemplate} className="underline text-amber-700 hover:text-amber-900">
                      template
                    </button>{' '}
                    — required columns: <code>first_name</code>, <code>last_name</code>, <code>mobile</code>.<br />
                    <strong>Update existing volunteers:</strong> Use <strong>⬇ Export list</strong> to download, edit in Excel/Sheets, then re-upload — existing records will be updated, not duplicated.<br />
                    Mobile must include your country code (e.g. <code>+12125551234</code> for US, <code>+447911123456</code> for UK).
                    Dates of birth use <strong>{dateFormatPattern(orgDateFmt)}</strong> format.
                  </div>

                  {importError && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{importError}</div>
                  )}

                  <label className="block w-full border-2 border-dashed border-gray-300 rounded-lg p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition">
                    <div className="text-3xl mb-2">📄</div>
                    <span className="block text-sm text-gray-600 font-medium">
                      {importBusy ? 'Parsing file…' : 'Click to choose a .csv file'}
                    </span>
                    <span className="block text-xs text-gray-400 mt-1">or drag and drop</span>
                    <input ref={fileRef} type="file" accept=".csv" className="hidden"
                      onChange={handleFileChange} disabled={importBusy} />
                  </label>
                </div>
              )}

              {/* Step 2 — preview */}
              {importPreview && (
                <div className="space-y-4">
                  <div className="flex gap-2 flex-wrap">
                    {importPreview.create_count > 0 && (
                      <span className="text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-full font-medium">
                        + {importPreview.create_count} new
                      </span>
                    )}
                    {importPreview.update_count > 0 && (
                      <span className="text-sm text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full font-medium">
                        ✎ {importPreview.update_count} update{importPreview.update_count !== 1 ? 's' : ''}
                      </span>
                    )}
                    {importPreview.invalid_count > 0 && (
                      <span className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-1 rounded-full font-medium">
                        ✗ {importPreview.invalid_count} invalid — will be skipped
                      </span>
                    )}
                  </div>

                  {/* Invalid rows */}
                  {importPreview.invalid_rows.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-red-700 mb-2">Errors (these rows will NOT be imported):</p>
                      <div className="space-y-1 max-h-36 overflow-y-auto rounded border border-red-100">
                        {importPreview.invalid_rows.map(r => (
                          <div key={r.row_number} className="text-xs text-red-700 bg-red-50 px-3 py-2">
                            <span className="font-medium">Row {r.row_number}:</span> {r.error_message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Valid rows preview table */}
                  {importPreview.valid_rows.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 mb-2">Preview of rows to import:</p>
                      <div className="border border-gray-200 rounded overflow-hidden">
                        <div className="overflow-x-auto max-h-56 overflow-y-auto">
                          <table className="min-w-full text-xs divide-y divide-gray-100">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                {['Action', 'First', 'Last', 'Mobile', 'Gender', 'DOB', 'Email', 'Skills'].map(h => (
                                  <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {importPreview.valid_rows.map((row, i) => (
                                <tr key={i} className={row.action === 'update' ? 'bg-blue-50 hover:bg-blue-100' : 'bg-green-50 hover:bg-green-100'}>
                                  <td className="px-3 py-1.5">
                                    {row.action === 'update'
                                      ? <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded font-medium">Update</span>
                                      : <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded font-medium">New</span>
                                    }
                                  </td>
                                  <td className="px-3 py-1.5 text-gray-800">{String(row.first_name ?? '')}</td>
                                  <td className="px-3 py-1.5 text-gray-800">{String(row.last_name ?? '')}</td>
                                  <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{String(row.mobile ?? '')}</td>
                                  <td className="px-3 py-1.5 text-gray-500">{String(row.gender ?? '—')}</td>
                                  <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{String(row.date_of_birth ?? '—')}</td>
                                  <td className="px-3 py-1.5 text-gray-500">{String(row.email ?? '—')}</td>
                                  <td className="px-3 py-1.5 text-gray-500">
                                    {Array.isArray(row.skills) ? (row.skills as string[]).join(', ') || '—' : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {importError && (
                    <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{importError}</div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
              <button
                onClick={() => { setImportPreview(null); setImportError(null) }}
                className="text-sm text-gray-500 hover:text-gray-700">
                {importPreview ? '← Upload different file' : 'Cancel'}
              </button>
              {importPreview && importPreview.valid_count > 0 && (
                <button onClick={confirmImport} disabled={importBusy}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
                  {importBusy
                    ? 'Importing…'
                    : importPreview.update_count > 0 && importPreview.create_count === 0
                      ? `Update ${importPreview.update_count} Volunteer${importPreview.update_count !== 1 ? 's' : ''}`
                      : importPreview.update_count > 0
                        ? `Import ${importPreview.valid_count} (${importPreview.create_count} new, ${importPreview.update_count} updates)`
                        : `Import ${importPreview.valid_count} Volunteer${importPreview.valid_count !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal — replaces browser-native confirm() */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          variant={confirmModal.variant}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  )
}
