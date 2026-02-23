// supabase.ts
// Feature 1.1: Organizations & Setup Links
// Initializes and exports the Supabase browser client (anon key).
// This client is used for auth operations on the frontend.
// All database reads/writes go through the FastAPI backend (which uses
// the service-role key server-side) — the anon client is only used here
// for session management (sign-in, sign-out, session listening).

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Copy frontend/.env.example to frontend/.env and fill in the values.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,           // stores session in localStorage
    autoRefreshToken: true,         // silently refreshes JWT before expiry
    detectSessionInUrl: false,      // we handle the setup redirect manually
  },
})
