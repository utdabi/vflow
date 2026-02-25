// api.ts
// Feature 1.1: Organizations & Setup Links
// Axios instance pre-configured to talk to the FastAPI backend.
// The Authorization header is injected automatically from the stored
// Supabase session token before every request.

import axios from 'axios'
import { supabase } from './supabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string ?? 'http://localhost:8000'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Attach the current Supabase JWT to every request automatically
api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ---------------------------------------------------------------------------
// Setup API (public — no auth header needed)
// ---------------------------------------------------------------------------

export interface ValidateTokenResponse {
  organization_id: string
  organization_name: string
  valid: boolean
}

export interface CompleteSetupRequest {
  token: string
  email: string
  password: string
  full_name: string
}

export interface CompleteSetupResponse {
  access_token: string
  token_type: string
  user_id: string
  email: string
  organization_id: string
  organization_name: string
}

export const setupApi = {
  validateToken: (token: string) =>
    api.get<ValidateTokenResponse>(`/api/setup/validate`, { params: { token } }),

  completeSetup: (data: CompleteSetupRequest) =>
    api.post<CompleteSetupResponse>(`/api/setup/complete`, data),
}

// ---------------------------------------------------------------------------
// Organization API (requires auth)
// ---------------------------------------------------------------------------

export type DateFormat = 'US' | 'INTL'

export interface Organization {
  id: string
  name: string
  created_at: string
  /** Base64 data URL (data:image/png;base64,...) or null if not uploaded yet */
  logo_url: string | null
  /** 'US' = MM/DD/YYYY, 'INTL' = DD/MM/YYYY (default) */
  date_format: DateFormat
}

export const organizationsApi = {
  getMe: () => api.get<Organization>('/api/organizations/me'),
  updateMe: (data: { name?: string; date_format?: DateFormat }) =>
    api.patch<Organization>('/api/organizations/me', data),

  /**
   * Upload a real image file (JPG/PNG/GIF/WebP/SVG) as the org logo.
   * The backend base64-encodes it and stores the data URL in the DB.
   * Returns the updated Organization (including the new logo_url).
   */
  uploadLogo: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<Organization>('/api/organizations/logo', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}

// ---------------------------------------------------------------------------
// Volunteer API (requires auth)
// ---------------------------------------------------------------------------

export interface Volunteer {
  id: string
  organization_id: string
  first_name: string
  last_name: string
  gender: string | null
  date_of_birth: string | null
  email: string | null
  mobile: string
  skills: string[]
  notes: string | null
  active: boolean
  total_hours: number
  last_worked_date: string | null
  times_cancelled: number
  /** Days of week the volunteer is typically available. 0=Sun … 6=Sat. [] = no preference. */
  preferred_days: number[]
  /** Current age in years, computed from date_of_birth server-side. Null if DOB not set. */
  age: number | null
  created_at: string
  updated_at: string
}

export interface CreateVolunteerRequest {
  first_name: string
  last_name: string
  gender?: string
  date_of_birth?: string   // YYYY-MM-DD
  email?: string
  mobile: string
  skills?: string[]
  notes?: string
  /** Days of week: 0=Sun … 6=Sat */
  preferred_days?: number[]
}

export interface ImportPreviewResponse {
  valid_rows: (Record<string, unknown> & { action: 'create' | 'update' })[]
  invalid_rows: { row_number: number; error_message: string; raw: Record<string, string> }[]
  valid_count: number
  invalid_count: number
  create_count: number
  update_count: number
}

export interface ImportConfirmResponse {
  created_count: number
  updated_count: number
  errors: string[]
}

/** A volunteer record as returned inside a DuplicatePair — all fields shown in merge UI */
export interface DuplicateVolunteer {
  id: string
  first_name: string
  last_name: string
  mobile: string | null
  email: string | null
  date_of_birth: string | null
  gender: string | null
  preferred_days: number[]
  skills: string[]
  notes: string | null
  updated_at: string | null
  created_at: string | null
  shift_count: number
}

export interface DuplicatePair {
  volunteer_a: DuplicateVolunteer
  volunteer_b: DuplicateVolunteer
  score: number
  confidence: 'likely' | 'possible'
  /** Per-field match status: 'match' | 'close' | 'mismatch' | 'missing' */
  field_matches: Record<'mobile' | 'name' | 'email' | 'date_of_birth', 'match' | 'close' | 'mismatch' | 'missing'>
}

export const volunteersApi = {
  list: (active = true) =>
    api.get<Volunteer[]>('/api/volunteers', { params: { active } }),

  getById: (id: string) =>
    api.get<Volunteer>(`/api/volunteers/${id}`),

  create: (data: CreateVolunteerRequest) =>
    api.post<Volunteer>('/api/volunteers', data),

  update: (id: string, data: Partial<CreateVolunteerRequest & { active: boolean }>) =>
    api.patch<Volunteer>(`/api/volunteers/${id}`, data),

  deactivate: (id: string) =>
    api.delete<Volunteer>(`/api/volunteers/${id}`),

  importPreview: (file: File, dateFormat: string = 'INTL') => {
    const form = new FormData()
    form.append('file', file)
    return api.post<ImportPreviewResponse>(`/api/volunteers/import?date_format=${dateFormat}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  importConfirm: (validRows: Record<string, unknown>[]) =>
    api.post<ImportConfirmResponse>('/api/volunteers/import/confirm', { valid_rows: validRows }),

  downloadSampleCsv: (dateFormat: string = 'INTL') =>
    api.get<string>(`/api/volunteers/sample.csv?date_format=${dateFormat}`),

  findDuplicates: () =>
    api.get<DuplicatePair[]>('/api/volunteers/duplicates'),

  mergeVolunteers: (primaryId: string, secondaryId: string, fieldOverrides: Record<string, unknown> = {}) =>
    api.post<Volunteer>('/api/volunteers/duplicates/merge', {
      primary_id: primaryId,
      secondary_id: secondaryId,
      field_overrides: fieldOverrides,
    }),
}

// ---------------------------------------------------------------------------
// Shifts API (requires auth)
// ---------------------------------------------------------------------------

export type ShiftStatus = 'draft' | 'published' | 'cancelled'

export interface Shift {
  id: string
  organization_id: string
  title: string
  date: string              // YYYY-MM-DD
  start_time: string        // HH:MM:SS
  end_time: string          // HH:MM:SS
  location: string | null
  min_volunteers: number
  max_volunteers: number
  status: ShiftStatus
  event_lead_first_name: string
  event_lead_last_name: string
  event_lead_mobile: string | null
  assigned_count: number    // active (non-cancelled) assignments
  created_at: string
  updated_at: string
}

export interface ShiftAssignment {
  id: string
  shift_id: string
  volunteer_id: string
  assigned_at: string
  cancelled_at: string | null
  cancel_reason: string | null
  volunteers: {
    id: string
    first_name: string
    last_name: string
    mobile: string
    email: string | null
    gender: string | null
    date_of_birth: string | null
    skills: string[]
    notes: string | null
  }
}

export interface ShiftDetail extends Shift {
  assignments: ShiftAssignment[]          // active assignments
  cancelled_assignments: ShiftAssignment[] // cancelled assignments
}

export interface CreateShiftRequest {
  title: string
  date: string          // YYYY-MM-DD
  start_time: string    // HH:MM
  end_time: string      // HH:MM
  location?: string
  min_volunteers: number
  max_volunteers: number
  // status is always 'draft' on creation — do not include it here
  event_lead_first_name: string
  event_lead_last_name: string
  event_lead_mobile?: string
}

/** For PATCH /api/shifts/:id — all fields optional, status included for transitions */
export interface UpdateShiftRequest {
  title?: string
  date?: string
  start_time?: string
  end_time?: string
  location?: string | null
  min_volunteers?: number
  max_volunteers?: number
  status?: ShiftStatus
  event_lead_first_name?: string
  event_lead_last_name?: string
  event_lead_mobile?: string | null
}

export const shiftsApi = {
  listByMonth: (year: number, month: number) =>
    api.get<{ shifts: Shift[]; count: number }>('/api/shifts', {
      params: { year, month },
    }),

  getById: (id: string) =>
    api.get<ShiftDetail>(`/api/shifts/${id}`),

  create: (data: CreateShiftRequest) =>
    api.post<Shift>('/api/shifts', data),

  update: (id: string, data: UpdateShiftRequest) =>
    api.patch<Shift>(`/api/shifts/${id}`, data),

  delete: (id: string) =>
    api.delete(`/api/shifts/${id}`),

  assignVolunteer: (shiftId: string, volunteerId: string) =>
    api.post(`/api/shifts/${shiftId}/assign`, { volunteer_id: volunteerId }),

  cancelAssignment: (shiftId: string, volunteerId: string, reason?: string) =>
    api.delete(`/api/shifts/${shiftId}/assignments/${volunteerId}`, {
      data: { reason },
    }),
}

// ---------------------------------------------------------------------------
// Backup Finder API (requires auth) — prd.md §4.4
// ---------------------------------------------------------------------------

export interface BackupSuggestion {
  volunteer: {
    id: string
    first_name: string
    last_name: string
    mobile: string
  }
  score: number
  reasons: string[]
}

export interface RequestBackupsResult {
  sent_count: number
  total: number
  results: { sent: boolean; stub: boolean; to: string; sid?: string; error?: string }[]
}

export const backupFinderApi = {
  /** Get up to 3 ranked backup candidates for a shift after a cancellation */
  getSuggestions: (shiftId: string, cancelledVolunteerId: string) =>
    api.get<{ suggestions: BackupSuggestion[]; count: number }>(
      `/api/shifts/${shiftId}/backup-suggestions`,
      { params: { cancelled_volunteer_id: cancelledVolunteerId } },
    ),

  /** Send backup-request SMS to selected volunteers (stubbed in dev) */
  requestBackups: (shiftId: string, volunteerIds: string[]) =>
    api.post<RequestBackupsResult>(
      `/api/shifts/${shiftId}/request-backups`,
      { volunteer_ids: volunteerIds },
    ),
}

// ---------------------------------------------------------------------------
// Hours & Reports API (requires auth) — prd.md §4.5
// ---------------------------------------------------------------------------

export interface VolunteerHoursSummary {
  id: string
  first_name: string
  last_name: string
  total_hours: number
  shift_count: number
}

export interface HoursReport {
  organization_name: string
  start_date: string
  end_date: string
  total_hours: number
  volunteer_count: number
  avg_hours: number
  volunteers: VolunteerHoursSummary[]
}

export interface ShareLink {
  token: string
  share_url: string
  expires_at: string
}

export const hoursApi = {
  /** Log (or re-log) hours for a volunteer on a specific shift */
  logHours: (
    shiftId: string,
    data: { volunteer_id: string; hours: number; notes?: string },
  ) => api.post<{ logged: boolean; hours: number; time_log_id: string }>(
    `/api/shifts/${shiftId}/log-hours`,
    data,
  ),
}

export const reportsApi = {
  /** Get the org hours report for a date range (YYYY-MM-DD) */
  getHours: (startDate: string, endDate: string) =>
    api.get<HoursReport>('/api/reports/hours', {
      params: { start_date: startDate, end_date: endDate },
    }),

  /** Create a shareable read-only link for the hours report */
  createShareLink: (startDate: string, endDate: string) =>
    api.post<ShareLink>('/api/reports/share-link', {
      start_date: startDate,
      end_date: endDate,
    }),

  /** Fetch a shared report via its public token (no auth required) */
  getShared: (token: string) =>
    api.get<HoursReport>(`/api/reports/shared/${token}`),
}
