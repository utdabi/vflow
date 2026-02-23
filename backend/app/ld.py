# ld.py
# LaunchDarkly client singleton for the VolunteerFlow backend.
#
# Usage:
#   from app.ld import init_ld, get_flag
#   init_ld(settings.launchdarkly_sdk_key)          # call once in main.py startup
#   value = get_flag("enable-backup-finder", org_id, False)
#
# If the SDK key is missing or LD is unreachable, every flag falls back to its
# default value (safe mode — nothing breaks, new features stay hidden).

import logging
import ldclient
from ldclient.config import Config

logger = logging.getLogger("volunteerflow.ld")

_configured = False


def init_ld(sdk_key: str) -> None:
    """Initialize the LaunchDarkly SDK.  Call exactly once during startup."""
    global _configured
    if not sdk_key:
        logger.warning("LaunchDarkly SDK key not set — all flags will use their defaults")
        return
    try:
        ldclient.set_config(Config(sdk_key))
        client = ldclient.get()
        if client.is_initialized():
            logger.info("LaunchDarkly ← client initialized OK")
        else:
            logger.warning("LaunchDarkly ← client not yet initialized (will stream in background)")
        _configured = True
    except Exception as exc:
        logger.error("LaunchDarkly init error: %s", exc)


def get_flag(flag_key: str, org_id: str, default):
    """
    Evaluate a feature flag for an organization context.

    Returns `default` when:
      - SDK key was not configured, OR
      - LD is unreachable, OR
      - An unexpected error occurs

    Args:
        flag_key: LaunchDarkly flag key (e.g. "enable-backup-finder")
        org_id:   The organization UUID — used as the evaluation context key
        default:  Fallback value (bool, int, str, etc.)
    """
    if not _configured:
        return default
    try:
        from ldclient import Context
        ctx = Context.builder(org_id).kind("organization").build()
        return ldclient.get().variation(flag_key, ctx, default)
    except Exception as exc:
        logger.error("LaunchDarkly flag evaluation error (%s): %s", flag_key, exc)
        return default
