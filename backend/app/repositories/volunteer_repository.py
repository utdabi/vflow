# volunteer_repository.py
# Feature 1.2: Volunteer Management
#
# Repository for the volunteers table.
# Columns: first_name, last_name, gender (opt), date_of_birth (opt),
#          email (opt), mobile (E.164 required), skills, notes
#
# The CSV parser is deliberately strict so coordinators know immediately
# when they have bad data — better to fail loudly at preview than silently
# drop rows at confirm time.

import csv
import io
import re
import unicodedata
import logging
from typing import Any

from rapidfuzz.distance import JaroWinkler
from supabase import Client

from app.repositories.base_repository import BaseRepository

logger = logging.getLogger("volunteerflow.volunteer_repository")

# E.164: starts with +, country code digit (1-9), then 9-14 more digits
MOBILE_RE = re.compile(r"^\+[1-9]\d{9,14}$")

# ISO 8601 date: YYYY-MM-DD  (we also accept DD/MM/YYYY and MM/DD/YYYY below)
DATE_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DATE_DMY_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")

VALID_GENDERS = {"male", "female", "non-binary", "prefer not to say", "other", ""}


def _clean(value: str | None) -> str:
    """
    Strip leading/trailing whitespace including Unicode non-breaking spaces.
    Also strips surrounding double-quotes that appear when a user types a space
    before an opening quote in a CSV cell (which prevents the csv module from
    treating the cell as a properly quoted field).
    """
    if not value:
        return ""
    cleaned = unicodedata.normalize("NFC", value).strip()
    # Remove surrounding double-quotes if the whole value is wrapped in them
    # e.g. '"sorting,packing"' → 'sorting,packing'
    if len(cleaned) >= 2 and cleaned.startswith('"') and cleaned.endswith('"'):
        cleaned = cleaned[1:-1]
    return cleaned


def _normalize_mobile(raw: str) -> str:
    """
    Try to normalise common mis-formats before validating:
      - Remove spaces, dashes, dots, parentheses between digits
      - 00xxx → +xxx (common non-US habit)
      - Bare digits that look like a full E.164 number minus the leading +
        (10–15 digits, first digit 1–9) → prepend +
        This handles CSV/Excel exports where the + gets stripped by the
        spreadsheet app (e.g. 12125550101 → +12125550101).
    Returns the normalised string (may still fail MOBILE_RE).
    """
    cleaned = re.sub(r"[\s\-\.\(\)]", "", raw)
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    elif re.match(r"^[1-9]\d{9,14}$", cleaned):
        # Looks like a full international number without the leading +
        cleaned = "+" + cleaned
    return cleaned


def _col_key(raw: str) -> str:
    """Normalise a CSV column header to a snake_case key.
    Strips trailing parenthetical annotations so that headers like
    'ID (DO NOT MODIFY)' map to 'id', same as a plain 'ID' header."""
    s = re.sub(r"\s*\(.*\)\s*$", "", raw.strip().lower()).strip()
    return s.replace(" ", "_")


DAY_NAMES = {
    "sun": 0, "sunday": 0,
    "mon": 1, "monday": 1,
    "tue": 2, "tuesday": 2,
    "wed": 3, "wednesday": 3,
    "thu": 4, "thursday": 4,
    "fri": 5, "friday": 5,
    "sat": 6, "saturday": 6,
}


# Common English nickname → canonical first name.
# Used as a fallback when full-name Jaro-Winkler falls below 0.80.
NICKNAME_MAP: dict[str, str] = {
    "bob": "robert", "bobby": "robert", "rob": "robert",
    "bill": "william", "billy": "william", "will": "william",
    "jim": "james", "jimmy": "james",
    "jack": "john", "johnny": "john",
    "liz": "elizabeth", "beth": "elizabeth", "betty": "elizabeth", "ellie": "elizabeth",
    "mike": "michael", "mickey": "michael",
    "dave": "david",
    "chris": "christopher",
    "tom": "thomas", "tommy": "thomas",
    "dick": "richard", "rick": "richard",
    "sue": "susan", "susie": "susan",
    "kate": "katherine", "kathy": "katherine", "katie": "katherine",
    "maggie": "margaret", "meg": "margaret",
}


def _are_nickname_match(first_a: str, first_b: str) -> bool:
    """Return True if both first names reduce to the same canonical name."""
    a, b = first_a.lower().strip(), first_b.lower().strip()
    if a == b:
        return True
    return NICKNAME_MAP.get(a, a) == NICKNAME_MAP.get(b, b)


def _score_pair(a: dict, b: dict) -> tuple[int, dict]:
    """Fellegi-Sunter weighted score for a candidate duplicate pair.

    Returns (score, field_matches) where field_matches values are:
      'match' | 'close' (fuzzy) | 'mismatch' | 'missing'

    Thresholds: score >= 12 → likely duplicate; 6–11 → possible; < 6 → skip.
    """
    score = 0
    matches: dict[str, str] = {}

    # Mobile — anchor field, highest discriminating power
    mob_a, mob_b = a.get("mobile"), b.get("mobile")
    if mob_a and mob_b:
        if mob_a == mob_b:
            score += 10; matches["mobile"] = "match"
        else:
            score -= 3; matches["mobile"] = "mismatch"
    else:
        matches["mobile"] = "missing"

    # Full name — Jaro-Winkler fuzzy comparison (weights prefix matches more)
    name_a = f"{a.get('first_name', '')} {a.get('last_name', '')}".strip().lower()
    name_b = f"{b.get('first_name', '')} {b.get('last_name', '')}".strip().lower()
    jw = JaroWinkler.normalized_similarity(name_a, name_b)
    if jw >= 0.92:
        score += 6; matches["name"] = "match"
    elif jw >= 0.80:
        score += 3; matches["name"] = "close"
    else:
        # Nickname fallback: Bob/Robert, Bill/William, etc.
        # Requires BOTH nickname match AND similar last name to score as "close"
        # (guards against husband/wife who share an email but have different first names)
        last_a = (a.get("last_name") or "").lower().strip()
        last_b = (b.get("last_name") or "").lower().strip()
        last_jw = JaroWinkler.normalized_similarity(last_a, last_b) if last_a and last_b else 0.0
        if _are_nickname_match(a.get("first_name", ""), b.get("first_name", "")) and last_jw >= 0.80:
            score += 3; matches["name"] = "close"
        else:
            score -= 4; matches["name"] = "mismatch"

    # Email — optional booster; missing = neutral
    email_a = (a.get("email") or "").lower()
    email_b = (b.get("email") or "").lower()
    if email_a and email_b:
        if email_a == email_b:
            score += 6; matches["email"] = "match"
        else:
            score -= 1; matches["email"] = "mismatch"
    else:
        matches["email"] = "missing"

    # Date of birth — optional booster; missing = neutral
    dob_a, dob_b = a.get("date_of_birth"), b.get("date_of_birth")
    if dob_a and dob_b:
        if dob_a == dob_b:
            score += 4; matches["date_of_birth"] = "match"
        else:
            score -= 2; matches["date_of_birth"] = "mismatch"
    else:
        matches["date_of_birth"] = "missing"

    return score, matches


def _parse_date(raw: str, date_format: str = "INTL") -> str | None:
    """
    Accept multiple date formats, return ISO 8601 (YYYY-MM-DD) or None.

    YYYY-MM-DD is always accepted and returned as-is.
    For DD/MM/YYYY vs MM/DD/YYYY, the `date_format` param determines the
    interpretation when both could be valid (e.g. 01/06/1990):
      'INTL' → DD/MM/YYYY  (day first)
      'US'   → MM/DD/YYYY  (month first)
    Unambiguous cases (day > 12) are handled automatically regardless of format.

    Returns None if raw is empty.
    Raises ValueError with a human-readable message if format is unrecognised.
    """
    raw = _clean(raw)
    if not raw:
        return None
    if DATE_ISO_RE.match(raw):
        return raw
    m = DATE_DMY_RE.match(raw)
    if m:
        a, b, year = int(m.group(1)), int(m.group(2)), m.group(3)
        # Unambiguous: if a > 12 it can only be the day (DD/MM)
        if a > 12:
            return f"{year}-{b:02d}-{a:02d}"
        # Unambiguous: if b > 12 it can only be the day (MM/DD)
        if b > 12:
            return f"{year}-{a:02d}-{b:02d}"
        # Ambiguous — use org format preference
        if date_format == "US":
            # MM/DD/YYYY: a=month, b=day
            return f"{year}-{a:02d}-{b:02d}"
        else:
            # DD/MM/YYYY: a=day, b=month  (INTL default)
            return f"{year}-{b:02d}-{a:02d}"
    fmt_hint = "MM/DD/YYYY (e.g. 06/15/1990)" if date_format == "US" else "DD/MM/YYYY (e.g. 15/06/1990)"
    raise ValueError(
        f"Unrecognised date format: {raw!r}. "
        f"Use YYYY-MM-DD (e.g. 1990-06-15) or {fmt_hint}."
    )


def _parse_preferred_days(raw: str) -> list[int]:
    """
    Parse a comma/semicolon-separated list of day names into day indices (0=Sun … 6=Sat).
    Silently ignores unrecognised entries.
    Examples: "Mon,Wed,Fri" → [1, 3, 5]   "Sunday" → [0]
    """
    if not raw:
        return []
    result = []
    for token in re.split(r"[,;]+", raw):
        key = token.strip().lower()
        if key in DAY_NAMES:
            idx = DAY_NAMES[key]
            if idx not in result:
                result.append(idx)
    return sorted(result)


class VolunteerRepository(BaseRepository):
    def __init__(self, client: Client) -> None:
        super().__init__(client, "volunteers")

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def get_volunteers(self, org_id: str, active_only: bool = True) -> list[dict]:
        """Return all volunteers for an org, sorted by last_name then first_name."""
        logger.info(
            "Supabase → list volunteers (org: %s, active_only: %s)", org_id, active_only
        )
        query = (
            self._client.table("volunteers")
            .select("*")
            .eq("organization_id", org_id)
            .order("last_name", desc=False)
            .order("first_name", desc=False)
        )
        query = query.eq("active", active_only)
        try:
            result = query.execute().data
        except Exception as exc:
            logger.error("Supabase ← list volunteers error: %s", exc)
            raise
        logger.info("Supabase ← list volunteers OK (count: %d)", len(result))
        return result

    def get_volunteer(self, volunteer_id: str) -> dict | None:
        """Return a single volunteer by id, or None."""
        logger.info("Supabase → get volunteer (id: %s)", volunteer_id)
        try:
            result = self._get_by_id(volunteer_id)
        except Exception as exc:
            logger.error("Supabase ← get volunteer error: %s", exc)
            raise
        if result:
            logger.info(
                "Supabase ← get volunteer OK (%s %s)",
                result.get("first_name"),
                result.get("last_name"),
            )
        else:
            logger.warning("Supabase ← volunteer not found (id: %s)", volunteer_id)
        return result

    # ------------------------------------------------------------------
    # Mutation helpers
    # ------------------------------------------------------------------

    def create_volunteer(self, org_id: str, data: dict[str, Any]) -> dict:
        logger.info(
            "Supabase → create volunteer (org: %s, name: %s %s)",
            org_id,
            data.get("first_name"),
            data.get("last_name"),
        )
        try:
            record = self._create({"organization_id": org_id, **data})
        except Exception as exc:
            logger.error("Supabase ← create volunteer error: %s", exc)
            raise
        logger.info("Supabase ← volunteer created (id: %s)", record.get("id"))
        return record

    def update_volunteer(self, volunteer_id: str, data: dict[str, Any]) -> dict:
        logger.info("Supabase → update volunteer (id: %s)", volunteer_id)
        try:
            record = self._update(volunteer_id, data)
        except Exception as exc:
            logger.error("Supabase ← update volunteer error: %s", exc)
            raise
        logger.info("Supabase ← volunteer updated OK")
        return record

    def deactivate_volunteer(self, volunteer_id: str) -> dict:
        """Soft-delete: set active=False. Never hard-deletes."""
        logger.info("Supabase → deactivate volunteer (id: %s)", volunteer_id)
        try:
            record = self._update(volunteer_id, {"active": False})
        except Exception as exc:
            logger.error("Supabase ← deactivate volunteer error: %s", exc)
            raise
        logger.info("Supabase ← volunteer deactivated OK")
        return record

    def find_duplicates(self, org_id: str) -> list[dict]:
        """Compare all active volunteers in the org and return candidate duplicate pairs.

        Each pair includes a Fellegi-Sunter score, a confidence label, per-field
        match results, and shift counts for both volunteers.
        """
        logger.info("Supabase → find duplicates (org: %s)", org_id)
        resp = (
            self._client.table("volunteers")
            .select("id,first_name,last_name,mobile,email,date_of_birth,gender,preferred_days,skills,notes,updated_at,created_at")
            .eq("organization_id", org_id)
            .eq("active", True)
            .execute()
        )
        vols = resp.data or []
        logger.info("Supabase ← find duplicates OK (scanning %d volunteers)", len(vols))

        results = []
        for i in range(len(vols)):
            for j in range(i + 1, len(vols)):
                score, field_matches = _score_pair(vols[i], vols[j])
                if score >= 6:
                    results.append({
                        "volunteer_a": dict(vols[i]),
                        "volunteer_b": dict(vols[j]),
                        "score": score,
                        "confidence": "likely" if score >= 12 else "possible",
                        "field_matches": field_matches,
                    })
        results.sort(key=lambda r: r["score"], reverse=True)

        # Enrich each volunteer with their shift count
        vol_ids = list({v["id"] for r in results for v in [r["volunteer_a"], r["volunteer_b"]]})
        if vol_ids:
            try:
                assignments = (
                    self._client.table("shift_assignments")
                    .select("volunteer_id")
                    .in_("volunteer_id", vol_ids)
                    .execute()
                    .data or []
                )
            except Exception as exc:
                logger.error("Supabase ← shift counts error: %s", exc)
                assignments = []
            count_map: dict[str, int] = {}
            for row in assignments:
                vid = row["volunteer_id"]
                count_map[vid] = count_map.get(vid, 0) + 1
            for r in results:
                r["volunteer_a"]["shift_count"] = count_map.get(r["volunteer_a"]["id"], 0)
                r["volunteer_b"]["shift_count"] = count_map.get(r["volunteer_b"]["id"], 0)

        logger.info("Supabase ← find duplicates: %d candidate pairs", len(results))
        return results

    def merge_volunteers(
        self,
        primary_id: str,
        secondary_id: str,
        org_id: str,
        field_overrides: dict | None = None,
    ) -> dict:
        """Merge secondary volunteer into primary: re-point all FK references, apply any
        field-level overrides chosen by the coordinator, then hard-delete secondary."""
        logger.info(
            "Supabase → merge volunteers %s ← %s (org: %s)", primary_id, secondary_id, org_id
        )
        # Verify both belong to this org
        for vid in [primary_id, secondary_id]:
            check = (
                self._client.table("volunteers")
                .select("id")
                .eq("id", vid)
                .eq("organization_id", org_id)
                .execute()
            )
            if not check.data:
                raise ValueError(f"Volunteer {vid} not found in org")

        try:
            # Re-point shift_assignments
            self._client.table("shift_assignments").update(
                {"volunteer_id": primary_id}
            ).eq("volunteer_id", secondary_id).execute()

            # Re-point time_logs
            self._client.table("time_logs").update(
                {"volunteer_id": primary_id}
            ).eq("volunteer_id", secondary_id).execute()

            # Hard-delete secondary — FKs already re-pointed above.
            # Must happen BEFORE field-override patch so that unique constraints
            # (mobile, email per org) don't fire when copying a value that currently
            # belongs to the secondary record.
            self._client.table("volunteers").delete().eq(
                "id", secondary_id
            ).eq("organization_id", org_id).execute()

            # Apply coordinator-chosen field overrides from the secondary record
            if field_overrides:
                MERGEABLE = {
                    "first_name", "last_name", "gender", "date_of_birth",
                    "email", "mobile", "skills", "notes", "preferred_days",
                }
                safe_overrides = {k: v for k, v in field_overrides.items() if k in MERGEABLE}
                if safe_overrides:
                    logger.info(
                        "Supabase → patch primary with field overrides: %s",
                        list(safe_overrides.keys()),
                    )
                    patch_resp = self._client.table("volunteers").update(safe_overrides).eq(
                        "id", primary_id
                    ).execute()
                    logger.info(
                        "Supabase ← patch primary overrides OK: %s → data=%s",
                        list(safe_overrides.keys()),
                        patch_resp.data,
                    )
        except Exception as exc:
            logger.error("Supabase ← merge volunteers error: %s", exc)
            raise

        logger.info("Supabase ← merge volunteers OK (primary: %s)", primary_id)
        result = (
            self._client.table("volunteers").select("*").eq("id", primary_id).execute()
        )
        return result.data[0]

    def bulk_create(self, org_id: str, rows: list[dict[str, Any]]) -> list[dict]:
        """Bulk-insert validated volunteer rows from CSV import."""
        logger.info(
            "Supabase → bulk insert %d volunteers (org: %s)", len(rows), org_id
        )
        records = [{"organization_id": org_id, **row} for row in rows]
        try:
            result = self._client.table("volunteers").insert(records).execute().data
        except Exception as exc:
            logger.error("Supabase ← bulk insert error: %s", exc)
            raise
        logger.info("Supabase ← bulk insert OK (inserted: %d)", len(result))
        return result

    def get_all_ids(self, org_id: str) -> list[str]:
        """Return all volunteer UUIDs for an org (used for round-trip CSV validation)."""
        logger.info("Supabase → get volunteer IDs (org: %s)", org_id)
        try:
            result = (
                self._client.table("volunteers")
                .select("id")
                .eq("organization_id", org_id)
                .execute()
                .data
            )
        except Exception as exc:
            logger.error("Supabase ← get volunteer IDs error: %s", exc)
            raise
        logger.info("Supabase ← get volunteer IDs OK (count: %d)", len(result))
        return [row["id"] for row in result]

    def bulk_update(self, org_id: str, rows: list[dict[str, Any]]) -> int:
        """
        Update existing volunteers from round-trip CSV import rows.
        Only user-editable fields are written; active/total_hours/etc. are untouched.
        The updated_at trigger handles the timestamp automatically.
        Returns the count of rows successfully updated.
        """
        UPDATABLE = {
            "first_name", "last_name", "gender", "date_of_birth",
            "email", "mobile", "skills", "notes", "preferred_days", "active",
        }
        count = 0
        for row in rows:
            vol_id = row["id"]
            payload = {k: v for k, v in row.items() if k in UPDATABLE}
            logger.info("Supabase → update volunteer (id: %s, org: %s)", vol_id, org_id)
            try:
                resp = (
                    self._client.table("volunteers")
                    .update(payload)
                    .eq("id", vol_id)
                    .eq("organization_id", org_id)  # security: can't update another org's record
                    .execute()
                )
            except Exception as exc:
                logger.error("Supabase ← update volunteer error: %s", exc)
                raise
            if resp.data:
                logger.info("Supabase ← update volunteer OK (id: %s)", vol_id)
                count += 1
            else:
                logger.warning(
                    "Supabase ← update volunteer: no rows matched (id: %s)", vol_id
                )
        return count

    # ------------------------------------------------------------------
    # CSV parsing (pure Python — no DB calls)
    # ------------------------------------------------------------------

    @staticmethod
    def parse_csv(
        file_bytes: bytes,
        date_format: str = "INTL",
        existing_ids: set[str] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """
        Parse a CSV byte payload and split rows into valid / invalid bins.

        Expected columns (case-insensitive, extra columns silently ignored):
          id             — optional; present in exports for round-trip update flow
          first_name     — required
          last_name      — required
          mobile         — required, E.164 (+12125551234)
          gender         — optional (Male / Female / Non-binary / Prefer not to say / Other)
          date_of_birth  — optional (YYYY-MM-DD, DD/MM/YYYY for INTL, or MM/DD/YYYY for US)
          email          — optional
          skills         — optional, comma-separated values inside quotes
          notes          — optional
          preferred_days — optional, comma-separated day names (Mon, Tue, Wed, Thu, Fri, Sat, Sun)

        Round-trip update flow:
          When the CSV contains an 'id' column (i.e. was produced by the "Export list" button),
          rows with a recognised UUID get action="update"; rows with a blank id get action="create".
          Rows with an id that is not in existing_ids are marked invalid.
          Duplicate IDs within the same file are also marked invalid.

        Robustness features:
          - UTF-8 BOM stripping (Excel exports)
          - Blank rows skipped silently
          - Unicode whitespace stripped from every cell
          - Spaces/dashes/dots removed from mobile numbers before validation
          - 00xxx prefix converted to +xxx
          - YYYY-MM-DD always accepted; DD/MM or MM/DD interpretation follows date_format param
          - Quoted commas in skills cells handled by csv module

        Returns:
          valid_rows   — list of dicts ready to insert/update (org_id added by caller);
                         each row has an 'action' key: 'create' or 'update'
          invalid_rows — list of {row_number, error_message, raw}
        """
        # Decode with BOM handling (Excel writes UTF-8-BOM)
        text = file_bytes.decode("utf-8-sig")

        # skipinitialspace=True: strips the leading space after each comma so
        # that cells like ' "sorting,packing"' are correctly treated as quoted
        # fields instead of being split on the embedded comma.
        reader = csv.DictReader(io.StringIO(text), skipinitialspace=True)

        if reader.fieldnames is None:
            return [], [{"row_number": 0, "error_message": "File is empty or unreadable — no headers found."}]

        # Normalise header names: lowercase + strip whitespace + strip parenthetical annotations
        header_map: dict[str, str] = {
            _col_key(h): h for h in reader.fieldnames
        }
        normalised_headers = set(header_map.keys())

        required_headers = {"first_name", "last_name", "mobile"}
        missing = required_headers - normalised_headers
        if missing:
            return [], [
                {
                    "row_number": 0,
                    "error_message": (
                        f"CSV is missing required columns: {', '.join(sorted(missing))}. "
                        f"Found columns: {', '.join(sorted(normalised_headers)) or '(none)'}. "
                        "Please download the template and use it."
                    ),
                }
            ]

        # Does this file have an 'id' column? (i.e. was it produced by Export list?)
        has_id_column = "id" in normalised_headers

        valid_rows: list[dict[str, Any]] = []
        invalid_rows: list[dict[str, Any]] = []

        for row_num, raw_row in enumerate(reader, start=2):
            # Skip completely blank rows (Excel ghost rows)
            if all(not v for v in raw_row.values()):
                continue

            # Normalise keys + strip all cell values
            row = {
                _col_key(k): _clean(v)
                for k, v in raw_row.items()
                if k is not None
            }

            first_name     = row.get("first_name", "")
            last_name      = row.get("last_name", "")
            mobile_raw     = row.get("mobile", "")
            gender         = row.get("gender", "") or None
            dob_raw        = row.get("date_of_birth", "") or row.get("dob", "")
            email          = row.get("email", "") or None
            skills_raw     = row.get("skills", "")
            notes          = row.get("notes", "") or None
            pref_days_raw  = row.get("preferred_days", "")
            status_raw     = row.get("status", "")

            # Parse skills — comma-separated list (may be quoted in the CSV)
            skills = (
                [s.strip() for s in skills_raw.split(",") if s.strip()]
                if skills_raw
                else []
            )

            # Parse preferred_days — comma-separated day names → indices
            preferred_days = _parse_preferred_days(pref_days_raw)

            errors: list[str] = []

            if not first_name:
                errors.append("'first_name' is required")
            if not last_name:
                errors.append("'last_name' is required")

            # Mobile: normalise then validate
            mobile_normalised = _normalize_mobile(mobile_raw) if mobile_raw else ""
            if not mobile_raw:
                errors.append("'mobile' is required")
            elif not MOBILE_RE.match(mobile_normalised):
                errors.append(
                    f"'mobile' must be E.164 format (e.g. +12125551234 or +447911123456). "
                    f"Got: {mobile_raw!r} — remove spaces, dashes, and make sure it starts with +"
                )

            # Gender: accept common variants case-insensitively
            if gender and gender.lower() not in VALID_GENDERS:
                errors.append(
                    f"'gender' should be one of: Male, Female, Non-binary, "
                    f"Prefer not to say, Other. Got: {gender!r}"
                )

            # Date of birth — parse using the org's date format preference
            dob_parsed: str | None = None
            try:
                dob_parsed = _parse_date(dob_raw, date_format)
            except ValueError as e:
                errors.append(str(e))

            # Status → active boolean
            active_value: bool | None = None
            if status_raw:
                s = status_raw.lower()
                if s in ("active", "true", "1", "yes"):
                    active_value = True
                elif s in ("inactive", "false", "0", "no"):
                    active_value = False
                else:
                    errors.append(
                        f"'status' must be 'Active' or 'Inactive'. Got: {status_raw!r}"
                    )

            if errors:
                invalid_rows.append(
                    {
                        "row_number": row_num,
                        "error_message": "; ".join(errors),
                        "raw": {k: v for k, v in raw_row.items() if k is not None},
                    }
                )
                continue

            # Build the validated dict
            parsed: dict[str, Any] = {
                "first_name":     first_name,
                "last_name":      last_name,
                "gender":         gender,
                "date_of_birth":  dob_parsed,
                "email":          email,
                "mobile":         mobile_normalised,
                "skills":         skills,
                "notes":          notes,
                "preferred_days": preferred_days,
                "_row_num":       row_num,  # temp key for duplicate detection below
                **({"active": active_value} if active_value is not None else {}),
            }

            # Round-trip: classify as create or update based on id column
            if has_id_column:
                raw_id = row.get("id", "").strip()
                if raw_id:
                    if existing_ids is None or raw_id not in existing_ids:
                        invalid_rows.append(
                            {
                                "row_number": row_num,
                                "error_message": (
                                    "ID not recognised. To update an existing volunteer, "
                                    "export the list first; to add a new volunteer, "
                                    "leave the ID column blank."
                                ),
                                "raw": {k: v for k, v in raw_row.items() if k is not None},
                            }
                        )
                        continue
                    parsed["id"] = raw_id
                    parsed["action"] = "update"
                else:
                    parsed["action"] = "create"
            else:
                parsed["action"] = "create"

            valid_rows.append(parsed)

        # Detect duplicate IDs within the same file (second occurrence wins nothing)
        seen_ids: set[str] = set()
        final_valid: list[dict[str, Any]] = []
        for row in valid_rows:
            rid = row.get("id")
            if rid:
                if rid in seen_ids:
                    invalid_rows.append(
                        {
                            "row_number": row["_row_num"],
                            "error_message": (
                                "Duplicate ID: this volunteer appears more than once in the file. "
                                "Only the first occurrence is kept."
                            ),
                            "raw": {},
                        }
                    )
                    continue
                seen_ids.add(rid)
            final_valid.append({k: v for k, v in row.items() if k != "_row_num"})

        return final_valid, invalid_rows
