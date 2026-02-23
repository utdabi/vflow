#!/usr/bin/env python3
"""
apply_shifts_migration.py
Feature 4.3: Shift Scheduling & Assignment

Checks whether the shifts / shift_assignments tables exist.
- If they already exist  → runs a quick smoke-test API call and prints the
  Supabase SQL editor URL for reference.
- If they do NOT exist   → prints the full migration SQL plus the URL of the
  Supabase SQL editor so you can paste and run it in one click.

Usage (from repo root):
    cd backend
    uv run python ../scripts/apply_shifts_migration.py
"""

import os
import sys
import pathlib
from dotenv import load_dotenv
from supabase import create_client

# ---------------------------------------------------------------------------
# Load environment
# ---------------------------------------------------------------------------
env_path = pathlib.Path(__file__).parent.parent / "backend" / ".env"
load_dotenv(env_path)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SERVICE_KEY:
    print("❌  SUPABASE_URL or SUPABASE_SERVICE_KEY not found in backend/.env")
    sys.exit(1)

# Extract project ref from URL  https://{ref}.supabase.co
project_ref = SUPABASE_URL.replace("https://", "").split(".")[0]
sql_editor_url = f"https://supabase.com/dashboard/project/{project_ref}/sql/new"

supabase = create_client(SUPABASE_URL, SERVICE_KEY)

# ---------------------------------------------------------------------------
# Check if the tables already exist by trying to query them
# ---------------------------------------------------------------------------
def table_exists(table_name: str) -> bool:
    try:
        supabase.table(table_name).select("id").limit(1).execute()
        return True
    except Exception as exc:
        # PostgREST returns 42P01 (undefined_table) if the table doesn't exist
        return "does not exist" not in str(exc) and "42P01" not in str(exc)


shifts_ok      = table_exists("shifts")
assignments_ok = table_exists("shift_assignments")

# ---------------------------------------------------------------------------
# Read the migration SQL file
# ---------------------------------------------------------------------------
migration_file = pathlib.Path(__file__).parent.parent / "supabase" / "migrations" / "005_shifts.sql"
migration_sql  = migration_file.read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
if shifts_ok and assignments_ok:
    print("✅  Tables already exist: shifts, shift_assignments")
    print()
    print("Running smoke test — creating a test shift via service key…")
    try:
        resp = supabase.table("shifts").insert({
            "organization_id": "00000000-0000-0000-0000-000000000000",  # fake id, will fail RLS on real insert
            "title": "smoke-test",
            "date": "2099-01-01",
            "start_time": "09:00:00",
            "end_time": "12:00:00",
            "min_volunteers": 1,
            "max_volunteers": 3,
            "status": "draft",
            "event_lead_first_name": "Test",
            "event_lead_last_name":  "Lead",
        }).execute()
        if resp.data:
            # Clean up
            shift_id = resp.data[0]["id"]
            supabase.table("shifts").delete().eq("id", shift_id).execute()
            print(f"✅  Smoke test passed (id={shift_id[:8]}… cleaned up)")
        else:
            print("⚠️   Insert returned no data — check RLS policies.")
    except Exception as exc:
        print(f"⚠️   Smoke test error: {exc}")
else:
    missing = []
    if not shifts_ok:           missing.append("shifts")
    if not assignments_ok:      missing.append("shift_assignments")

    print("=" * 70)
    print(f"⚠️   Migration NOT yet applied. Missing tables: {', '.join(missing)}")
    print("=" * 70)
    print()
    print("STEP 1 — Open the Supabase SQL editor:")
    print(f"  {sql_editor_url}")
    print()
    print("STEP 2 — Paste the following SQL and click RUN:")
    print()
    print("-" * 70)
    print(migration_sql)
    print("-" * 70)
    print()
    print("STEP 3 — Re-run this script to confirm the tables were created.")
