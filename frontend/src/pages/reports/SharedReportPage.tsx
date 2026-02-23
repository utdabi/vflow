// SharedReportPage.tsx
// Feature §4.5: Hours Tracking & Reporting
//
// Public page — no login required.
// Reads the :token URL param, fetches the shared report, and renders it read-only.
// Shows org name, date range, summary cards, and volunteer hours table.
// Error states: 404 (not found) and 410 (expired).

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { reportsApi, type HoursReport } from '../../lib/api'

export default function SharedReportPage() {
  const { token } = useParams<{ token: string }>()
  const [report,  setReport]  = useState<HoursReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [status,  setStatus]  = useState<'ok' | 'not_found' | 'expired' | 'error'>('ok')

  useEffect(() => {
    if (!token) { setStatus('not_found'); setLoading(false); return }
    reportsApi.getShared(token)
      .then(res => { setReport(res.data); setLoading(false) })
      .catch((err: unknown) => {
        const httpStatus = (err as { response?: { status?: number } })?.response?.status
        setLoading(false)
        if      (httpStatus === 410) setStatus('expired')
        else if (httpStatus === 404) setStatus('not_found')
        else                         setStatus('error')
      })
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading report…</p>
      </div>
    )
  }

  if (status === 'expired') {
    return <ErrorPage title="Link Expired" message="This report link has expired. Ask your coordinator to generate a new one." />
  }

  if (status === 'not_found') {
    return <ErrorPage title="Report Not Found" message="This link is invalid or has been removed." />
  }

  if (status === 'error' || !report) {
    return <ErrorPage title="Something went wrong" message="Could not load the report. Please try again later." />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Simple header — no nav since this is public */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">VolunteerFlow</p>
            <h1 className="text-xl font-bold text-gray-900">{report.organization_name}</h1>
          </div>
          <div className="text-right text-sm text-gray-500">
            <p>Volunteer Hours Report</p>
            <p className="text-xs">
              {formatDateDisplay(report.start_date)} – {formatDateDisplay(report.end_date)}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">

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

        {/* ── Table ── */}
        {report.volunteers.length === 0 ? (
          <div className="text-center py-16 text-gray-400 bg-white border border-gray-200 rounded-lg">
            No hours logged for this period.
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

        <p className="text-xs text-gray-400 text-center mt-6">
          Generated by VolunteerFlow · Read-only shared report
        </p>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ErrorPage({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center max-w-sm w-full">
        <div className="text-4xl mb-4">🔗</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-sm text-gray-500">{message}</p>
      </div>
    </div>
  )
}

function formatDateDisplay(iso: string): string {
  // "2026-02-01" → "1 Feb 2026"
  const [year, month, day] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`
}
