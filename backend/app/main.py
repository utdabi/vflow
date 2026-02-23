# main.py
# Feature 1.1: Organizations & Setup Links
#
# FastAPI application entry point.
# Responsibilities:
#   - Configure CORS (restrict to frontend origin)
#   - Initialize Sentry error tracking (if DSN is set)
#   - Register all routers (setup, organizations; more added in later features)
#   - Expose GET /health for uptime monitoring (Cloudflare / Better Stack)
#
# Run locally:
#   cd backend
#   uv run uvicorn app.main:app --reload --port 8000

import logging
import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import setup, organizations, volunteers, shifts, reports
from app.ld import init_ld

# ---------------------------------------------------------------------------
# Logging — structured output so local dev and cloud logs are easy to read
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("volunteerflow")

settings = get_settings()

# ---------------------------------------------------------------------------
# LaunchDarkly — initialize before any route so flags are ready on first request
# ---------------------------------------------------------------------------
init_ld(settings.launchdarkly_sdk_key)

# ---------------------------------------------------------------------------
# Sentry — initialize before any route is registered so all errors are caught
# Only initializes when SENTRY_DSN is set to a valid DSN (starts with https://)
# ---------------------------------------------------------------------------
if settings.sentry_dsn and settings.sentry_dsn.startswith("https://"):
    try:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.environment,
            traces_sample_rate=0.2,  # 20% of requests traced (adjust in prod)
        )
    except Exception as e:
        print(f"[WARNING] Sentry init failed (check SENTRY_DSN): {e}")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="VolunteerFlow API",
    description="Backend for the VolunteerFlow Backup Finder MVP.",
    version="0.1.0",
    # Hide docs in production to reduce attack surface
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
)

# ---------------------------------------------------------------------------
# CORS — only allow the configured frontend origin(s)
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(setup.router)
app.include_router(organizations.router)
app.include_router(volunteers.router)
app.include_router(shifts.router)
app.include_router(reports.router)


# ---------------------------------------------------------------------------
# Health endpoint — used by uptime monitors (Better Stack, Cloudflare)
# ---------------------------------------------------------------------------
@app.get("/health", tags=["meta"], summary="Health check")
async def health():
    """Returns 200 OK when the API is up."""
    return {"status": "ok", "environment": settings.environment}
