# reports.py
# Feature §4.5: Hours Tracking & Reporting
#
# Endpoints:
#   GET  /api/reports/hours                — org hours report (authenticated, date range)
#   POST /api/reports/share-link           — create a shareable read-only link (authenticated)
#   GET  /api/reports/shared/{token}       — read report via share token (PUBLIC — no auth)
#
# Hours are sourced from the time_logs table (one row per shift+volunteer).
# The share link stores report_type + parameters (date range) + expires in 30 days.

import logging
from datetime import date as date_type, datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from supabase import Client, create_client

from app.auth import CurrentUser, get_current_user
from app.config import get_settings, Settings

logger = logging.getLogger("volunteerflow.reports")
router = APIRouter(prefix="/api/reports", tags=["reports"])


# ---------------------------------------------------------------------------
# Dependency helpers
# ---------------------------------------------------------------------------

def get_supabase_admin(settings: Settings = Depends(get_settings)) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class VolunteerHoursSummary(BaseModel):
    id: str
    first_name: str
    last_name: str
    total_hours: float
    shift_count: int


class HoursReport(BaseModel):
    organization_name: str
    start_date: str
    end_date: str
    total_hours: float
    volunteer_count: int
    avg_hours: float
    volunteers: list[VolunteerHoursSummary]


class ShareLinkRequest(BaseModel):
    start_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")


class ShareLinkResponse(BaseModel):
    token: str
    share_url: str
    expires_at: str


# ---------------------------------------------------------------------------
# Internal helper — build hours report for an org + date range
# ---------------------------------------------------------------------------

def _build_report(
    client: Client,
    org_id: str,
    start_date: str,
    end_date: str,
    org_name: str,
) -> HoursReport:
    """
    Query time_logs for the given org and date range, join to shifts (for the shift date)
    and volunteers (for the name). Aggregate per volunteer.
    """
    logger.info(
        "Supabase → hours report (org=%s start=%s end=%s)", org_id, start_date, end_date
    )

    try:
        # time_logs joined with shifts (for date filtering) and volunteers (for names)
        rows = (
            client.table("time_logs")
            .select(
                "hours, notes, "
                "volunteers(id, first_name, last_name), "
                "shifts(id, date)"
            )
            .eq("organization_id", org_id)
            .gte("shifts.date", start_date)
            .lte("shifts.date", end_date)
            .execute()
            .data
        )
    except Exception as exc:
        logger.error("Supabase ← hours report error: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to generate report") from exc

    # Filter rows where the shift date falls within the range
    # (PostgREST filter on nested tables is applied as an inner join — rows with
    # null shifts are excluded, but we double-check here for safety)
    valid_rows = [
        r for r in (rows or [])
        if r.get("shifts") and r.get("volunteers")
        and start_date <= r["shifts"]["date"] <= end_date
    ]

    # Aggregate per volunteer
    volunteer_map: dict[str, dict] = {}
    for row in valid_rows:
        vol = row["volunteers"]
        vid = vol["id"]
        if vid not in volunteer_map:
            volunteer_map[vid] = {
                "id": vid,
                "first_name": vol["first_name"],
                "last_name": vol["last_name"],
                "total_hours": 0.0,
                "shift_count": 0,
            }
        volunteer_map[vid]["total_hours"] += float(row["hours"])
        volunteer_map[vid]["shift_count"] += 1

    volunteers_sorted = sorted(
        volunteer_map.values(),
        key=lambda v: v["total_hours"],
        reverse=True,
    )

    total_hours = sum(v["total_hours"] for v in volunteers_sorted)
    volunteer_count = len(volunteers_sorted)
    avg_hours = round(total_hours / volunteer_count, 1) if volunteer_count else 0.0

    logger.info(
        "Supabase ← hours report OK (volunteers=%d total_hours=%s)",
        volunteer_count, total_hours,
    )

    return HoursReport(
        organization_name=org_name,
        start_date=start_date,
        end_date=end_date,
        total_hours=total_hours,
        volunteer_count=volunteer_count,
        avg_hours=avg_hours,
        volunteers=[VolunteerHoursSummary(**v) for v in volunteers_sorted],
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/hours", response_model=HoursReport, summary="Get hours report for the org")
async def get_hours_report(
    start_date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$", description="Start date YYYY-MM-DD"),
    end_date: str   = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$", description="End date YYYY-MM-DD"),
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    client: Client = Depends(get_supabase_admin),
):
    """
    Returns hours logged for all volunteers in the org within the given date range.
    Aggregated by volunteer: total hours + number of shifts.
    Sorted by total hours descending.
    """
    if start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date")

    org_id = current_user.organization_id

    # Fetch org name
    org_resp = (
        client.table("organizations")
        .select("name")
        .eq("id", org_id)
        .single()
        .execute()
    )
    org_name = org_resp.data.get("name", "Your Organization") if org_resp.data else "Your Organization"

    return _build_report(client, org_id, start_date, end_date, org_name)


@router.post("/share-link", response_model=ShareLinkResponse, summary="Create a shareable report link")
async def create_share_link(
    body: ShareLinkRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    client: Client = Depends(get_supabase_admin),
    settings: Settings = Depends(get_settings),
):
    """
    Generates a public, read-only share link for the hours report.
    The link expires in 30 days and requires no login to view.
    """
    if body.start_date > body.end_date:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date")

    org_id = current_user.organization_id

    logger.info("Supabase → create share link (org=%s)", org_id)
    try:
        result = (
            client.table("report_share_links")
            .insert({
                "organization_id": org_id,
                "report_type": "hours",
                "parameters": {
                    "start_date": body.start_date,
                    "end_date": body.end_date,
                },
            })
            .execute()
        )
    except Exception as exc:
        logger.error("Supabase ← create share link error: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to create share link") from exc

    row = result.data[0]
    token = row["token"]
    expires_at = row["expires_at"]
    share_url = f"{settings.app_base_url}/shared/reports/{token}"

    logger.info("Supabase ← share link created (token=%s...)", token[:8])
    return ShareLinkResponse(token=token, share_url=share_url, expires_at=expires_at)


@router.get(
    "/shared/{token}",
    response_model=HoursReport,
    summary="View a shared report (no login required)",
)
async def get_shared_report(
    token: str,
    client: Client = Depends(get_supabase_admin),
):
    """
    Public endpoint — no authentication required.
    Validates the share token (must exist and not be expired),
    then returns the report data for the stored date range.
    Returns 410 Gone if the link has expired, 404 if the token is invalid.
    """
    logger.info("Supabase → fetch share link (token=%s...)", token[:8])
    try:
        link_resp = (
            client.table("report_share_links")
            .select("organization_id, parameters, expires_at")
            .eq("token", token)
            .single()
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Report link not found")

    if not link_resp.data:
        raise HTTPException(status_code=404, detail="Report link not found")

    link = link_resp.data
    now = datetime.now(timezone.utc).isoformat()

    if link["expires_at"] < now:
        raise HTTPException(status_code=410, detail="This report link has expired")

    org_id    = link["organization_id"]
    params    = link["parameters"]
    start_date = params.get("start_date", "")
    end_date   = params.get("end_date", "")

    # Fetch org name
    org_resp = (
        client.table("organizations")
        .select("name")
        .eq("id", org_id)
        .single()
        .execute()
    )
    org_name = org_resp.data.get("name", "Organization") if org_resp.data else "Organization"

    logger.info("Supabase ← share link OK, building report (org=%s)", org_id)
    return _build_report(client, org_id, start_date, end_date, org_name)
