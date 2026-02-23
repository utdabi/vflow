# volunteers.py
# Feature 1.2: Volunteer Management
#
# Endpoints for managing volunteers within an organization.
# All endpoints require authentication (current user's org_id used automatically).
#
# Volunteer fields: first_name, last_name, gender (opt), date_of_birth (opt),
#                   email (opt), mobile (E.164 required), skills, notes
#
# Route order matters: /import and /import/confirm MUST come before /{id}
# so FastAPI does not interpret "import" as a UUID path parameter.
#
#   GET    /api/volunteers                 — list all (active only by default)
#   POST   /api/volunteers                 — create one manually
#   POST   /api/volunteers/import          — parse CSV, return preview (no save)
#   POST   /api/volunteers/import/confirm  — bulk save from preview
#   GET    /api/volunteers/sample.csv      — download sample CSV template
#   GET    /api/volunteers/{id}            — get one volunteer
#   PATCH  /api/volunteers/{id}            — update fields
#   DELETE /api/volunteers/{id}            — soft-delete (active=false)

import logging
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, computed_field, field_validator
from supabase import create_client, Client

from app.auth import CurrentUser, get_current_user
from app.config import get_settings, Settings
from app.repositories.volunteer_repository import VolunteerRepository, MOBILE_RE

logger = logging.getLogger("volunteerflow.volunteers")

router = APIRouter(prefix="/api/volunteers", tags=["volunteers"])


# ---------------------------------------------------------------------------
# Supabase dependency
# ---------------------------------------------------------------------------
def get_supabase_admin(settings: Settings = Depends(get_settings)) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


def get_repo(client: Client = Depends(get_supabase_admin)) -> VolunteerRepository:
    return VolunteerRepository(client)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class VolunteerOut(BaseModel):
    id: str
    organization_id: str
    first_name: str
    last_name: str
    gender: str | None
    date_of_birth: str | None
    email: str | None
    mobile: str
    skills: list[str]
    notes: str | None
    active: bool
    total_hours: float
    last_worked_date: str | None
    times_cancelled: int
    preferred_days: list[int] = []  # 0=Sun … 6=Sat; used by backup-finder
    created_at: str
    updated_at: str

    @computed_field  # type: ignore[misc]
    @property
    def age(self) -> int | None:
        """Current age in years, derived from date_of_birth. None if DOB not set."""
        if not self.date_of_birth:
            return None
        try:
            dob = date.fromisoformat(self.date_of_birth)
            today = date.today()
            return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        except ValueError:
            return None


class CreateVolunteerRequest(BaseModel):
    first_name: str
    last_name: str
    gender: str | None = None
    date_of_birth: str | None = None  # ISO 8601 YYYY-MM-DD
    email: EmailStr | None = None
    mobile: str
    skills: list[str] = []
    notes: str | None = None
    preferred_days: list[int] = []    # 0=Sun … 6=Sat

    @field_validator("mobile")
    @classmethod
    def mobile_must_be_e164(cls, v: str) -> str:
        if not MOBILE_RE.match(v):
            raise ValueError(
                "Mobile must be in E.164 format (e.g. +12125551234 or +447911123456). "
                "Start with + followed by the country code and number, no spaces or dashes."
            )
        return v


class UpdateVolunteerRequest(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    gender: str | None = None
    date_of_birth: str | None = None
    email: EmailStr | None = None
    mobile: str | None = None
    skills: list[str] | None = None
    notes: str | None = None
    active: bool | None = None
    preferred_days: list[int] | None = None  # 0=Sun … 6=Sat

    @field_validator("mobile")
    @classmethod
    def mobile_must_be_e164(cls, v: str | None) -> str | None:
        if v is not None and not MOBILE_RE.match(v):
            raise ValueError("Mobile must be in E.164 format (e.g. +12125551234).")
        return v


class InvalidRow(BaseModel):
    row_number: int
    error_message: str
    raw: dict[str, Any]


class ImportPreviewResponse(BaseModel):
    valid_rows: list[dict[str, Any]]
    invalid_rows: list[InvalidRow]
    valid_count: int
    invalid_count: int
    create_count: int  # rows with action="create" (new volunteers)
    update_count: int  # rows with action="update" (existing volunteers being edited)


class ImportConfirmRequest(BaseModel):
    valid_rows: list[dict[str, Any]]


class ImportConfirmResponse(BaseModel):
    created_count: int
    updated_count: int
    errors: list[str]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=list[VolunteerOut],
    summary="List volunteers",
)
async def list_volunteers(
    active: bool = Query(default=True, description="Filter by active status"),
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: VolunteerRepository = Depends(get_repo),
):
    """Return all volunteers for the authenticated coordinator's organization."""
    try:
        return repo.get_volunteers(current_user.organization_id, active_only=active)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch volunteers. Please try again.",
        ) from exc


@router.post(
    "",
    response_model=VolunteerOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a volunteer",
)
async def create_volunteer(
    body: CreateVolunteerRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: VolunteerRepository = Depends(get_repo),
):
    """Manually add a single volunteer to the organization."""
    logger.info(
        "volunteers/create → %s %s (org: %s)",
        body.first_name,
        body.last_name,
        current_user.organization_id,
    )
    try:
        volunteer = repo.create_volunteer(
            current_user.organization_id,
            body.model_dump(exclude_none=False),
        )
    except Exception as exc:
        error_msg = str(exc).lower()
        if "check" in error_msg and "mobile" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Mobile number failed database validation. Use E.164 format.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create volunteer. Please try again.",
        ) from exc
    logger.info("volunteers/create ✓ id: %s", volunteer.get("id"))
    return volunteer


@router.post(
    "/import",
    response_model=ImportPreviewResponse,
    summary="Preview CSV import (no save)",
)
async def import_preview(
    file: UploadFile = File(
        ...,
        description="CSV file with columns: id (optional), first_name, last_name, mobile, gender, date_of_birth, email, skills, notes, preferred_days",
    ),
    date_format: str = Query("INTL", description="Organisation date format: INTL (DD/MM/YYYY) or US (MM/DD/YYYY)"),
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: VolunteerRepository = Depends(get_repo),
):
    """
    Parse a CSV file and return a preview split into valid and invalid rows.
    Does NOT save anything — call /import/confirm to commit.

    If the CSV has an 'id' column (i.e. was produced by the Export list button),
    existing UUIDs are classified as updates; blank IDs are classified as creates.
    """
    logger.info(
        "volunteers/import preview → file: %s (org: %s, date_format: %s)",
        file.filename,
        current_user.organization_id,
        date_format,
    )
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Please upload a .csv file.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file is empty.",
        )

    # Fetch existing volunteer IDs so the parser can classify rows as create vs update
    try:
        existing_ids = set(repo.get_all_ids(current_user.organization_id))
    except Exception as exc:
        logger.error("volunteers/import preview: failed to fetch existing IDs: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to prepare import. Please try again.",
        ) from exc

    try:
        valid_rows, invalid_rows = VolunteerRepository.parse_csv(
            file_bytes,
            date_format=date_format,
            existing_ids=existing_ids,
        )
    except Exception as exc:
        logger.error("volunteers/import parse error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"CSV parsing failed: {exc}",
        ) from exc

    create_count = sum(1 for r in valid_rows if r.get("action") == "create")
    update_count = sum(1 for r in valid_rows if r.get("action") == "update")
    logger.info(
        "volunteers/import preview ✓ valid: %d (create: %d, update: %d), invalid: %d",
        len(valid_rows),
        create_count,
        update_count,
        len(invalid_rows),
    )
    return ImportPreviewResponse(
        valid_rows=valid_rows,
        invalid_rows=invalid_rows,
        valid_count=len(valid_rows),
        invalid_count=len(invalid_rows),
        create_count=create_count,
        update_count=update_count,
    )


@router.post(
    "/import/confirm",
    response_model=ImportConfirmResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Confirm and save CSV import",
)
async def import_confirm(
    body: ImportConfirmRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: VolunteerRepository = Depends(get_repo),
):
    """
    Bulk-save validated rows from the /import preview endpoint.
    Rows with action="create" are inserted; rows with action="update" update existing records.
    """
    logger.info(
        "volunteers/import confirm → %d rows (org: %s)",
        len(body.valid_rows),
        current_user.organization_id,
    )
    if not body.valid_rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No valid rows to import.",
        )

    # Internal parser keys — must not reach the DB
    INTERNAL_KEYS = {"action", "_row_num", "_raw"}

    creates = [
        {k: v for k, v in r.items() if k not in INTERNAL_KEYS}
        for r in body.valid_rows
        if r.get("action", "create") == "create"
    ]
    updates = [r for r in body.valid_rows if r.get("action") == "update"]

    errors: list[str] = []
    created_count = 0
    updated_count = 0

    try:
        if creates:
            result = repo.bulk_create(current_user.organization_id, creates)
            created_count = len(result)
        if updates:
            updated_count = repo.bulk_update(current_user.organization_id, updates)
    except Exception as exc:
        logger.error("volunteers/import confirm error: %s", exc)
        errors.append(str(exc))

    logger.info(
        "volunteers/import confirm ✓ created: %d, updated: %d",
        created_count,
        updated_count,
    )
    return ImportConfirmResponse(
        created_count=created_count,
        updated_count=updated_count,
        errors=errors,
    )


@router.get(
    "/sample.csv",
    summary="Download sample CSV template",
    response_class=Response,
)
async def download_sample_csv(
    date_format: str = Query("INTL", description="Organisation date format: INTL (DD/MM/YYYY) or US (MM/DD/YYYY)"),
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
):
    """Return the official blank CSV template with all required columns and example rows."""
    if date_format == "US":
        date_hint = "MM/DD/YYYY"
        dob1 = "06/15/1985"
        dob2 = "11/30/1990"
    else:
        date_hint = "DD/MM/YYYY"
        dob1 = "15/06/1985"
        dob2 = "30/11/1990"
    sample = (
        "first_name,last_name,gender,date_of_birth,email,mobile,skills,notes,preferred_days\n"
        f'Jane,Smith,Female,{dob1},jane.smith@example.com,+12125550101,"first aid,driving",Very reliable,"Mon,Wed,Fri"\n'
        f'Bob,Jones,Male,{dob2},bob.jones@example.com,+12125550102,,,\n'
        f'Alex,Taylor,Non-binary,,alex@example.com,+447911123456,cooking,,Sat\n'
    )
    return Response(
        content=sample,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="volunteer_template.csv"'},
    )


@router.get(
    "/{volunteer_id}",
    response_model=VolunteerOut,
    summary="Get a volunteer by ID",
)
async def get_volunteer(
    volunteer_id: str,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: VolunteerRepository = Depends(get_repo),
):
    """Return a single volunteer. Returns 404 if not in current org."""
    try:
        volunteer = repo.get_volunteer(volunteer_id)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch volunteer. Please try again.",
        ) from exc

    if volunteer is None or volunteer.get("organization_id") != current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Volunteer not found.",
        )
    return volunteer


@router.patch(
    "/{volunteer_id}",
    response_model=VolunteerOut,
    summary="Update a volunteer",
)
async def update_volunteer(
    volunteer_id: str,
    body: UpdateVolunteerRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: VolunteerRepository = Depends(get_repo),
):
    """Update one or more fields of a volunteer. Returns 404 if not in current org."""
    existing = repo.get_volunteer(volunteer_id)
    if existing is None or existing.get("organization_id") != current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Volunteer not found.",
        )

    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        return existing

    try:
        return repo.update_volunteer(volunteer_id, update_data)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update volunteer. Please try again.",
        ) from exc


@router.delete(
    "/{volunteer_id}",
    response_model=VolunteerOut,
    summary="Soft-delete a volunteer",
)
async def delete_volunteer(
    volunteer_id: str,
    current_user: Annotated[CurrentUser, Depends(get_current_user)] = None,
    repo: VolunteerRepository = Depends(get_repo),
):
    """
    Soft-delete: sets active=False.
    The record is retained for reporting and shift history.
    """
    existing = repo.get_volunteer(volunteer_id)
    if existing is None or existing.get("organization_id") != current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Volunteer not found.",
        )
    if not existing.get("active"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Volunteer is already inactive.",
        )

    try:
        return repo.deactivate_volunteer(volunteer_id)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to deactivate volunteer. Please try again.",
        ) from exc
