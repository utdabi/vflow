# shift_repository.py
# Feature 4.3: Shift Scheduling & Assignment
#
# Repository for the shifts and shift_assignments tables.
# Handles all DB interactions for shifts: create, list by month, get with
# assignments, update, delete, assign volunteer, cancel assignment.

import logging
from datetime import date
from typing import Any

from supabase import Client

from app.repositories.base_repository import BaseRepository

logger = logging.getLogger("volunteerflow.shift_repository")


class ShiftRepository(BaseRepository):
    def __init__(self, client: Client) -> None:
        super().__init__(client, "shifts")

    # ------------------------------------------------------------------
    # Shifts CRUD
    # ------------------------------------------------------------------

    def list_by_month(self, org_id: str, year: int, month: int) -> list[dict]:
        """
        Return all shifts for an org in a given year/month, each annotated with
        the count of active (non-cancelled) assignments.
        """
        import calendar
        last_day = calendar.monthrange(year, month)[1]
        start_date = f"{year:04d}-{month:02d}-01"
        end_date   = f"{year:04d}-{month:02d}-{last_day:02d}"

        logger.info(
            "Supabase → list shifts (org: %s, %d-%02d)", org_id, year, month
        )
        try:
            result = (
                self._client.table("shifts")
                .select("*, shift_assignments(id, volunteer_id, cancelled_at)")
                .eq("organization_id", org_id)
                .gte("date", start_date)
                .lte("date", end_date)
                .order("date", desc=False)
                .order("start_time", desc=False)
                .execute()
                .data
            )
        except Exception as exc:
            logger.error("Supabase ← list shifts error: %s", exc)
            raise

        # Annotate each shift with assigned_count (active only)
        for shift in result:
            assignments = shift.pop("shift_assignments", []) or []
            shift["assigned_count"] = sum(
                1 for a in assignments if a.get("cancelled_at") is None
            )

        logger.info("Supabase ← list shifts OK (count: %d)", len(result))
        return result

    def get_shift_with_assignments(self, shift_id: str) -> dict | None:
        """
        Return a single shift with its full volunteer assignment list.
        Each assignment includes volunteer details (first_name, last_name, mobile).
        """
        logger.info("Supabase → get shift (id: %s)", shift_id)
        try:
            rows = (
                self._client.table("shifts")
                .select(
                    "*, shift_assignments("
                    "  id, volunteer_id, assigned_at, cancelled_at, cancel_reason,"
                    "  volunteers(id, first_name, last_name, mobile, email, gender, date_of_birth, skills, notes)"
                    ")"
                )
                .eq("id", shift_id)
                .limit(1)
                .execute()
                .data
            )
        except Exception as exc:
            logger.error("Supabase ← get shift error: %s", exc)
            raise

        if not rows:
            logger.warning("Supabase ← shift not found (id: %s)", shift_id)
            return None

        shift = rows[0]
        assignments = shift.pop("shift_assignments", []) or []
        # Split active vs cancelled for easy frontend consumption
        shift["assignments"] = [a for a in assignments if a.get("cancelled_at") is None]
        shift["cancelled_assignments"] = [a for a in assignments if a.get("cancelled_at") is not None]
        shift["assigned_count"] = len(shift["assignments"])

        logger.info(
            "Supabase ← get shift OK (title: %s, assigned: %d)",
            shift.get("title"),
            shift["assigned_count"],
        )
        return shift

    def create_shift(self, org_id: str, data: dict[str, Any]) -> dict:
        logger.info(
            "Supabase → create shift (org: %s, title: %s, date: %s)",
            org_id,
            data.get("title"),
            data.get("date"),
        )
        try:
            record = self._create({"organization_id": org_id, **data})
        except Exception as exc:
            logger.error("Supabase ← create shift error: %s", exc)
            raise
        logger.info("Supabase ← shift created (id: %s)", record.get("id"))
        return record

    def update_shift(self, shift_id: str, data: dict[str, Any]) -> dict:
        logger.info("Supabase → update shift (id: %s)", shift_id)
        try:
            record = self._update(shift_id, data)
        except Exception as exc:
            logger.error("Supabase ← update shift error: %s", exc)
            raise
        logger.info("Supabase ← shift updated OK")
        return record

    def delete_shift(self, shift_id: str) -> None:
        logger.info("Supabase → delete shift (id: %s)", shift_id)
        try:
            self._client.table("shifts").delete().eq("id", shift_id).execute()
        except Exception as exc:
            logger.error("Supabase ← delete shift error: %s", exc)
            raise
        logger.info("Supabase ← shift deleted OK")

    # ------------------------------------------------------------------
    # Assignments
    # ------------------------------------------------------------------

    def assign_volunteer(self, shift_id: str, volunteer_id: str) -> dict:
        """
        Assign a volunteer to a shift.  Uses upsert to handle the case where
        the volunteer was previously cancelled (clears cancelled_at).
        """
        logger.info(
            "Supabase → assign volunteer (shift: %s, volunteer: %s)",
            shift_id,
            volunteer_id,
        )
        try:
            result = (
                self._client.table("shift_assignments")
                .upsert(
                    {
                        "shift_id": shift_id,
                        "volunteer_id": volunteer_id,
                        "cancelled_at": None,
                        "cancel_reason": None,
                    },
                    on_conflict="shift_id,volunteer_id",
                )
                .execute()
                .data
            )
        except Exception as exc:
            logger.error("Supabase ← assign volunteer error: %s", exc)
            raise
        logger.info("Supabase ← volunteer assigned OK")
        return result[0] if result else {}

    def cancel_assignment(
        self, shift_id: str, volunteer_id: str, reason: str | None = None
    ) -> dict:
        """
        Cancel a volunteer's assignment (soft-delete via cancelled_at timestamp).
        """
        from datetime import datetime, timezone
        logger.info(
            "Supabase → cancel assignment (shift: %s, volunteer: %s)",
            shift_id,
            volunteer_id,
        )
        try:
            result = (
                self._client.table("shift_assignments")
                .update(
                    {
                        "cancelled_at": datetime.now(timezone.utc).isoformat(),
                        "cancel_reason": reason,
                    }
                )
                .eq("shift_id", shift_id)
                .eq("volunteer_id", volunteer_id)
                .is_("cancelled_at", "null")
                .execute()
                .data
            )
        except Exception as exc:
            logger.error("Supabase ← cancel assignment error: %s", exc)
            raise
        logger.info("Supabase ← assignment cancelled OK")
        return result[0] if result else {}

    def get_assignment(self, shift_id: str, volunteer_id: str) -> dict | None:
        """Return the assignment record if it exists and is active (not cancelled)."""
        try:
            rows = (
                self._client.table("shift_assignments")
                .select("*")
                .eq("shift_id", shift_id)
                .eq("volunteer_id", volunteer_id)
                .is_("cancelled_at", "null")
                .limit(1)
                .execute()
                .data
            )
        except Exception as exc:
            logger.error("Supabase ← get assignment error: %s", exc)
            raise
        return rows[0] if rows else None
