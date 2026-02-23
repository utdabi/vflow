# shifts.py
# Feature 4.3: Shift Scheduling & Assignment
#
# REST endpoints for shifts and volunteer assignments.
# Follows the same auth pattern as volunteers.py:
#   - get_supabase_admin  → service-role Supabase client (bypasses RLS for reads)
#   - get_shift_repo      → FastAPI Depends factory
#   - current_user        → Depends(get_current_user) → CurrentUser (id, email, organization_id)
#
# Endpoints:
#   GET    /api/shifts                          — list shifts for a month (year+month query params)
#   POST   /api/shifts                          — create a new shift
#   GET    /api/shifts/{shift_id}               — get shift detail with assignments
#   PATCH  /api/shifts/{shift_id}               — update shift fields
#   DELETE /api/shifts/{shift_id}               — delete shift (and cascade assignments)
#   POST   /api/shifts/{shift_id}/assign        — assign a volunteer to a shift
#   DELETE /api/shifts/{shift_id}/assignments/{volunteer_id} — cancel a volunteer's assignment

import logging
from datetime import date as date_type
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from supabase import Client, create_client

from app.auth import CurrentUser, get_current_user
from app.config import get_settings, Settings
from app.repositories.shift_repository import ShiftRepository
from app.ld import get_flag
from app.services.backup_service import BackupService
from app.services.sms_service import SMSService

logger = logging.getLogger("volunteerflow.shifts")
router = APIRouter(prefix="/api/shifts", tags=["shifts"])

# ---------------------------------------------------------------------------
# Supabase client dependency (service-role, same pattern as volunteers router)
# ---------------------------------------------------------------------------

def get_supabase_admin(settings: Settings = Depends(get_settings)) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


def get_shift_repo(client: Client = Depends(get_supabase_admin)) -> ShiftRepository:
    return ShiftRepository(client)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

ShiftStatus = Literal["draft", "published", "cancelled"]


class ShiftCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    date: date_type
    start_time: str = Field(..., pattern=r"^\d{2}:\d{2}(:\d{2})?$")
    end_time: str = Field(..., pattern=r"^\d{2}:\d{2}(:\d{2})?$")
    location: Optional[str] = None
    min_volunteers: int = Field(1, ge=1)
    max_volunteers: int = Field(1, ge=1)
    status: ShiftStatus = "draft"
    event_lead_first_name: str = Field(..., min_length=1, max_length=100)
    event_lead_last_name: str = Field(..., min_length=1, max_length=100)
    event_lead_mobile: Optional[str] = None

    @model_validator(mode="after")
    def max_gte_min(self) -> "ShiftCreate":
        if self.max_volunteers < self.min_volunteers:
            raise ValueError("max_volunteers must be >= min_volunteers")
        return self


class ShiftUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    date: Optional[date_type] = None
    start_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}(:\d{2})?$")
    end_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}(:\d{2})?$")
    location: Optional[str] = None
    min_volunteers: Optional[int] = Field(None, ge=1)
    max_volunteers: Optional[int] = Field(None, ge=1)
    status: Optional[ShiftStatus] = None
    event_lead_first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    event_lead_last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    event_lead_mobile: Optional[str] = None


class AssignVolunteerRequest(BaseModel):
    volunteer_id: str


class CancelAssignmentRequest(BaseModel):
    reason: Optional[str] = None


class RequestBackupsRequest(BaseModel):
    volunteer_ids: list[str] = Field(..., min_length=1)


class LogHoursRequest(BaseModel):
    volunteer_id: str
    hours: float = Field(..., gt=0, le=24, description="Hours worked (0–24, up to 2 decimal places)")
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _assert_shift_belongs_to_org(shift: dict | None, org_id: str, shift_id: str) -> dict:
    """Raise 404 if shift not found or belongs to a different org."""
    if shift is None or shift.get("organization_id") != org_id:
        raise HTTPException(status_code=404, detail="Shift not found")
    return shift


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("", summary="List shifts for a month")
async def list_shifts(
    year: int = Query(..., ge=2020, le=2100, description="4-digit year"),
    month: int = Query(..., ge=1, le=12, description="Month number (1-12)"),
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: ShiftRepository = Depends(get_shift_repo),
):
    """
    Returns all shifts for the authenticated org in the given month.
    Each shift includes `assigned_count` (active assignments only).
    """
    shifts = repo.list_by_month(current_user.organization_id, year, month)
    return {"shifts": shifts, "count": len(shifts)}


@router.post("", status_code=201, summary="Create a shift")
async def create_shift(
    body: ShiftCreate,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: ShiftRepository = Depends(get_shift_repo),
):
    """Create a new shift for the authenticated org. Status defaults to 'draft'."""
    data = body.model_dump()
    data["date"] = data["date"].isoformat()
    shift = repo.create_shift(current_user.organization_id, data)
    return shift


@router.get("/{shift_id}", summary="Get shift detail")
async def get_shift(
    shift_id: str,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: ShiftRepository = Depends(get_shift_repo),
):
    """
    Returns a single shift with its full assignment list including volunteer details.
    """
    shift = repo.get_shift_with_assignments(shift_id)
    _assert_shift_belongs_to_org(shift, current_user.organization_id, shift_id)
    return shift


@router.patch("/{shift_id}", summary="Update a shift")
async def update_shift(
    shift_id: str,
    body: ShiftUpdate,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: ShiftRepository = Depends(get_shift_repo),
):
    """Update one or more fields of a shift."""
    existing = repo.get_shift_with_assignments(shift_id)
    _assert_shift_belongs_to_org(existing, current_user.organization_id, shift_id)

    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "date" in data:
        data["date"] = data["date"].isoformat()
    if "min_volunteers" in data and "max_volunteers" in data:
        if data["max_volunteers"] < data["min_volunteers"]:
            raise HTTPException(
                status_code=422,
                detail="max_volunteers must be >= min_volunteers",
            )

    updated = repo.update_shift(shift_id, data)
    return updated


@router.delete("/{shift_id}", status_code=204, summary="Delete a shift")
async def delete_shift(
    shift_id: str,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: ShiftRepository = Depends(get_shift_repo),
):
    """Delete a shift and all its assignments (cascade)."""
    existing = repo.get_shift_with_assignments(shift_id)
    _assert_shift_belongs_to_org(existing, current_user.organization_id, shift_id)
    repo.delete_shift(shift_id)


@router.post("/{shift_id}/assign", status_code=201, summary="Assign a volunteer to a shift")
async def assign_volunteer(
    shift_id: str,
    body: AssignVolunteerRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: ShiftRepository = Depends(get_shift_repo),
):
    """
    Assign a volunteer to a shift.
    If the volunteer was previously cancelled on this shift, re-activates them.
    Returns 400 if the shift is full (assigned_count >= max_volunteers).
    """
    shift = repo.get_shift_with_assignments(shift_id)
    _assert_shift_belongs_to_org(shift, current_user.organization_id, shift_id)

    if shift.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot assign volunteers to a cancelled shift")

    if shift["assigned_count"] >= shift["max_volunteers"]:
        raise HTTPException(
            status_code=400,
            detail=f"Shift is full ({shift['max_volunteers']} volunteers already assigned)",
        )

    assignment = repo.assign_volunteer(shift_id, body.volunteer_id)
    return assignment


@router.delete(
    "/{shift_id}/assignments/{volunteer_id}",
    summary="Cancel a volunteer's assignment",
)
async def cancel_assignment(
    shift_id: str,
    volunteer_id: str,
    body: CancelAssignmentRequest = CancelAssignmentRequest(),
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: ShiftRepository = Depends(get_shift_repo),
):
    """
    Cancel a volunteer's assignment (soft-delete — sets cancelled_at timestamp).
    Returns 404 if the volunteer isn't actively assigned to this shift.
    """
    shift = repo.get_shift_with_assignments(shift_id)
    _assert_shift_belongs_to_org(shift, current_user.organization_id, shift_id)

    existing = repo.get_assignment(shift_id, volunteer_id)
    if not existing:
        raise HTTPException(
            status_code=404,
            detail="No active assignment found for this volunteer on this shift",
        )

    cancelled = repo.cancel_assignment(shift_id, volunteer_id, body.reason)
    return {
        "cancelled": True,
        "assignment": cancelled,
        "shift_id": shift_id,
        "volunteer_id": volunteer_id,
    }


# ---------------------------------------------------------------------------
# Backup Finder endpoints (prd.md §4.4)
# ---------------------------------------------------------------------------

@router.get(
    "/{shift_id}/backup-suggestions",
    summary="Get backup volunteer suggestions",
)
async def get_backup_suggestions(
    shift_id: str,
    cancelled_volunteer_id: str = Query(..., description="Volunteer who just cancelled"),
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: ShiftRepository = Depends(get_shift_repo),
    client: Client = Depends(get_supabase_admin),
):
    """
    Returns up to 3 ranked backup volunteer suggestions for a shift.
    Gated by LaunchDarkly flag `enable-backup-finder`.
    Falls back to enabled when flag is not configured (e.g. local dev without LD key).
    """
    org_id = current_user.organization_id
    enabled = get_flag("enable-backup-finder", org_id, default=True)
    if not enabled:
        raise HTTPException(
            status_code=403,
            detail="Backup finder is not enabled for your plan. Contact support to upgrade.",
        )

    shift = repo.get_shift_with_assignments(shift_id)
    _assert_shift_belongs_to_org(shift, org_id, shift_id)

    svc = BackupService(client)
    suggestions = svc.suggest_backups(shift_id, org_id, cancelled_volunteer_id)
    return {"suggestions": suggestions, "count": len(suggestions)}


@router.post(
    "/{shift_id}/request-backups",
    summary="Send backup-request SMS to selected volunteers",
)
async def request_backups(
    shift_id: str,
    body: RequestBackupsRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: ShiftRepository = Depends(get_shift_repo),
    client: Client = Depends(get_supabase_admin),
    settings: Settings = Depends(get_settings),
):
    """
    Sends backup-request SMS to the specified volunteers.
    Gated by LaunchDarkly flags `enable-sms-notifications` and `max-sms-per-month`.
    In development (or when Twilio credentials are absent) messages are logged
    to console instead of sent — no Twilio charges incurred.
    """
    org_id = current_user.organization_id

    sms_enabled = get_flag("enable-sms-notifications", org_id, default=True)
    if not sms_enabled:
        raise HTTPException(
            status_code=403,
            detail="SMS notifications are not enabled for your plan.",
        )

    max_sms: int = get_flag("max-sms-per-month", org_id, default=100)
    if len(body.volunteer_ids) > max_sms:
        raise HTTPException(
            status_code=429,
            detail=f"SMS quota exceeded. Your plan allows {max_sms} messages per month.",
        )

    # Load shift details (for the SMS message body)
    shift = repo.get_shift_with_assignments(shift_id)
    _assert_shift_belongs_to_org(shift, org_id, shift_id)

    # Load the organization name (shown at end of SMS)
    org_resp = client.table("organizations").select("name").eq("id", org_id).single().execute()
    org_name = org_resp.data.get("name", "VolunteerFlow") if org_resp.data else "VolunteerFlow"

    # Load the selected volunteers
    vols_resp = (
        client.table("volunteers")
        .select("id, first_name, last_name, mobile")
        .in_("id", body.volunteer_ids)
        .eq("organization_id", org_id)
        .execute()
    )
    volunteers_to_text = vols_resp.data or []

    sms_svc = SMSService(settings)
    results = []
    sent_count = 0
    for vol in volunteers_to_text:
        result = sms_svc.send_backup_request(vol, shift, org_name)
        results.append(result)
        if result.get("sent"):
            sent_count += 1

    logger.info(
        "request-backups: sent=%d/%d (shift=%s org=%s stub=%s)",
        sent_count,
        len(volunteers_to_text),
        shift_id,
        org_id,
        results[0].get("stub") if results else None,
    )
    return {
        "sent_count": sent_count,
        "total": len(volunteers_to_text),
        "results": results,
    }


# ---------------------------------------------------------------------------
# Hours Logging (prd.md §4.5)
# ---------------------------------------------------------------------------

@router.post(
    "/{shift_id}/log-hours",
    summary="Log hours for a volunteer on a shift",
)
async def log_hours(
    shift_id: str,
    body: LogHoursRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: ShiftRepository = Depends(get_shift_repo),
    client: Client = Depends(get_supabase_admin),
):
    """
    Record how many hours a volunteer worked on a shift.
    Upserts one row per (shift_id, volunteer_id) — re-logging replaces the previous value.
    The database trigger `trig_update_volunteer_hours` automatically updates volunteers.total_hours.
    Returns 400 if the volunteer was never assigned to this shift.
    """
    org_id = current_user.organization_id

    # Verify shift belongs to this org
    shift = repo.get_shift_with_assignments(shift_id)
    _assert_shift_belongs_to_org(shift, org_id, shift_id)

    # Verify the volunteer appears in the assignment history (active or cancelled)
    all_vol_ids = [a["volunteer_id"] for a in (shift.get("shift_assignments") or [])]
    if body.volunteer_id not in all_vol_ids:
        raise HTTPException(
            status_code=400,
            detail="This volunteer was not assigned to the shift",
        )

    logger.info(
        "Supabase → upsert time_log (shift=%s volunteer=%s hours=%s)",
        shift_id, body.volunteer_id, body.hours,
    )
    try:
        result = (
            client.table("time_logs")
            .upsert(
                {
                    "organization_id": org_id,
                    "shift_id": shift_id,
                    "volunteer_id": body.volunteer_id,
                    "hours": body.hours,
                    "notes": body.notes,
                    "logged_by": current_user.id,
                },
                on_conflict="shift_id,volunteer_id",
            )
            .execute()
        )
    except Exception as exc:
        logger.error("Supabase ← upsert time_log error: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to log hours") from exc

    logger.info("Supabase ← upsert time_log OK (shift=%s volunteer=%s)", shift_id, body.volunteer_id)
    row = result.data[0] if result.data else {}
    return {"logged": True, "hours": body.hours, "time_log_id": row.get("id")}
