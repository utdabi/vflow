// ShiftEditPage.tsx
// Feature 4.3: Shift Scheduling & Assignment
//
// Dedicated page replacing the old CreateShiftModal + ShiftDetailPanel.
// Routes:
//   /shifts/new?date=YYYY-MM-DD  — create mode: form + empty panels
//   /shifts/:id                  — edit mode: loaded shift + dual panels
//
// Design: "Dispatch board" — full-page, dual-panel volunteer allocation.
//   Left (45%):  available volunteers, searchable, click to assign
//   Right (55%): assigned volunteers, capacity bar, click × to remove

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import AppNav, { APP_NAV_LINKS } from '../../components/AppNav'
import ConfirmModal from '../../components/ConfirmModal'
import {
  shiftsApi, volunteersApi, backupFinderApi,
  type ShiftDetail, type Volunteer, type BackupSuggestion,
} from '../../lib/api'
import { useAuth } from '../../lib/auth-context'
import { formatDate } from '../../lib/date-format'
import { analytics } from '../../lib/analytics'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(t: string) {
  return t.slice(0, 5)
}

const AVATAR_COLORS = [
  { bg: 'bg-teal-100',    text: 'text-teal-700'    },
  { bg: 'bg-amber-100',   text: 'text-amber-700'   },
  { bg: 'bg-rose-100',    text: 'text-rose-700'    },
  { bg: 'bg-violet-100',  text: 'text-violet-700'  },
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-sky-100',     text: 'text-sky-700'     },
]

function avatarColor(name: string) {
  let code = 0
  for (let i = 0; i < name.length; i++) code += name.charCodeAt(i)
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}

function initials(firstName: string, lastName: string) {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase()
}

// ---------------------------------------------------------------------------
// Backup Finder Modal (moved here from ShiftsPage)
// ---------------------------------------------------------------------------

interface BackupFinderModalProps {
  shiftId: string
  cancelledVolunteerId: string
  onClose: () => void
}

function BackupFinderModal({ shiftId, cancelledVolunteerId, onClose }: BackupFinderModalProps) {
  const [loading, setLoading] = useState(true)
  const [suggestions, setSuggestions] = useState<BackupSuggestion[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    backupFinderApi.getSuggestions(shiftId, cancelledVolunteerId)
      .then(r => {
        setSuggestions(r.data.suggestions)
        setSelected(new Set(r.data.suggestions.map(s => s.volunteer.id)))
      })
      .catch(() => setError('Could not load backup suggestions. Please try again.'))
      .finally(() => setLoading(false))
  }, [shiftId, cancelledVolunteerId])

  const toggleSelect = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const handleSend = async () => {
    if (selected.size === 0) return
    setSending(true)
    setError(null)
    try {
      const resp = await backupFinderApi.requestBackups(shiftId, [...selected])
      analytics.track('backup_request_sent', { volunteer_count: selected.size })
      setSent(resp.data.sent_count)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg ?? 'Failed to send messages. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Find a Backup</h2>
            <p className="text-xs text-gray-500 mt-0.5">Ranked by reliability — top matches for this shift</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xl leading-none">
            &times;
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          {sent !== null ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-3">✅</div>
              <p className="font-semibold text-gray-900">Sent to {sent} volunteer{sent !== 1 ? 's' : ''}!</p>
              <p className="text-sm text-gray-500 mt-1">They'll receive an SMS with shift details.</p>
              <button onClick={onClose}
                className="mt-5 px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700">
                Done
              </button>
            </div>
          ) : loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">Finding best matches…</div>
          ) : suggestions.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              No backup candidates found. Try adding more volunteers.
            </div>
          ) : (
            <>
              <ul className="space-y-3">
                {suggestions.map(s => (
                  <li key={s.volunteer.id}
                    onClick={() => toggleSelect(s.volunteer.id)}
                    className={[
                      'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                      selected.has(s.volunteer.id) ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50',
                    ].join(' ')}
                  >
                    <input type="checkbox" readOnly
                      checked={selected.has(s.volunteer.id)}
                      className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 text-sm">
                          {s.volunteer.first_name} {s.volunteer.last_name}
                        </span>
                        <span className="text-xs font-bold bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">
                          {s.score} pts
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{s.volunteer.mobile}</p>
                      <ul className="mt-1 space-y-0.5">
                        {s.reasons.map((r, i) => (
                          <li key={i} className="text-xs text-gray-600 flex items-center gap-1">
                            <span className="text-green-500">✓</span> {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ))}
              </ul>
              <button onClick={handleSend} disabled={sending || selected.size === 0}
                className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors mt-2">
                {sending ? 'Sending…' : `📱 Text selected (${selected.size})`}
              </button>
              <p className="text-xs text-gray-400 text-center">
                SMS: "Hi [name], can you cover this shift? Reply YES to confirm."
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const NAV_LINKS = APP_NAV_LINKS

export default function ShiftEditPage() {
  const { id: shiftId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { organization } = useAuth()
  const orgDateFmt = organization?.date_format ?? 'INTL'

  const mode = shiftId ? 'edit' : 'create'
  const defaultDate = searchParams.get('date') ?? ''

  // ── Create-mode form fields ───────────────────────────────────────────────
  const [title, setTitle]         = useState('')
  const [shiftDate, setShiftDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime]     = useState('12:00')
  const [location, setLocation]   = useState('')
  const [minVols, setMinVols]     = useState(1)
  const [maxVols, setMaxVols]     = useState(8)
  const [leadFirst, setLeadFirst] = useState('')
  const [leadLast, setLeadLast]   = useState('')
  const [leadMobile, setLeadMobile] = useState('')

  // ── Data ──────────────────────────────────────────────────────────────────
  const [shift, setShift]             = useState<ShiftDetail | null>(null)
  const [volunteers, setVolunteers]   = useState<Volunteer[]>([])
  const [loadingData, setLoadingData] = useState(mode === 'edit')

  // ── Panel interaction ─────────────────────────────────────────────────────
  const [search, setSearch]                     = useState('')
  const [pendingAdds, setPendingAdds]             = useState<Set<string>>(new Set())
  const [pendingRemoves, setPendingRemoves]       = useState<Set<string>>(new Set())
  const [savingAssignments, setSavingAssignments] = useState(false)
  const [showBackupFinder, setShowBackupFinder] = useState(false)
  const [lastCancelledId, setLastCancelledId]   = useState<string | null>(null)

  // ── Action state ──────────────────────────────────────────────────────────
  const [saving, setSaving]               = useState(false)
  const [formError, setFormError]         = useState<string | null>(null)
  const [panelError, setPanelError]       = useState<string | null>(null)
  const [changingStatus, setChangingStatus] = useState(false)
  const [confirmModal, setConfirmModal] = useState<{
    title: string; message: string; confirmLabel: string
    variant: 'danger' | 'primary'; onConfirm: () => void
  } | null>(null)
  const [editingDetails, setEditingDetails] = useState(false)
  const [editSaving, setEditSaving]         = useState(false)
  const [editError, setEditError]           = useState<string | null>(null)
  const [editSnapshot, setEditSnapshot]     = useState<{
    title: string; shiftDate: string; startTime: string; endTime: string
    location: string; minVols: number; maxVols: number
    leadFirst: string; leadLast: string; leadMobile: string
  } | null>(null)

  // ── Font injection — Plus Jakarta Sans + DM Mono for this page ────────────
  useEffect(() => {
    if (document.getElementById('shift-edit-fonts')) return
    const link = document.createElement('link')
    link.id   = 'shift-edit-fonts'
    link.rel  = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap'
    document.head.appendChild(link)
  }, [])

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadShift = useCallback(async () => {
    if (!shiftId) return
    try {
      const [sResp, vResp] = await Promise.all([
        shiftsApi.getById(shiftId),
        volunteersApi.list(true),
      ])
      setShift(sResp.data)
      setVolunteers(vResp.data)
    } catch {
      setPanelError('Failed to load shift data.')
    } finally {
      setLoadingData(false)
    }
  }, [shiftId])

  useEffect(() => {
    if (mode === 'edit') {
      loadShift()
    } else {
      volunteersApi.list(true).then(r => setVolunteers(r.data))
    }
  }, [mode, loadShift])

  // ── Derived ───────────────────────────────────────────────────────────────
  const existingIds    = new Set(shift?.assignments.map(a => a.volunteer_id) ?? [])
  const effectiveIds   = new Set([...existingIds, ...pendingAdds].filter(id => !pendingRemoves.has(id)))
  const confirmedRight = (shift?.assignments ?? []).filter(a => !pendingRemoves.has(a.volunteer_id))
  const pendingAddVols = volunteers.filter(v => pendingAdds.has(v.id))
  const effectiveCount = effectiveIds.size
  const hasPending     = pendingAdds.size > 0 || pendingRemoves.size > 0
  const pendingCount   = pendingAdds.size + pendingRemoves.size
  const leftVols       = volunteers.filter(v => {
    if (effectiveIds.has(v.id)) return false // effectively assigned — hide from left
    if (pendingRemoves.has(v.id)) return true // staged for removal — always show (with badge)
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      v.first_name.toLowerCase().includes(q) ||
      v.last_name.toLowerCase().includes(q) ||
      v.mobile.includes(q)
    )
  })

  // ── Create shift ──────────────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setFormError('Please enter a shift title.'); return }
    if (!shiftDate)    { setFormError('Please choose a date.'); return }
    if (!leadFirst.trim() || !leadLast.trim()) {
      setFormError("Please enter the event lead's first and last name.")
      return
    }
    if (maxVols < minVols) { setFormError('Max volunteers must be ≥ min.'); return }
    setSaving(true)
    setFormError(null)
    try {
      const resp = await shiftsApi.create({
        title: title.trim(),
        date: shiftDate,
        start_time: startTime,
        end_time:   endTime,
        location:   location.trim() || undefined,
        min_volunteers: minVols,
        max_volunteers: maxVols,
        event_lead_first_name: leadFirst.trim(),
        event_lead_last_name:  leadLast.trim(),
        event_lead_mobile:     leadMobile.trim() || undefined,
      })
      analytics.track('shift_created')
      navigate(`/shifts/${resp.data.id}`, { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(msg ?? 'Failed to create shift. Please try again.')
      setSaving(false)
    }
  }

  // ── Open inline edit form pre-filled with current shift values ───────────
  const startEditDetails = () => {
    if (!shift) return
    setTitle(shift.title)
    setShiftDate(shift.date)
    setStartTime(formatTime(shift.start_time))
    setEndTime(formatTime(shift.end_time))
    setLocation(shift.location ?? '')
    setMinVols(shift.min_volunteers)
    setMaxVols(shift.max_volunteers)
    setLeadFirst(shift.event_lead_first_name)
    setLeadLast(shift.event_lead_last_name)
    setLeadMobile(shift.event_lead_mobile ?? '')
    setEditSnapshot({
      title:     shift.title,
      shiftDate: shift.date,
      startTime: formatTime(shift.start_time),
      endTime:   formatTime(shift.end_time),
      location:  shift.location ?? '',
      minVols:   shift.min_volunteers,
      maxVols:   shift.max_volunteers,
      leadFirst: shift.event_lead_first_name,
      leadLast:  shift.event_lead_last_name,
      leadMobile: shift.event_lead_mobile ?? '',
    })
    setEditError(null)
    setEditingDetails(true)
  }

  // ── Save edited shift details ─────────────────────────────────────────────
  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shift) return
    if (!title.trim()) { setEditError('Please enter a shift title.'); return }
    if (!shiftDate)    { setEditError('Please choose a date.'); return }
    if (!leadFirst.trim() || !leadLast.trim()) {
      setEditError("Please enter the event lead's first and last name.")
      return
    }
    if (maxVols < minVols) { setEditError('Max volunteers must be ≥ min.'); return }

    setEditSaving(true)
    setEditError(null)
    try {
      await shiftsApi.update(shift.id, {
        title:                 title.trim(),
        date:                  shiftDate,
        start_time:            startTime,
        end_time:              endTime,
        location:              location.trim() || undefined,
        min_volunteers:        minVols,
        max_volunteers:        maxVols,
        event_lead_first_name: leadFirst.trim(),
        event_lead_last_name:  leadLast.trim(),
        event_lead_mobile:     leadMobile.trim() || undefined,
      })
      await loadShift()
      setEditingDetails(false)
      setEditSnapshot(null)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setEditError(msg ?? 'Failed to save changes.')
    } finally {
      setEditSaving(false)
    }
  }

  // ── Stage assign (instant, no API call) ──────────────────────────────────
  const handleAssign = (volunteerId: string) => {
    if (!shift || shift.status === 'cancelled') return
    if (pendingRemoves.has(volunteerId)) {
      // un-stage a removal instead of re-adding
      setPendingRemoves(prev => { const s = new Set(prev); s.delete(volunteerId); return s })
    } else {
      setPendingAdds(prev => new Set(prev).add(volunteerId))
    }
  }

  // ── Stage remove (instant, no API call) ───────────────────────────────────
  const handleRemove = (volunteerId: string) => {
    if (!shift || shift.status === 'cancelled') return
    if (pendingAdds.has(volunteerId)) {
      // un-stage an add instead of removing
      setPendingAdds(prev => { const s = new Set(prev); s.delete(volunteerId); return s })
    } else {
      setPendingRemoves(prev => new Set(prev).add(volunteerId))
    }
  }

  // ── Batch save all staged changes ────────────────────────────────────────
  const handleSaveAssignments = async () => {
    if (!shift || !hasPending) return
    setSavingAssignments(true)
    setPanelError(null)
    try {
      await Promise.all([
        ...[...pendingAdds].map(id => shiftsApi.assignVolunteer(shift.id, id)),
        ...[...pendingRemoves].map(id => shiftsApi.cancelAssignment(shift.id, id)),
      ])
      analytics.track('assignment_saved', { added: pendingAdds.size, removed: pendingRemoves.size })
      const removedIds = [...pendingRemoves]
      setPendingAdds(new Set())
      setPendingRemoves(new Set())
      await loadShift()
      if (removedIds.length > 0) {
        setLastCancelledId(removedIds[removedIds.length - 1])
        setShowBackupFinder(true)
        analytics.track('backup_finder_opened')
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setPanelError(msg ?? 'Failed to save assignments. Please try again.')
    } finally {
      setSavingAssignments(false)
    }
  }

  const handleDiscardAssignments = () => {
    setPendingAdds(new Set())
    setPendingRemoves(new Set())
  }

  // ── Publish / Cancel shift ────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!shift) return
    setChangingStatus(true)
    try {
      await shiftsApi.update(shift.id, { status: 'published' })
      analytics.track('shift_published')
      await loadShift()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setPanelError(msg ?? 'Failed to publish shift.')
    } finally {
      setChangingStatus(false)
    }
  }

  const handleCancelShift = () => {
    if (!shift) return
    setConfirmModal({
      title: 'Cancel Shift',
      message: 'Cancel this shift? This cannot be undone.',
      confirmLabel: 'Cancel Shift',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal(null)
        setChangingStatus(true)
        try {
          await shiftsApi.update(shift.id, { status: 'cancelled' })
          await loadShift()
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          setPanelError(msg ?? 'Failed to cancel shift.')
        } finally {
          setChangingStatus(false)
        }
      },
    })
  }

  // ── Export CSV ────────────────────────────────────────────────────────────
  const computeAge = (dob: string | null): string => {
    if (!dob) return ''
    const birth = new Date(dob)
    const today = new Date()
    let age = today.getFullYear() - birth.getFullYear()
    if (
      today.getMonth() < birth.getMonth() ||
      (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
    ) age--
    return String(age)
  }

  const handleExportCsv = () => {
    if (!shift || shift.assignments.length === 0) return
    const rows = [
      ['First Name', 'Last Name', 'Mobile', 'Email', 'Gender', 'Age', 'Skills', 'Notes'],
      ...shift.assignments.map(a => [
        a.volunteers.first_name,
        a.volunteers.last_name,
        a.volunteers.mobile,
        a.volunteers.email ?? '',
        a.volunteers.gender ?? '',
        computeAge(a.volunteers.date_of_birth),
        (a.volunteers.skills ?? []).join(', '),
        a.volunteers.notes ?? '',
      ]),
    ]
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `volunteers_${shift.date}_${shift.title.replace(/[^a-zA-Z0-9-]/g, '_')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Status badge ──────────────────────────────────────────────────────────
  function statusBadge(s: string) {
    if (s === 'published') return { cls: 'bg-green-100 text-green-800', label: 'Published' }
    if (s === 'cancelled') return { cls: 'bg-red-100 text-red-600',   label: 'Cancelled'  }
    return                         { cls: 'bg-yellow-100 text-yellow-700', label: 'Draft'  }
  }

  // ── Capacity bar colour ───────────────────────────────────────────────────
  function capacityBarColor() {
    if (!shift) return 'bg-gray-300'
    if (effectiveCount < shift.min_volunteers)  return 'bg-red-400'
    if (effectiveCount > shift.max_volunteers)  return 'bg-amber-400'
    return 'bg-emerald-500'
  }

  // ── Shared input style ────────────────────────────────────────────────────
  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white'
  const labelCls = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1'

  // Derived: is the edit form dirty vs snapshot?
  const isEditDirty = !editSnapshot || (
    title.trim()      !== editSnapshot.title      ||
    shiftDate         !== editSnapshot.shiftDate   ||
    startTime         !== editSnapshot.startTime   ||
    endTime           !== editSnapshot.endTime     ||
    location.trim()   !== editSnapshot.location    ||
    minVols           !== editSnapshot.minVols     ||
    maxVols           !== editSnapshot.maxVols     ||
    leadFirst.trim()  !== editSnapshot.leadFirst   ||
    leadLast.trim()   !== editSnapshot.leadLast    ||
    leadMobile.trim() !== editSnapshot.leadMobile
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <AppNav links={NAV_LINKS} />

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

      {/* Backup finder modal — shown when a volunteer is removed */}
      {showBackupFinder && shift && lastCancelledId && (
        <BackupFinderModal
          shiftId={shift.id}
          cancelledVolunteerId={lastCancelledId}
          onClose={() => { setShowBackupFinder(false); setLastCancelledId(null) }}
        />
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* ── Breadcrumb / page header ── */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => navigate('/shifts')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors group"
          >
            <span className="text-base leading-none group-hover:-translate-x-0.5 transition-transform inline-block">←</span>
            Calendar
          </button>
          <span className="text-gray-300 select-none">/</span>
          {mode === 'create' ? (
            <h1 className="text-base font-bold text-gray-900">New Shift</h1>
          ) : shift ? (
            <>
              <h1 className="text-base font-bold text-gray-900">{shift.title}</h1>
              {(() => {
                const b = statusBadge(shift.status)
                return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${b.cls}`}>{b.label}</span>
              })()}
            </>
          ) : (
            <div className="h-5 w-36 bg-gray-200 rounded animate-pulse" />
          )}
        </div>

        {/* ── CREATE MODE: shift details form ── */}
        {mode === 'create' && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-5">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Shift Details</h2>
            {formError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{formError}</div>
            )}
            <form onSubmit={handleCreate} className="space-y-4">
              {/* Row 1: Title + Date + Times */}
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-5">
                  <label className={labelCls}>Title *</label>
                  <input className={inputCls} value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Food Distribution" autoFocus />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Date *</label>
                  <input type="date" className={inputCls} value={shiftDate}
                    onChange={e => setShiftDate(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Start *</label>
                  <input type="time" className={inputCls} value={startTime}
                    onChange={e => setStartTime(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>End *</label>
                  <input type="time" className={inputCls} value={endTime}
                    onChange={e => setEndTime(e.target.value)} />
                </div>
              </div>

              {/* Row 2: Location + Capacity */}
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-5">
                  <label className={labelCls}>Location</label>
                  <input className={inputCls} value={location}
                    onChange={e => setLocation(e.target.value)} placeholder="Optional" />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Min volunteers</label>
                  <input type="number" min={1} className={inputCls} value={minVols}
                    onChange={e => setMinVols(Number(e.target.value))} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Max volunteers</label>
                  <input type="number" min={1} className={inputCls} value={maxVols}
                    onChange={e => setMaxVols(Number(e.target.value))} />
                </div>
              </div>

              {/* Row 3: Event lead + submit */}
              <div className="grid grid-cols-12 gap-3 items-end">
                <div className="col-span-2">
                  <label className={labelCls}>Lead first name *</label>
                  <input className={inputCls} value={leadFirst}
                    onChange={e => setLeadFirst(e.target.value)} placeholder="Jane" />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Lead last name *</label>
                  <input className={inputCls} value={leadLast}
                    onChange={e => setLeadLast(e.target.value)} placeholder="Smith" />
                </div>
                <div className="col-span-3">
                  <label className={labelCls}>Lead mobile <span className="normal-case font-normal text-gray-400">(optional)</span></label>
                  <input className={inputCls} value={leadMobile}
                    onChange={e => setLeadMobile(e.target.value)} placeholder="+12125550000" />
                </div>
                <div className="col-span-5 flex justify-end">
                  <button type="submit" disabled={saving}
                    className="px-6 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2 shadow-sm">
                    {saving ? (
                      <>
                        <span className="inline-block h-3.5 w-3.5 border-2 border-white border-r-transparent rounded-full animate-spin" />
                        Creating…
                      </>
                    ) : 'Create Shift & Assign Volunteers →'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* ── EDIT MODE: shift summary bar / inline edit form ── */}
        {mode === 'edit' && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-4 mb-5">
            {loadingData ? (
              <div className="space-y-2">
                <div className="h-4 w-64 bg-gray-100 rounded animate-pulse" />
                <div className="h-3 w-48 bg-gray-100 rounded animate-pulse" />
              </div>
            ) : shift && editingDetails ? (
              /* ── Inline edit form ── */
              <form onSubmit={handleSaveDetails} className="space-y-4">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Edit Shift Details</h2>
                {editError && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{editError}</div>
                )}
                {/* Row 1: Title + Date + Times */}
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-5">
                    <label className={labelCls}>Title *</label>
                    <input className={inputCls} value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="e.g. Food Distribution" autoFocus />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Date *</label>
                    <input type="date" className={inputCls} value={shiftDate}
                      onChange={e => setShiftDate(e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Start *</label>
                    <input type="time" className={inputCls} value={startTime}
                      onChange={e => setStartTime(e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>End *</label>
                    <input type="time" className={inputCls} value={endTime}
                      onChange={e => setEndTime(e.target.value)} />
                  </div>
                </div>
                {/* Row 2: Location + Capacity */}
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-5">
                    <label className={labelCls}>Location</label>
                    <input className={inputCls} value={location}
                      onChange={e => setLocation(e.target.value)} placeholder="Optional" />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Min volunteers</label>
                    <input type="number" min={1} className={inputCls} value={minVols}
                      onChange={e => setMinVols(Number(e.target.value))} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Max volunteers</label>
                    <input type="number" min={1} className={inputCls} value={maxVols}
                      onChange={e => setMaxVols(Number(e.target.value))} />
                  </div>
                </div>
                {/* Row 3: Event lead + action buttons */}
                <div className="grid grid-cols-12 gap-3 items-end">
                  <div className="col-span-2">
                    <label className={labelCls}>Lead first name *</label>
                    <input className={inputCls} value={leadFirst}
                      onChange={e => setLeadFirst(e.target.value)} placeholder="Jane" />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Lead last name *</label>
                    <input className={inputCls} value={leadLast}
                      onChange={e => setLeadLast(e.target.value)} placeholder="Smith" />
                  </div>
                  <div className="col-span-3">
                    <label className={labelCls}>Lead mobile <span className="normal-case font-normal text-gray-400">(optional)</span></label>
                    <input className={inputCls} value={leadMobile}
                      onChange={e => setLeadMobile(e.target.value)} placeholder="+12125550000" />
                  </div>
                  <div className="col-span-5 flex justify-end gap-2">
                    <button type="button" onClick={() => { setEditingDetails(false); setEditSnapshot(null) }}
                      className="px-4 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                      Cancel
                    </button>
                    <button type="submit" disabled={editSaving || !isEditDirty}
                      className="px-6 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2 shadow-sm">
                      {editSaving ? (
                        <>
                          <span className="inline-block h-3.5 w-3.5 border-2 border-white border-r-transparent rounded-full animate-spin" />
                          Saving…
                        </>
                      ) : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </form>
            ) : shift ? (
              /* ── Read-only summary ── */
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm text-gray-700">
                    <span className="font-semibold">{formatDate(shift.date, orgDateFmt)}</span>
                    {' · '}
                    <span style={{ fontFamily: "'DM Mono', monospace" }} className="text-gray-600">
                      {formatTime(shift.start_time)}–{formatTime(shift.end_time)}
                    </span>
                    {shift.location && <> · <span className="text-gray-600">{shift.location}</span></>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Lead: {shift.event_lead_first_name} {shift.event_lead_last_name}
                    {shift.event_lead_mobile && <> · {shift.event_lead_mobile}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {shift.status !== 'cancelled' && (
                    <button onClick={startEditDetails}
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                      Edit Shift
                    </button>
                  )}
                  {shift.assignments.length > 0 && (
                    <button onClick={handleExportCsv}
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1">
                      ⬇ Download Roster
                    </button>
                  )}
                  {shift.status !== 'cancelled' && (
                    <>
                      {shift.status === 'draft' && (
                        <button onClick={handlePublish} disabled={changingStatus}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                          {changingStatus ? 'Publishing…' : '✓ Publish'}
                        </button>
                      )}
                      <button onClick={handleCancelShift} disabled={changingStatus}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
                        {changingStatus ? '…' : 'Cancel shift'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Error banner for panel actions */}
        {panelError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{panelError}</div>
        )}

        {/* ── Dual panel ── */}
        <div className="grid grid-cols-12 gap-4" style={{ minHeight: '500px' }}>

          {/* ──────── Left panel: Available Volunteers ──────── */}
          <div className="col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                  Available
                  <span className="ml-2 font-normal text-gray-400 normal-case">
                    {leftVols.length} volunteer{leftVols.length !== 1 ? 's' : ''}
                  </span>
                </h2>
              </div>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                placeholder="Search by name or mobile…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                disabled={mode === 'create'}
              />
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {mode === 'create' ? (
                <EmptyState icon="👥" title="Create the shift first" sub="Volunteers will appear here once saved" />
              ) : loadingData ? (
                <SkeletonList count={5} />
              ) : leftVols.length === 0 ? (
                <EmptyState
                  icon="✓"
                  title={search.trim() ? 'No matches' : 'All volunteers assigned'}
                  sub={search.trim() ? 'Try a different name or number' : 'Every active volunteer is on this shift'}
                />
              ) : (
                leftVols.map(v => {
                  const color           = avatarColor(v.first_name)
                  const isPendingRemove = pendingRemoves.has(v.id)
                  const canAssign       = !!shift && shift.status !== 'cancelled'
                  return (
                    <button
                      key={v.id}
                      onClick={() => handleAssign(v.id)}
                      disabled={!canAssign}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all group text-left disabled:cursor-not-allowed ${
                        isPendingRemove
                          ? 'border-amber-200 bg-amber-50/60 hover:border-amber-300 hover:bg-amber-50'
                          : 'border-transparent hover:border-blue-200 hover:bg-blue-50/60'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${color.bg} ${color.text}`}>
                        {initials(v.first_name, v.last_name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 leading-snug">
                          {v.first_name} {v.last_name}
                          {isPendingRemove && (
                            <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">Removing</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400 truncate">
                          {v.mobile}
                          {v.last_worked_date && <> · last {formatDate(v.last_worked_date, orgDateFmt)}</>}
                        </p>
                      </div>
                      {isPendingRemove ? (
                        <span className="text-amber-500 text-xs font-medium shrink-0 leading-none">↩ Undo</span>
                      ) : (
                        <span className="text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity text-lg font-bold shrink-0 leading-none">+</span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* ──────── Right panel: Assigned to Shift ──────── */}
          <div className="col-span-7 bg-blue-50/40 rounded-2xl border border-blue-100 shadow-sm flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-blue-100">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                  Assigned to Shift
                  <span className="ml-2 font-normal text-gray-400 normal-case">
                    {effectiveCount} volunteer{effectiveCount !== 1 ? 's' : ''}
                  </span>
                </h2>
                {hasPending && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handleDiscardAssignments}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      Discard
                    </button>
                    <button
                      onClick={handleSaveAssignments}
                      disabled={savingAssignments}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                    >
                      {savingAssignments ? (
                        <>
                          <span className="inline-block h-3 w-3 border-2 border-white border-r-transparent rounded-full animate-spin" />
                          Saving…
                        </>
                      ) : `Save ${pendingCount} change${pendingCount !== 1 ? 's' : ''} →`}
                    </button>
                  </div>
                )}
              </div>

              {/* Capacity indicator */}
              {shift ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-gray-500">Capacity</span>
                    <span className="text-xs font-semibold text-gray-700"
                      style={{ fontFamily: "'DM Mono', monospace" }}>
                      {effectiveCount}&nbsp;/&nbsp;{shift.min_volunteers}–{shift.max_volunteers}
                    </span>
                  </div>
                  <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${capacityBarColor()}`}
                      style={{ width: `${Math.min(effectiveCount / Math.max(shift.max_volunteers, 1), 1) * 100}%` }}
                    />
                  </div>
                  {effectiveCount >= shift.min_volunteers && effectiveCount <= shift.max_volunteers && (
                    <p className="text-xs text-emerald-600 font-semibold mt-1">✓ Fully staffed</p>
                  )}
                </div>
              ) : (
                <div className="h-6 bg-blue-100/50 rounded animate-pulse" />
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {mode === 'create' ? (
                <EmptyState icon="📋" title="No volunteers yet" sub="Add volunteers after creating the shift" dashed />
              ) : loadingData ? (
                <SkeletonList count={3} tint />
              ) : effectiveCount === 0 ? (
                <EmptyState icon="+" title="No volunteers assigned" sub="Click a volunteer on the left to add them" dashed />
              ) : (
                <>
                  {confirmedRight.map(a => {
                    const v     = a.volunteers
                    const color = avatarColor(v.first_name)
                    return (
                      <div key={a.id}
                        className="flex items-center gap-3 p-3 rounded-xl bg-white border border-blue-100 shadow-sm group">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${color.bg} ${color.text}`}>
                          {initials(v.first_name, v.last_name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 leading-snug">
                            {v.first_name} {v.last_name}
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            {v.mobile}{v.email && <> · {v.email}</>}
                          </p>
                        </div>
                        {shift?.status !== 'cancelled' && (
                          <button
                            onClick={() => handleRemove(a.volunteer_id)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all shrink-0 opacity-0 group-hover:opacity-100"
                            title="Stage removal"
                          >
                            <span className="text-base leading-none font-bold">×</span>
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {pendingAddVols.map(v => {
                    const color = avatarColor(v.first_name)
                    return (
                      <div key={v.id}
                        className="flex items-center gap-3 p-3 rounded-xl bg-white border border-amber-200 shadow-sm group">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${color.bg} ${color.text}`}>
                          {initials(v.first_name, v.last_name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 leading-snug">
                            {v.first_name} {v.last_name}
                            <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">New</span>
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            {v.mobile}{v.email && <> · {v.email}</>}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemove(v.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all shrink-0 opacity-0 group-hover:opacity-100"
                          title="Un-stage add"
                        >
                          <span className="text-base leading-none font-bold">×</span>
                        </button>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

function EmptyState({
  icon, title, sub, dashed = false,
}: { icon: string; title: string; sub: string; dashed?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center py-10">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 text-xl ${
        dashed ? 'bg-transparent border-2 border-dashed border-blue-200 text-blue-300' : 'bg-gray-50 text-gray-400'
      }`}>
        {icon}
      </div>
      <p className="text-sm font-semibold text-gray-500">{title}</p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  )
}

function SkeletonList({ count, tint = false }: { count: number; tint?: boolean }) {
  return (
    <div className="space-y-2 p-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`h-14 rounded-xl animate-pulse ${tint ? 'bg-blue-100/50' : 'bg-gray-100'}`} />
      ))}
    </div>
  )
}
