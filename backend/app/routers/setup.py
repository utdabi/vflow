# setup.py
# Feature 1.1: Organizations & Setup Links
#
# Two public (unauthenticated) endpoints for the coordinator setup flow:
#
#   GET  /api/setup/validate?token={uuid}
#        - Checks token exists, is unused, and not expired
#        - Returns organization name so the frontend can pre-fill it
#        - Returns 410 Gone if expired, 404 if not found, 409 if already used
#
#   POST /api/setup/complete
#        - Accepts token + coordinator credentials (email, password, full_name)
#        - Creates a Supabase Auth user via the Admin API
#        - Sets organization_id in app_metadata (not user-editable)
#        - Marks the token as used (idempotency guard)
#        - Returns the Supabase session (access_token + user) so the frontend
#          can store the JWT and redirect to the dashboard without a second login

import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status, Query, Depends
from pydantic import BaseModel, EmailStr
from supabase import create_client, Client

from app.config import get_settings, Settings

logger = logging.getLogger("volunteerflow.setup")

router = APIRouter(prefix="/api/setup", tags=["setup"])


# ---------------------------------------------------------------------------
# Dependency: Supabase client using service-role key (bypasses RLS)
# ---------------------------------------------------------------------------
def get_supabase_admin(settings: Settings = Depends(get_settings)) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fetch_org_by_token(client: Client, token: str) -> dict:
    """
    Fetch the organization row for the given setup token.
    Raises appropriate HTTP errors if token is invalid, expired, or already used.
    """
    logger.info("Supabase → querying setup_token (token prefix: %s...)", token[:8])
    try:
        response = (
            client.table("organizations")
            .select("id, name, token_used, token_expires_at")
            .eq("setup_token", token)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        logger.error("Supabase ← error querying setup_token: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to validate your link. Please try again or contact support.",
        ) from exc

    org = response.data
    if org is None:
        logger.warning("Supabase ← token not found (prefix: %s...)", token[:8])
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Setup link not found. Please request a new one from support.",
        )

    if org["token_used"]:
        logger.warning("Supabase ← token already used (org_id: %s)", org["id"])
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This setup link has already been used. Please contact support if you need access.",
        )

    expires_at = datetime.fromisoformat(org["token_expires_at"].replace("Z", "+00:00"))
    if expires_at < datetime.now(timezone.utc):
        logger.warning("Supabase ← token expired (org_id: %s, expired: %s)", org["id"], expires_at)
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This setup link has expired. Please contact support for a new one.",
        )

    logger.info("Supabase ← token valid for org '%s' (id: %s)", org["name"], org["id"])
    return org


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ValidateTokenResponse(BaseModel):
    organization_id: str
    organization_name: str
    valid: bool


class CompleteSetupRequest(BaseModel):
    token: str
    email: EmailStr
    password: str
    full_name: str


class CompleteSetupResponse(BaseModel):
    access_token: str
    token_type: str
    user_id: str
    email: str
    organization_id: str
    organization_name: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/validate",
    response_model=ValidateTokenResponse,
    summary="Validate a one-time setup token",
    description=(
        "Public endpoint. Checks that the token is valid, unused, and not expired. "
        "Returns the organization name so the frontend can display it before the user "
        "fills in their credentials."
    ),
)
async def validate_token(
    token: str = Query(..., description="UUID setup token from the invite link"),
    client: Client = Depends(get_supabase_admin),
):
    org = _fetch_org_by_token(client, token)
    return ValidateTokenResponse(
        organization_id=org["id"],
        organization_name=org["name"],
        valid=True,
    )


@router.post(
    "/complete",
    response_model=CompleteSetupResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Complete org setup: create coordinator account",
    description=(
        "Public endpoint. Creates the Supabase Auth user, stores organization_id "
        "in user_metadata (so RLS and JWT claims work), marks the setup token as used, "
        "and returns the session so the frontend can log in immediately."
    ),
)
async def complete_setup(
    body: CompleteSetupRequest,
    settings: Settings = Depends(get_settings),
    client: Client = Depends(get_supabase_admin),
):
    # 1. Validate token (raises 404 / 409 / 410 on failure)
    org = _fetch_org_by_token(client, body.token)
    org_id: str = org["id"]
    logger.info("setup/complete → creating user for org '%s' (email: %s)", org["name"], body.email)

    # 2. Create the Supabase Auth user with organization_id in app_metadata.
    #    We use the Admin API (service-role key) so no email confirmation is needed.
    try:
        create_response = client.auth.admin.create_user(
            {
                "email": body.email,
                "password": body.password,
                "email_confirm": True,  # skip confirmation email for invite flow
                "user_metadata": {
                    # stays — used by AppNav for display name
                    "full_name": body.full_name,
                },
                "app_metadata": {
                    # moved — not user-editable
                    "organization_id": org_id,
                },
            }
        )
    except Exception as exc:
        # Supabase throws if the email is already registered
        error_msg = str(exc).lower()
        if "already registered" in error_msg or "already exists" in error_msg:
            logger.warning("Supabase ← auth.admin.create_user: email already exists (%s)", body.email)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists.",
            ) from exc
        logger.error("Supabase ← auth.admin.create_user failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create account. Please try again or contact support.",
        ) from exc

    user = create_response.user
    if user is None:
        logger.error("Supabase ← auth.admin.create_user returned no user object")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Account creation returned no user. Please contact support.",
        )

    logger.info("Supabase ← user created (user_id: %s)", user.id)

    # 3. Mark the setup token as used so it cannot be replayed
    logger.info("Supabase → marking token used for org_id: %s", org_id)
    client.table("organizations").update({"token_used": True}).eq("id", org_id).execute()
    logger.info("Supabase ← token marked used")

    # 4. Sign in as the newly created user to obtain a session/JWT.
    #    The frontend will store this token to authenticate subsequent requests.
    logger.info("Supabase → signing in new user (%s)", body.email)
    try:
        sign_in_response = client.auth.sign_in_with_password(
            {"email": body.email, "password": body.password}
        )
    except Exception as exc:
        logger.error("Supabase ← sign_in_with_password failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Account created but sign-in failed. Please visit the login page.",
        ) from exc

    session = sign_in_response.session
    if session is None:
        logger.error("Supabase ← sign_in_with_password returned no session")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Account created but session is missing. Please log in manually.",
        )

    logger.info("setup/complete ✓ org '%s' user %s ready", org["name"], user.id)
    return CompleteSetupResponse(
        access_token=session.access_token,
        token_type="bearer",
        user_id=str(user.id),
        email=body.email,
        organization_id=org_id,
        organization_name=org["name"],
    )
