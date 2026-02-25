# Dockerfile — VolunteerFlow Backend (FastAPI + uv)
# Multi-stage build: keeps the final image small by discarding build tools.

# ── Stage 1: install dependencies ─────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

# Copy uv binary from its official image (no pip install uv needed)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy lock files first so Docker can cache the layer when code changes
COPY pyproject.toml uv.lock ./

# Install production deps into an isolated venv inside the image
# --frozen: fail if lockfile is out of date
# --no-dev: skip test/lint tools
# --no-editable: install as normal packages (not editable)
RUN uv sync --frozen --no-dev --no-editable

# ── Stage 2: runtime image ─────────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Copy the pre-built virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application source
COPY app/ ./app/

# Add venv to PATH so `python` and `uvicorn` resolve correctly
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# Run with uvicorn directly (venv is on PATH)
# --workers 2: enough for a t3.micro; increase if you scale up
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
