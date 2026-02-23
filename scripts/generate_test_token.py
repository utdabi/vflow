#!/usr/bin/env python3
"""
generate_test_token.py
Creates a fresh test org in Supabase and prints a one-time setup token.

Usage (from project root):
  uv run python scripts/generate_test_token.py

Then pass the printed token to the regression test:
  node scripts/regression_test.mjs <token>
"""
import time
import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

# Load backend env vars
load_dotenv(Path(__file__).parent.parent / "backend" / ".env")

url = os.environ["SUPABASE_URL"]
key = os.environ["SUPABASE_SERVICE_KEY"]
base_url = os.environ.get("APP_BASE_URL", "http://localhost:5173")

client = create_client(url, key)

run_id = int(time.time())
org_name = f"Playwright Regression {run_id}"

# Create org
org = client.table("organizations").insert({"name": org_name}).execute()
org_id = org.data[0]["id"]

# Generate setup token via DB RPC (7-day expiry, single-use)
token_result = client.rpc("generate_setup_token", {"org_id": org_id}).execute()
token = token_result.data

setup_url = f"{base_url}/setup?token={token}"

print(f"Org name : {org_name}")
print(f"Token    : {token}")
print(f"Setup URL: {setup_url}")
print()
print(f"Run test : node scripts/regression_test.mjs {token}")
