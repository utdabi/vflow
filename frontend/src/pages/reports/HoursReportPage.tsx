// HoursReportPage.tsx
// Feature §4.5: Hours Tracking & Reporting
//
// Shows an org-wide volunteer hours report with:
//   - Date range picker (defaults to current month)
//   - Summary cards: Total Hours / Active Volunteers / Avg Hours per Volunteer
//   - Sorted table: Name, # Shifts, Total Hours
//   - Export CSV button
//   - Share Report button → generates a public read-only link valid 30 days

import { useState, useEffect, useCallback } from 'react'
import { reportsApi, type HoursReport } from '../../lib/api'
import AppNav, { APP_NAV_LINKS } from '../../components/AppNav'
import { useAuth } from '../../lib/auth-context'
import { formatDate } from '../../lib/date-format'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function firstDayOfMonthISO(): string {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

function downloadCSV(report: HoursReport) {
  const rows = [
    ['Name', 'Shifts Worked', 'Total Hours'],
    ...report.volunteers.map(v => [
      `${v.last_name}, ${v.first_name}`,
      String(v.shift_count),
      String(v.total_hours),
    ]),
  ]
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const month = report.start_date.slice(0, 7).replace('-', '_')
  a.href = url
  a.download = `volunteer_hours_${month}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HoursReportPage() {
  const { organization } = useAuth()
  const orgDateFmt = organization?.date_format ?? 'INTL'
  const [startDate, setStartDate] = useState(firstDayOfMonthISO())
  const [endDate,   setEndDate]   = useState(todayISO())
  const [report,    setReport]    = useState<HoursReport | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  // Share link state
  const [shareUrl,       setShareUrl]       = useState<string | null>(null)
  const [shareExpiry,    setShareExpiry]    = useState<string | null>(null)
  const [shareBusy,      setShareBusy]      = useState(false)
  const [shareError,     setShareError]     = useState<string | null>(null)
  const [copied,         setCopied]         = useState(false)

  const load = useCallback(async () => {
    if (!startDate || !endDate || startDate > endDate) return
    setLoading(true)
    setError(null)
    setShareUrl(null)
    setShareExpiry(null)
    try {
      const res = await reportsApi.getHours(startDate, endDate)
      setReport(res.data)
    } catch {
      setError('Failed to load report. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  // Load on mount and when date range changes via Apply button
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleShare = async () => {
    setShareBusy(true)
    setShareError(null)
    try {
      const res = await reportsApi.createShareLink(startDate, endDate)
      setShareUrl(res.data.share_url)
      setShareExpiry(res.data.expires_at)
    } catch {
      setShareError('Failed to generate share link.')
    } finally {
      setShareBusy(false)
    }
  }

  const handleCopy = () => {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav links={APP_NAV_LINKS} />

      <div className="max-w-5xl mx-auto p-6">

        {/* ── Header ── */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Volunteer Hours Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Total time logged for volunteers within a date range.
          </p>
        </div>

        {/* ── Date range + Apply ── */}
        <div className="flex flex-wrap items-end gap-3 mb-6 bg-white border border-gray-200 rounded-lg px-5 py-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">From</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">To</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading…' : 'Apply'}
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">{error}</div>
        )}

        {report && (
          <>
            {/* ── Summary cards ── */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                <div className="text-3xl font-bold text-blue-600">{report.total_hours.toFixed(1)}</div>
                <div className="text-sm text-gray-500 mt-1">Total Hours</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                <div className="text-3xl font-bold text-green-600">{report.volunteer_count}</div>
                <div className="text-sm text-gray-500 mt-1">Volunteers</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                <div className="text-3xl font-bold text-purple-600">{report.avg_hours.toFixed(1)}</div>
                <div className="text-sm text-gray-500 mt-1">Avg Hours / Volunteer</div>
              </div>
            </div>

            {/* ── Action buttons ── */}
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => downloadCSV(report)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                ⬇ Export CSV
              </button>
              <button
                onClick={handleShare}
                disabled={shareBusy}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {shareBusy ? 'Generating…' : '🔗 Share Report'}
              </button>
            </div>

            {/* ── Share link banner ── */}
            {shareError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">{shareError}</div>
            )}
            {shareUrl && (
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm font-medium text-blue-900 mb-2">Shareable link (read-only, no login required)</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-white border border-blue-200 rounded px-3 py-2 text-blue-800 break-all">{shareUrl}</code>
                  <button
                    onClick={handleCopy}
                    className="shrink-0 px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                {shareExpiry && (
                  <p className="text-xs text-blue-600 mt-1.5">
                    Expires {formatDate(shareExpiry.split('T')[0], orgDateFmt)}
                  </p>
                )}
              </div>
            )}

            {/* ── Table ── */}
            {report.volunteers.length === 0 ? (
              <div className="text-center py-16 text-gray-400 bg-white border border-gray-200 rounded-lg">
                No hours logged for this period. Use the "Log hours" button in a shift's detail panel.
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Name', 'Shifts Worked', 'Total Hours'].map(h => (
                        <th
                          key={h}
                          className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.volunteers.map(v => (
                      <tr key={v.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-900">
                          {v.last_name}, {v.first_name}
                        </td>
                        <td className="px-5 py-3 text-gray-600">{v.shift_count}</td>
                        <td className="px-5 py-3 font-semibold text-blue-700">{v.total_hours.toFixed(1)}h</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td className="px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase">Total</td>
                      <td className="px-5 py-2.5"></td>
                      <td className="px-5 py-2.5 font-bold text-gray-900">{report.total_hours.toFixed(1)}h</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}

        {loading && !report && (
          <div className="text-center py-16 text-gray-400">Loading report…</div>
        )}

      </div>
    </div>
  )
}
