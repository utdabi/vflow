# backup_service.py
# Feature 4.4: Backup Finder
#
# Scoring algorithm — given a shift and the volunteer who just cancelled,
# returns the top 3 replacement candidates ranked by reliability score.
#
# Scoring rubric (prd.md §4.4):
#   +20  Worked a shift with the same title before (familiarity with the role)
#   +15  Never cancelled a shift (times_cancelled == 0)
#   +10  Low cancellation rate (times_cancelled < 2, but > 0)
#   + 5  Worked recently (last_worked_date within the last 30 days)
#
# Candidates are all active volunteers in the org who are NOT:
#   - the volunteer who just cancelled, OR
#   - already confirmed on this shift

import logging
from datetime import date, timedelta

from supabase import Client

logger = logging.getLogger("volunteerflow.backup")


class BackupService:
    def __init__(self, client: Client):
        self.client = client

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def suggest_backups(
        self,
        shift_id: str,
        org_id: str,
        cancelled_volunteer_id: str,
    ) -> list[dict]:
        """
        Returns up to 3 backup candidates, scored and sorted best-first.

        Each item in the returned list has the shape:
          {
            "volunteer": { "id", "first_name", "last_name", "mobile" },
            "score":     int,
            "reasons":   list[str],   # plain-English explanations
          }
        """
        logger.info(
            "Supabase → backup suggestions (shift=%s cancelled=%s)",
            shift_id, cancelled_volunteer_id,
        )

        # 1. Fetch the shift (need title for same-shift-title scoring)
        shift_resp = (
            self.client.table("shifts")
            .select("id, title, organization_id")
            .eq("id", shift_id)
            .single()
            .execute()
        )
        shift = shift_resp.data
        if not shift or shift.get("organization_id") != org_id:
            logger.warning("Backup service: shift %s not found in org %s", shift_id, org_id)
            return []

        shift_title = shift["title"]

        # 2. Get currently-confirmed volunteer IDs for this shift
        assigned_resp = (
            self.client.table("shift_assignments")
            .select("volunteer_id")
            .eq("shift_id", shift_id)
            .eq("status", "confirmed")
            .execute()
        )
        assigned_ids: set[str] = {a["volunteer_id"] for a in (assigned_resp.data or [])}
        excluded_ids = assigned_ids | {cancelled_volunteer_id}

        # 3. Load all active volunteers in the org
        vol_resp = (
            self.client.table("volunteers")
            .select("id, first_name, last_name, mobile, times_cancelled, last_worked_date")
            .eq("organization_id", org_id)
            .eq("active", True)
            .execute()
        )
        all_vols: list[dict] = vol_resp.data or []
        candidates = [v for v in all_vols if v["id"] not in excluded_ids]

        if not candidates:
            logger.info("Backup service: no candidates for shift %s", shift_id)
            return []

        # 4. Find volunteers who have worked same-title shifts before
        experienced_ids = self._get_experienced_volunteer_ids(org_id, shift_title)

        # 5. Score each candidate
        today = date.today()
        results = []
        for vol in candidates:
            score, reasons = self._score(vol, experienced_ids, shift_title, today)
            results.append({
                "volunteer": {
                    "id":         vol["id"],
                    "first_name": vol["first_name"],
                    "last_name":  vol["last_name"],
                    "mobile":     vol["mobile"],
                },
                "score":   score,
                "reasons": reasons,
            })

        # 6. Sort descending by score, return top 3
        results.sort(key=lambda x: x["score"], reverse=True)
        top3 = results[:3]
        logger.info(
            "Supabase ← backup suggestions OK (shift=%s, candidates=%d, top3=%s)",
            shift_id,
            len(candidates),
            [r["volunteer"]["first_name"] for r in top3],
        )
        return top3

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _get_experienced_volunteer_ids(self, org_id: str, shift_title: str) -> set[str]:
        """
        Returns the set of volunteer IDs who have ever had a confirmed
        assignment on any shift with the same title in this org.
        """
        try:
            # Step 1: find all shift IDs with this title in the org
            shift_ids_resp = (
                self.client.table("shifts")
                .select("id")
                .eq("organization_id", org_id)
                .eq("title", shift_title)
                .execute()
            )
            shift_ids = [s["id"] for s in (shift_ids_resp.data or [])]
            if not shift_ids:
                return set()

            # Step 2: find confirmed assignments on those shifts
            hist_resp = (
                self.client.table("shift_assignments")
                .select("volunteer_id")
                .in_("shift_id", shift_ids)
                .eq("status", "confirmed")
                .execute()
            )
            return {h["volunteer_id"] for h in (hist_resp.data or [])}
        except Exception as exc:
            logger.error("Error fetching shift history: %s", exc)
            return set()

    @staticmethod
    def _score(
        vol: dict,
        experienced_ids: set[str],
        shift_title: str,
        today: date,
    ) -> tuple[int, list[str]]:
        """Compute score and plain-English reasons for one candidate volunteer."""
        score = 0
        reasons: list[str] = []

        # +20 Worked a same-title shift before
        if vol["id"] in experienced_ids:
            score += 20
            reasons.append(f"Has worked '{shift_title}' shifts before")

        # +15 Never cancelled / +10 Low cancellation rate
        cancelled_count: int = vol.get("times_cancelled") or 0
        if cancelled_count == 0:
            score += 15
            reasons.append("Never cancelled a shift")
        elif cancelled_count < 2:
            score += 10
            reasons.append("Low cancellation rate")

        # +5 Worked recently (within 30 days)
        lwd_str: str | None = vol.get("last_worked_date")
        if lwd_str:
            try:
                lwd = date.fromisoformat(lwd_str)
                days_ago = (today - lwd).days
                if days_ago <= 30:
                    score += 5
                    reasons.append(f"Last worked {days_ago} day{'s' if days_ago != 1 else ''} ago")
            except ValueError:
                pass

        if not reasons:
            reasons.append("Active volunteer")

        return score, reasons
