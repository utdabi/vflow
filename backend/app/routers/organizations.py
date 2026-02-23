# organizations.py
# Feature 1.1: Organizations & Setup Links
#
# Authenticated endpoints for the coordinator to read and update their organization.
#
#   GET   /api/organizations/me        — return current org details (incl. logo_url)
#   PATCH /api/organizations/me        — update org name
#   POST  /api/organizations/logo      — upload a real image file (JPG/PNG/GIF/WebP/SVG)
#                                        → stored as a base64 data URL in logo_url column
#
# Logo storage strategy:
#   The uploaded image file is read into memory, base64-encoded, and stored as a
#   "data:image/<mime>;base64,<data>" string in the organizations.logo_url TEXT column.
#   This means:
#     - No external storage bucket needed (no Supabase Storage, no S3)
#     - The data URL works directly as <img src="..."> in the browser
#     - The column stays a plain TEXT column — portable, no special DB type
#   Trade-off: large images inflate the DB row size.  We enforce a 2 MB cap.

import base64
import logging
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, model_validator
from supabase import create_client, Client

from app.auth import CurrentUser, get_current_user
from app.config import get_settings, Settings

logger = logging.getLogger("volunteerflow.organizations")

router = APIRouter(prefix="/api/organizations", tags=["organizations"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_LOGO_BYTES = 2 * 1024 * 1024  # 2 MB

ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
}


# ---------------------------------------------------------------------------
# Dependency: Supabase admin client
# ---------------------------------------------------------------------------

def get_supabase_admin(settings: Settings = Depends(get_settings)) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class OrganizationResponse(BaseModel):
    id: str
    name: str
    created_at: str
    logo_url: str | None = None
    date_format: Literal['US', 'INTL'] = 'INTL'


class UpdateOrganizationRequest(BaseModel):
    """At least one of name or date_format must be provided."""
    name: str | None = None
    date_format: Literal['US', 'INTL'] | None = None

    @model_validator(mode='after')
    def at_least_one_field(self) -> 'UpdateOrganizationRequest':
        if self.name is None and self.date_format is None:
            raise ValueError("Provide at least one of: name, date_format")
        return self


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/me",
    response_model=OrganizationResponse,
    summary="Get current user's organization",
)
async def get_my_organization(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Client = Depends(get_supabase_admin),
):
    """
    Returns the organization that belongs to the authenticated coordinator,
    including logo_url (base64 data URL) if a logo has been uploaded.
    """
    logger.info("Supabase → GET org (user: %s, org_id: %s)", current_user.id, current_user.organization_id)
    try:
        response = (
            client.table("organizations")
            .select("id, name, created_at, logo_url, date_format")
            .eq("id", current_user.organization_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        logger.error("Supabase ← GET org error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to fetch organization. Please try again.",
        ) from exc

    org = response.data
    if org is None:
        logger.warning("Supabase ← org not found (org_id: %s)", current_user.organization_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found.",
        )
    logger.info("Supabase ← GET org OK (name: '%s', has_logo: %s)", org["name"], bool(org.get("logo_url")))
    return org


@router.patch(
    "/me",
    response_model=OrganizationResponse,
    summary="Update current user's organization name",
)
async def update_my_organization(
    body: UpdateOrganizationRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Client = Depends(get_supabase_admin),
):
    """Allows the coordinator to update org name and/or date format preference."""
    # Build update dict from only the fields that were provided
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.date_format is not None:
        updates["date_format"] = body.date_format

    logger.info(
        "Supabase → PATCH org (user: %s, org_id: %s, updates: %s)",
        current_user.id, current_user.organization_id, list(updates.keys())
    )
    try:
        response = (
            client.table("organizations")
            .update(updates)
            .eq("id", current_user.organization_id)
            .execute()
        )
    except Exception as exc:
        logger.error("Supabase ← PATCH org error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to update organization. Please try again.",
        ) from exc

    if not response.data:
        logger.warning("Supabase ← PATCH org: no rows updated (org_id: %s)", current_user.organization_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found or no changes made.",
        )
    logger.info("Supabase ← PATCH org OK")
    return response.data[0]


@router.post(
    "/logo",
    response_model=OrganizationResponse,
    summary="Upload or replace the organisation logo",
)
async def upload_org_logo(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Client = Depends(get_supabase_admin),
    file: UploadFile = File(..., description="Image file — JPG, PNG, GIF, WebP, or SVG (max 2 MB)"),
):
    """
    Accepts a real image file (multipart/form-data), base64-encodes it, and
    stores the resulting data URL in the organizations.logo_url column.

    The data URL (data:image/<mime>;base64,...) can be used directly as an
    <img src="..."> value in the browser — no separate serving endpoint needed.
    """
    # --- MIME type check ---
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unsupported file type: {content_type!r}. "
                "Please upload a JPG, PNG, GIF, WebP, or SVG image."
            ),
        )

    # --- Read file into memory ---
    raw_bytes = await file.read()

    # --- Size check ---
    if len(raw_bytes) > MAX_LOGO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Logo must be under 2 MB. Received {len(raw_bytes) // 1024} KB.",
        )

    # --- Encode to base64 data URL ---
    b64 = base64.b64encode(raw_bytes).decode("ascii")
    data_url = f"data:{content_type};base64,{b64}"

    logger.info(
        "Supabase → POST org logo (user: %s, org_id: %s, mime: %s, raw_bytes: %d)",
        current_user.id, current_user.organization_id, content_type, len(raw_bytes),
    )

    # --- Persist to DB ---
    try:
        response = (
            client.table("organizations")
            .update({"logo_url": data_url})
            .eq("id", current_user.organization_id)
            .execute()
        )
    except Exception as exc:
        logger.error("Supabase ← POST org logo error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save logo. Please try again.",
        ) from exc

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found.",
        )

    logger.info("Supabase ← POST org logo OK (stored %d chars)", len(data_url))
    return response.data[0]
