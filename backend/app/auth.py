# auth.py
# Feature 1.1: Organizations & Setup Links
# FastAPI dependency that validates the Supabase JWT from the Authorization header.
#
# NOTE: Supabase has migrated from legacy HS256 JWT secrets to asymmetric RS256
# signing keys. Rather than decoding the JWT locally (which would require the
# private key), we validate by calling supabase.auth.get_user(token) — Supabase
# verifies the token server-side and returns the user object if it's valid.
# This is the recommended approach for server-side validation with the new key system.
#
# Extracts user id, email, and organization_id (stored in app_metadata).
# Raises HTTP 401 if the token is missing, expired, or invalid.

from typing import Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from supabase import create_client, Client

from app.config import get_settings, Settings

bearer_scheme = HTTPBearer(auto_error=False)


class CurrentUser(BaseModel):
    id: str
    email: str
    organization_id: str


def get_supabase_admin(settings: Settings = Depends(get_settings)) -> Client:
    """Supabase admin client (service-role key) used for token validation."""
    return create_client(settings.supabase_url, settings.supabase_service_key)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ] = None,
    client: Client = Depends(get_supabase_admin),
) -> CurrentUser:
    """
    Validate the Supabase JWT by calling supabase.auth.get_user(token).
    Supabase performs all cryptographic verification on its end — we just
    check that the returned user has the expected organization_id claim.

    The token is expected in the Authorization: Bearer <token> header.
    organization_id is stored in app_metadata by the setup flow.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    try:
        response = client.auth.get_user(token)
        user = response.user
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = str(user.id)
    email = user.email or ""
    app_metadata: dict = user.app_metadata or {}
    organization_id: str | None = app_metadata.get("organization_id")

    if not organization_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account not linked to an organization. Please complete setup.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return CurrentUser(id=user_id, email=email, organization_id=organization_id)
