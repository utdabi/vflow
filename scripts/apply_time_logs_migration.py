#!/usr/bin/env python3
"""
apply_time_logs_migration.py
Feature 4.5: Hours Tracking & Reporting

Checks whether the time_logs / report_share_links tables exist.
- If they already exist  → prints a quick confirmation.
- If they do NOT exist   → prints the migration SQL and the Supabase SQL
  editor URL so you can paste and run it in one click.

Usage (from repo root):
    cd backend
    uv run python ../scripts/apply_time_logs_migration.py
"""

import os
import sys
import pathlib
from dotenv import load_dotenv
from supabase import create_client

env_path = pathlib.Path(__file__).parent.parent / "backend" / ".env"
load_dotenv(env_path)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SERVICE_KEY:
    print("SUPABASE_URL or SUPABASE_SERVICE_KEY not found in backend/.env")
    sys.exit(1)

project_ref    = SUPABASE_URL.replace("https://", "").split(".")[0]
sql_editor_url = f"https://supabase.com/dashboard/project/{project_ref}/sql/new"

supabase = create_client(SUPABASE_URL, SERVICE_KEY)

def table_exists(table_name: str) -> bool:
    try:
        supabase.table(table_name).select("id").limit(1).execute()
        return True
    except Exception as exc:
        return "does not exist" not in str(exc) and "42P01" not in str(exc)

time_logs_ok  = table_exists("time_logs")
share_links_ok = table_exists("report_share_links")

migration_file = pathlib.Path(__file__).parent.parent / "supabase" / "migrations" / "006_time_logs.sql"
migration_sql  = migration_file.read_text(encoding="utf-8")

if time_logs_ok and share_links_ok:
    print("Tables already exist: time_logs, report_share_links")
    print("Migration 006 is already applied.")
else:
    missing = []
    if not time_logs_ok:   missing.append("time_logs")
    if not share_links_ok: missing.append("report_share_links")

    print("=" * 70)
    print(f"Migration NOT yet applied. Missing tables: {', '.join(missing)}")
    print("=" * 70)
    print()
    print("STEP 1 - Open the Supabase SQL editor:")
    print(f"  {sql_editor_url}")
    print()
    print("STEP 2 - Paste the following SQL and click RUN:")
    print()
    print("-" * 70)
    print(migration_sql)
    print("-" * 70)
    print()
    print("STEP 3 - Re-run this script to confirm the tables were created.")
