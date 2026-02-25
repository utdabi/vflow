// DuplicatesPage.tsx
// Feature: Data Quality — Duplicate Volunteer Detection (prd.md §4.3a)
//
// Runs a Fellegi-Sunter weighted score (with Jaro-Winkler name matching) against
// the org's active volunteers and shows candidate duplicate pairs grouped into
// collapsible accordions by confidence band. Clicking a row opens a modal with
// the full field comparison table; the coordinator picks which record survives and
// which field values to keep. The secondary record is permanently deleted on merge.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { volunteersApi, type DuplicatePair, type DuplicateVolunteer } from '../../lib/api'
import AppNav, { APP_NAV_LINKS } from '../../components/AppNav'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_ABBREVS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/** Fields the coordinator can choose between (radio buttons) */
const CHOOSABLE_FIELDS: Array<keyof DuplicateVolunteer> = [
  'first_name', 'last_name', 'mobile', 'email', 'date_of_birth', 'gender', 'preferred_days', 'skills', 'notes',
]

const FIELD_LABELS: Record<string, string> = {
  first_name:     'First name',
  last_name:      'Last name',
  mobile:         'Mobile',
  email:          'Email',
  date_of_birth:  'Date of birth',
  gender:         'Gender',
  preferred_days: 'Preferred days',
  skills:         'Skills',
  notes:          'Notes',
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function isRich(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v.trim() !== ''
  return true
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const sa = [...(a as unknown[])].map(String).sort()
    const sb = [...(b as unknown[])].map(String).sort()
    return sa.length === sb.length && sa.every((x, i) => x === sb[i])
  }
  return a === b
}

function initFieldChoices(pair: DuplicatePair): Record<string, 'a' | 'b'> {
  const choices: Record<string, 'a' | 'b'> = {}
  for (const f of CHOOSABLE_FIELDS) {
    const va = pair.volunteer_a[f]
    const vb = pair.volunteer_b[f]
    choices[f] = isRich(va) ? 'a' : isRich(vb) ? 'b' : 'a'
  }
  return choices
}

function buildFieldOverrides(
  primarySide: 'a' | 'b',
  choices: Record<string, 'a' | 'b'>,
  pair: DuplicatePair,
): Record<string, unknown> {
  const secondarySide: 'a' | 'b' = primarySide === 'a' ? 'b' : 'a'
  const secondary = secondarySide === 'b' ? pair.volunteer_b : pair.volunteer_a
  const overrides: Record<string, unknown> = {}
  for (const [field, chosen] of Object.entries(choices)) {
    if (chosen === secondarySide) {
      overrides[field] = secondary[field as keyof DuplicateVolunteer]
    }
  }
  return overrides
}

// ---------------------------------------------------------------------------
// FieldValue — renders a single field value with appropriate formatting
// ---------------------------------------------------------------------------

function FieldValue({ field, vol }: { field: string; vol: DuplicateVolunteer }) {
  const v = vol[field as keyof DuplicateVolunteer]

  if (!isRich(v)) {
    return <span className="text-gray-400 italic text-sm">—</span>
  }

  if (field === 'preferred_days' && Array.isArray(v)) {
    return (
      <div className="flex flex-wrap gap-0.5">
        {[...(v as number[])].sort((a, b) => a - b).map(d => (
          <span key={d} className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-1 py-0.5 rounded">
            {DAY_ABBREVS[d]}
          </span>
        ))}
      </div>
    )
  }

  if (field === 'skills' && Array.isArray(v)) {
    return (
      <div className="flex flex-wrap gap-1">
        {(v as string[]).map(s => (
          <span key={s} className="inline-block bg-blue-50 text-blue-700 text-xs px-1.5 py-0.5 rounded">{s}</span>
        ))}
      </div>
    )
  }

  if (field === 'updated_at' && typeof v === 'string') {
    return <span className="text-sm text-gray-700">{new Date(v).toLocaleDateString()}</span>
  }

  return <span className="text-sm text-gray-800">{String(v)}</span>
}

// ---------------------------------------------------------------------------
// Match indicator and row colouring
// ---------------------------------------------------------------------------

type MatchStatus = 'match' | 'close' | 'mismatch' | 'missing'

function rowBgClass(status: MatchStatus): string {
  if (status === 'match')    return 'bg-green-50'
  if (status === 'close')    return 'bg-amber-50'
  if (status === 'mismatch') return 'bg-red-50/50'
  return ''
}

function MatchIndicator({ status }: { status: MatchStatus }) {
  if (status === 'match')    return <span className="text-green-600 text-xs font-medium">✓</span>
  if (status === 'close')    return <span className="text-amber-500 text-xs font-medium">~</span>
  if (status === 'mismatch') return <span className="text-red-400 text-xs font-medium">✗</span>
  return <span className="text-gray-300 text-xs">—</span>
}

// ---------------------------------------------------------------------------
// PairTable — comparison table for one pair with field-level radio picking
// ---------------------------------------------------------------------------

function PairTable({
  pair,
  onRequestMerge,
  merging,
}: {
  pair: DuplicatePair
  onRequestMerge: (primarySide: 'a' | 'b', overrides: Record<string, unknown>) => void
  merging: boolean
}) {
  const [choices, setChoices] = useState<Record<string, 'a' | 'b'>>(() => initFieldChoices(pair))

  const volA = pair.volunteer_a
  const volB = pair.volunteer_b

  function handleKeep(side: 'a' | 'b') {
    onRequestMerge(side, buildFieldOverrides(side, choices, pair))
  }

  function getMatchStatus(field: string): MatchStatus {
    const lookupKey = (field === 'first_name' || field === 'last_name') ? 'name' : field
    if (lookupKey in pair.field_matches) {
      return pair.field_matches[lookupKey as keyof typeof pair.field_matches] as MatchStatus
    }
    const va = volA[field as keyof DuplicateVolunteer]
    const vb = volB[field as keyof DuplicateVolunteer]
    if (!isRich(va) && !isRich(vb)) return 'missing'
    if (!isRich(va) || !isRich(vb)) return 'missing'
    if (valuesEqual(va, vb)) return 'match'
    return 'mismatch'
  }

  const radioGroupPrefix = `${volA.id}-${volB.id}`

  return (
    <div>
      <div className="rounded-xl overflow-hidden border border-gray-200">
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-24" />
            <col />
            <col className="w-12" />
            <col />
          </colgroup>
          <thead>
            <tr className="bg-gray-100 border-b border-gray-200">
              <th className="py-2 pl-3 pr-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Field</th>
              <th className="py-2 px-2 text-left text-xs font-semibold text-gray-700">{volA.first_name} {volA.last_name}</th>
              <th />
              <th className="py-2 px-2 text-left text-xs font-semibold text-gray-700">{volB.first_name} {volB.last_name}</th>
            </tr>
          </thead>
          <tbody>
            {CHOOSABLE_FIELDS.map(field => {
              const fKey = field as string
              const va = volA[field]
              const vb = volB[field]
              const richA = isRich(va)
              const richB = isRich(vb)
              const equal = valuesEqual(va, vb)
              const canChoose = richA && richB && !equal
              const status = getMatchStatus(fKey)
              const chosenA = !canChoose || choices[fKey] === 'a'
              const chosenB = !canChoose || choices[fKey] === 'b'

              return (
                <tr key={fKey} className={`border-b border-gray-100 last:border-0 ${rowBgClass(status)}`}>
                  <td className="py-2 pl-3 pr-2">
                    <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
                      {FIELD_LABELS[fKey]}
                    </span>
                  </td>

                  <td
                    className={`py-1.5 px-2 cursor-pointer transition-colors ${canChoose && chosenA ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''}`}
                    onClick={canChoose ? () => setChoices(prev => ({ ...prev, [fKey]: 'a' })) : undefined}
                  >
                    <FieldValue field={fKey} vol={volA} />
                  </td>

                  <td className="py-2 text-center">
                    {canChoose ? (
                      <div className="flex items-center justify-center gap-1.5">
                        <input
                          type="radio"
                          name={`${radioGroupPrefix}-${fKey}`}
                          value="a"
                          checked={choices[fKey] === 'a'}
                          onChange={() => setChoices(prev => ({ ...prev, [fKey]: 'a' }))}
                          className="accent-blue-600 cursor-pointer"
                        />
                        <input
                          type="radio"
                          name={`${radioGroupPrefix}-${fKey}`}
                          value="b"
                          checked={choices[fKey] === 'b'}
                          onChange={() => setChoices(prev => ({ ...prev, [fKey]: 'b' }))}
                          className="accent-blue-600 cursor-pointer"
                        />
                      </div>
                    ) : (
                      <MatchIndicator status={status} />
                    )}
                  </td>

                  <td
                    className={`py-1.5 px-2 cursor-pointer transition-colors ${canChoose && chosenB ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''}`}
                    onClick={canChoose ? () => setChoices(prev => ({ ...prev, [fKey]: 'b' })) : undefined}
                  >
                    <FieldValue field={fKey} vol={volB} />
                  </td>
                </tr>
              )
            })}

            {/* Last updated row — info only */}
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <td className="py-2 pl-3 pr-2">
                <span className="text-xs font-medium text-gray-400 whitespace-nowrap">Last updated</span>
              </td>
              <td className="py-2 px-2"><FieldValue field="updated_at" vol={volA} /></td>
              <td />
              <td className="py-2 px-2"><FieldValue field="updated_at" vol={volB} /></td>
            </tr>

            {/* Shift count row — info only */}
            <tr className="bg-gray-50/60">
              <td className="py-2 pl-3 pr-2">
                <span className="text-xs font-medium text-gray-400 whitespace-nowrap">Shifts</span>
              </td>
              <td className="py-2 px-2">
                <span className="text-sm text-gray-700">
                  {volA.shift_count === 1 ? '1 shift' : `${volA.shift_count} shifts`}
                </span>
              </td>
              <td />
              <td className="py-2 px-2">
                <span className="text-sm text-gray-700">
                  {volB.shift_count === 1 ? '1 shift' : `${volB.shift_count} shifts`}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Keep buttons */}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => handleKeep('a')}
          disabled={merging}
          className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors"
        >
          {merging ? 'Merging…' : 'Keep Record →'}
        </button>
        <button
          onClick={() => handleKeep('b')}
          disabled={merging}
          className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors"
        >
          {merging ? 'Merging…' : '← Keep Record'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConfidenceBadge
// ---------------------------------------------------------------------------

function ConfidenceBadge({ confidence, score }: { confidence: 'likely' | 'possible'; score: number }) {
  if (confidence === 'likely') {
    return (
      <span className="inline-flex items-center gap-1.5 bg-red-50 text-red-700 text-xs font-medium px-2.5 py-1 rounded-full border border-red-200">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
        Likely duplicate · Score {score}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 text-xs font-medium px-2.5 py-1 rounded-full border border-amber-200">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
      Possible duplicate · Score {score}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Merge confirmation dialog
// ---------------------------------------------------------------------------

function MergeConfirmDialog({
  primary,
  secondary,
  overrideCount,
  onConfirm,
  onCancel,
  busy,
}: {
  primary: DuplicateVolunteer
  secondary: DuplicateVolunteer
  overrideCount: number
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4">
        <h3 className="text-base font-semibold text-gray-900 mb-2">Merge records?</h3>
        <p className="text-sm text-gray-600 mb-2">
          All of <span className="font-medium">{secondary.first_name} {secondary.last_name}</span>'s
          shift assignments and time logs will move to{' '}
          <span className="font-medium">{primary.first_name} {primary.last_name}</span>.
          The {secondary.first_name} {secondary.last_name} record will be permanently deleted.
          This can't be undone.
        </p>
        {overrideCount > 0 && (
          <p className="text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2 mb-3">
            {overrideCount} field{overrideCount !== 1 ? 's' : ''} from{' '}
            {secondary.first_name}'s record will be copied to {primary.first_name}.
          </p>
        )}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {busy ? 'Merging…' : 'Yes, merge and delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PairCard — wraps PairTable with dismiss link and merge confirmation
// ---------------------------------------------------------------------------

type PairKey = string  // `${a.id}:${b.id}`

function pairKey(pair: DuplicatePair): PairKey {
  return `${pair.volunteer_a.id}:${pair.volunteer_b.id}`
}

function PairCard({
  pair,
  onDismiss,
  onMerge,
  merging,
}: {
  pair: DuplicatePair
  onDismiss: () => void
  onMerge: (primaryId: string, secondaryId: string, overrides: Record<string, unknown>) => void
  merging: boolean
}) {
  const [pending, setPending] = useState<{
    primary: DuplicateVolunteer
    secondary: DuplicateVolunteer
    overrides: Record<string, unknown>
  } | null>(null)

  function handleRequestMerge(side: 'a' | 'b', overrides: Record<string, unknown>) {
    const primary   = side === 'a' ? pair.volunteer_a : pair.volunteer_b
    const secondary = side === 'a' ? pair.volunteer_b : pair.volunteer_a
    setPending({ primary, secondary, overrides })
  }

  function handleConfirm() {
    if (!pending) return
    onMerge(pending.primary.id, pending.secondary.id, pending.overrides)
    setPending(null)
  }

  return (
    <>
      <PairTable
        pair={pair}
        onRequestMerge={handleRequestMerge}
        merging={merging}
      />

      <div className="mt-3 text-center">
        <button
          onClick={onDismiss}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors underline"
        >
          Not duplicates
        </button>
      </div>

      {pending && (
        <MergeConfirmDialog
          primary={pending.primary}
          secondary={pending.secondary}
          overrideCount={Object.keys(pending.overrides).length}
          onConfirm={handleConfirm}
          onCancel={() => setPending(null)}
          busy={merging}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// inferReason — human-readable match reason for the compact list row
// ---------------------------------------------------------------------------

function inferReason(fm: DuplicatePair['field_matches']): string {
  if (fm.mobile === 'match')        return 'Same mobile'
  if (fm.email  === 'match')        return 'Same email'
  if (fm.name   === 'match')        return 'Same name'
  if (fm.name   === 'close')        return 'Similar name'
  if (fm.date_of_birth === 'match') return 'Same date of birth'
  return 'Similar records'
}

// ---------------------------------------------------------------------------
// PairListRow — compact clickable row inside an accordion
// ---------------------------------------------------------------------------

function PairListRow({ pair, onSelect }: { pair: DuplicatePair; onSelect: () => void }) {
  const reason = inferReason(pair.field_matches)
  const volA = pair.volunteer_a
  const volB = pair.volunteer_b
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
    >
      <span className="text-sm text-gray-800 font-medium">
        {volA.first_name} {volA.last_name}
        <span className="text-gray-400 font-normal mx-2">—</span>
        {volB.first_name} {volB.last_name}
      </span>
      <span className="flex items-center gap-3 shrink-0 ml-4">
        <span className="text-xs text-gray-400">{reason}</span>
        <span className="text-gray-300 text-base">›</span>
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// ConfidenceGroup — collapsible accordion for one confidence band
// ---------------------------------------------------------------------------

function ConfidenceGroup({
  label,
  scoreRange,
  pairs,
  onSelect,
}: {
  label: string
  scoreRange: string
  pairs: DuplicatePair[]
  onSelect: (pair: DuplicatePair) => void
}) {
  const [open, setOpen] = useState(true)
  if (pairs.length === 0) return null

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden mb-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-gray-400 text-base transition-transform duration-150 inline-block ${open ? 'rotate-90' : ''}`}
          >
            ›
          </span>
          <span className="text-sm font-medium text-gray-800">{label}</span>
          <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5">
            {pairs.length}
          </span>
        </div>
        <span className="text-xs text-gray-400">{scoreRange}</span>
      </button>
      {open && (
        <div className="divide-y divide-gray-100">
          {pairs.map(pair => (
            <PairListRow key={pairKey(pair)} pair={pair} onSelect={() => onSelect(pair)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DuplicatesPage() {
  const [pairs, setPairs] = useState<DuplicatePair[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<PairKey>>(new Set())
  const [merging, setMerging] = useState<PairKey | null>(null)
  const [mergedNames, setMergedNames] = useState<string[]>([])
  const [scanned, setScanned] = useState(false)
  const [selectedPair, setSelectedPair] = useState<DuplicatePair | null>(null)

  async function scan() {
    setLoading(true)
    setError(null)
    setDismissed(new Set())
    setMergedNames([])
    setSelectedPair(null)
    try {
      const res = await volunteersApi.findDuplicates()
      setPairs(res.data)
      setScanned(true)
    } catch {
      setError('Scan failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleMerge(
    key: PairKey,
    primaryId: string,
    secondaryId: string,
    secondaryName: string,
    overrides: Record<string, unknown>,
  ) {
    setMerging(key)
    try {
      await volunteersApi.mergeVolunteers(primaryId, secondaryId, overrides)
      setMergedNames(prev => [...prev, secondaryName])
      setPairs(prev => prev.filter(p => pairKey(p) !== key))
    } catch {
      setError('Merge failed. Please try again.')
    } finally {
      setMerging(null)
    }
  }

  const visiblePairs = pairs.filter(p => !dismissed.has(pairKey(p)))
  const likelyPairs   = visiblePairs.filter(p => p.confidence === 'likely')
  const possiblePairs = visiblePairs.filter(p => p.confidence === 'possible')

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav links={APP_NAV_LINKS} />

      <main className="max-w-3xl mx-auto px-4 py-8">
        <Link to="/volunteers" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
          ← Back to volunteers
        </Link>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Data Quality</h1>
            <p className="text-sm text-gray-500 mt-1">Find and merge duplicate volunteer records.</p>
          </div>
          <button
            onClick={scan}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {loading ? 'Scanning…' : 'Run Scan'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {mergedNames.length > 0 && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-4 space-y-1">
            {mergedNames.map((name, i) => (
              <p key={i}>Merged: {name} record deleted.</p>
            ))}
          </div>
        )}

        {scanned && !loading && visiblePairs.length === 0 && (
          <p className="text-green-700 font-medium text-sm mb-4">No duplicates found.</p>
        )}

        {scanned && !loading && visiblePairs.length > 0 && (
          <>
            <ConfidenceGroup
              label="Likely duplicates"
              scoreRange="Score 12+"
              pairs={likelyPairs}
              onSelect={setSelectedPair}
            />
            <ConfidenceGroup
              label="Possible duplicates"
              scoreRange="Score 6–11"
              pairs={possiblePairs}
              onSelect={setSelectedPair}
            />
          </>
        )}

        {!scanned && !loading && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-sm">Click "Run Scan" to check your volunteer list.</p>
          </div>
        )}
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Modal — opens when a row is clicked                                 */}
      {/* ------------------------------------------------------------------ */}
      {selectedPair && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelectedPair(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Sticky header */}
            <div className="flex items-start justify-between px-5 py-4 border-b shrink-0">
              <div>
                <ConfidenceBadge
                  confidence={selectedPair.confidence}
                  score={selectedPair.score}
                />
                <p className="mt-1.5 text-sm text-gray-500">
                  {selectedPair.volunteer_a.first_name} {selectedPair.volunteer_a.last_name}
                  {' '}vs{' '}
                  {selectedPair.volunteer_b.first_name} {selectedPair.volunteer_b.last_name}
                </p>
              </div>
              <button
                onClick={() => setSelectedPair(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-4 mt-0.5"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto p-5">
              <PairCard
                pair={selectedPair}
                onDismiss={() => {
                  setDismissed(prev => new Set([...prev, pairKey(selectedPair)]))
                  setSelectedPair(null)
                }}
                onMerge={(primaryId, secondaryId, overrides) => {
                  const key = pairKey(selectedPair)
                  const secondary =
                    primaryId === selectedPair.volunteer_a.id
                      ? selectedPair.volunteer_b
                      : selectedPair.volunteer_a
                  setSelectedPair(null)
                  handleMerge(
                    key,
                    primaryId,
                    secondaryId,
                    `${secondary.first_name} ${secondary.last_name}`,
                    overrides,
                  )
                }}
                merging={merging === pairKey(selectedPair)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
