#!/usr/bin/env python3
# create_org.py
# Feature 1.1: Organizations & Setup Links
#
# Admin utility — run this manually to onboard a new beta organization.
# It creates the organization row, generates a one-time setup token,
# and prints the URL to email to the coordinator.
#
# Usage:
#   python scripts/create_org.py "Acme Food Bank"
#
# Prerequisites:
#   - backend/.env must have SUPABASE_URL and SUPABASE_SERVICE_KEY set
#   - Run from the repo root (or set BACKEND_ENV_PATH env var to override)
#
# The script uses the service-role key (bypasses RLS) via the Supabase
# Python client so it can insert directly into the organizations table.

import sys
import os
from pathlib import Path


def load_env(env_path: Path) -> None:
    """Minimal .env parser — avoids needing python-dotenv in the script context."""
    if not env_path.exists():
        print(f"ERROR: .env file not found at {env_path}")
        print("       Copy backend/.env.example to backend/.env and fill in credentials.")
        sys.exit(1)

    with env_path.open() as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python scripts/create_org.py \"Organization Name\"")
        sys.exit(1)

    org_name = " ".join(sys.argv[1:]).strip()
    if not org_name:
        print("ERROR: Organization name cannot be empty.")
        sys.exit(1)

    # ------------------------------------------------------------------
    # Load environment variables from backend/.env
    # ------------------------------------------------------------------
    repo_root = Path(__file__).resolve().parent.parent
    env_path = Path(os.environ.get("BACKEND_ENV_PATH", repo_root / "backend" / ".env"))
    load_env(env_path)

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_service_key = os.environ.get("SUPABASE_SERVICE_KEY")
    app_base_url = os.environ.get("APP_BASE_URL", "https://app.volunteerflow.com")

    if not supabase_url or not supabase_service_key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in backend/.env")
        sys.exit(1)

    # ------------------------------------------------------------------
    # Connect to Supabase with service-role key (bypasses RLS)
    # ------------------------------------------------------------------
    try:
        from supabase import create_client
    except ImportError:
        print("ERROR: supabase package not installed.")
        print("       Run: cd backend && uv sync")
        sys.exit(1)

    client = create_client(supabase_url, supabase_service_key)

    # ------------------------------------------------------------------
    # 1. Insert the organization row (no token yet)
    # ------------------------------------------------------------------
    print(f"\nCreating organization: \"{org_name}\"...")

    try:
        insert_response = (
            client.table("organizations")
            .insert({"name": org_name})
            .execute()
        )
    except Exception as exc:
        print(f"ERROR: Failed to insert organization — {exc}")
        sys.exit(1)

    if not insert_response.data:
        print("ERROR: Insert returned no data. Check Supabase logs.")
        sys.exit(1)

    org_id: str = insert_response.data[0]["id"]
    print(f"  ✓ Organization created (id: {org_id})")

    # ------------------------------------------------------------------
    # 2. Generate a one-time setup token via the database function.
    #    generate_setup_token() stores the token + 7-day expiry on the row
    #    and returns the UUID token.
    # ------------------------------------------------------------------
    try:
        rpc_response = client.rpc("generate_setup_token", {"org_id": org_id}).execute()
    except Exception as exc:
        print(f"ERROR: Failed to generate setup token — {exc}")
        sys.exit(1)

    token: str = rpc_response.data
    print(f"  ✓ Setup token generated (expires in 7 days)")

    # ------------------------------------------------------------------
    # 3. Print the setup URL
    # ------------------------------------------------------------------
    setup_url = f"{app_base_url}/setup?token={token}"

    print("\n" + "=" * 60)
    print("  SETUP LINK — email this to the coordinator:")
    print()
    print(f"  {setup_url}")
    print()
    print("  The link expires in 7 days and can only be used once.")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
