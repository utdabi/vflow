// lib/api.ts
// Axios instance pre-configured to talk to the FastAPI backend.
// Ported from frontend/src/lib/api.ts — changes:
//   - import.meta.env.VITE_* → process.env.EXPO_PUBLIC_*
//   - Removed: CSV import/export, duplicates, hours/reports functions
//   - Kept: setup, organizations, volunteers, shifts, backup finder

import axios from 'axios'
import { supabase } from './supabase'

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'

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
    api.get<ValidateTokenResponse>('/api/setup/validate', { params: { token } }),

  completeSetup: (data: CompleteSetupRequest) =>
    api.post<CompleteSetupResponse>('/api/setup/complete', data),
}

// ---------------------------------------------------------------------------
// Organization API (requires auth)
// ---------------------------------------------------------------------------

export type DateFormat = 'US' | 'INTL'

export interface Organization {
  id: string
  name: string
  created_at: string
  logo_url: string | null
  date_format: DateFormat
}

export const organizationsApi = {
  getMe: () => api.get<Organization>('/api/organizations/me'),
  updateMe: (data: { name?: string; date_format?: DateFormat }) =>
    api.patch<Organization>('/api/organizations/me', data),
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
  preferred_days: number[]
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
  preferred_days?: number[]
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
  assigned_count: number
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
  assignments: ShiftAssignment[]
  cancelled_assignments: ShiftAssignment[]
}

export interface CreateShiftRequest {
  title: string
  date: string
  start_time: string
  end_time: string
  location?: string
  min_volunteers: number
  max_volunteers: number
  event_lead_first_name: string
  event_lead_last_name: string
  event_lead_mobile?: string
}

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
    api.get<{ shifts: Shift[]; count: number }>('/api/shifts', { params: { year, month } }),

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
    api.delete(`/api/shifts/${shiftId}/assignments/${volunteerId}`, { data: { reason } }),
}

// ---------------------------------------------------------------------------
// Backup Finder API (requires auth) — gated by enable-backup-finder LD flag
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
  getSuggestions: (shiftId: string, cancelledVolunteerId: string) =>
    api.get<{ suggestions: BackupSuggestion[]; count: number }>(
      `/api/shifts/${shiftId}/backup-suggestions`,
      { params: { cancelled_volunteer_id: cancelledVolunteerId } },
    ),

  requestBackups: (shiftId: string, volunteerIds: string[]) =>
    api.post<RequestBackupsResult>(
      `/api/shifts/${shiftId}/request-backups`,
      { volunteer_ids: volunteerIds },
    ),
}
