# sms_service.py
# Feature 4.4: Backup Finder — SMS notifications
#
# Sends backup-request SMS messages to volunteers via Twilio.
#
# Dev / stub behaviour:
#   When ENVIRONMENT=development OR Twilio credentials are missing,
#   messages are logged to console instead of sent.
#   This lets the full backup-finder flow be tested without Twilio charges.
#
# To enable real SMS later:
#   1. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER to backend/.env
#   2. Set ENVIRONMENT=production

import logging
from app.config import Settings

logger = logging.getLogger("volunteerflow.sms")


class SMSService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._twilio_client = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def send_backup_request(
        self,
        volunteer: dict,
        shift: dict,
        org_name: str,
    ) -> dict:
        """
        Send a backup-request SMS to a single volunteer.

        Args:
            volunteer: dict with keys first_name, last_name, mobile
            shift:     dict with keys title, date, start_time, location (optional)
            org_name:  name of the organization (shown at the end of the SMS)

        Returns:
            dict with:
              sent (bool), stub (bool), to (str), and optionally sid or error
        """
        message = self._build_message(volunteer, shift, org_name)
        to_number = volunteer["mobile"]

        if self._use_stub():
            logger.info(
                "[SMS STUB] To: %s | Message: %s", to_number, message
            )
            return {"sent": True, "stub": True, "to": to_number}

        # --- Real Twilio send ---
        try:
            client = self._get_twilio_client()
            msg = client.messages.create(
                body=message,
                from_=self.settings.twilio_phone_number,
                to=to_number,
            )
            logger.info("Twilio ← SMS sent OK (sid=%s to=%s)", msg.sid, to_number)
            return {"sent": True, "stub": False, "sid": msg.sid, "to": to_number}
        except Exception as exc:
            logger.error("Twilio send error (to=%s): %s", to_number, exc)
            return {"sent": False, "stub": False, "to": to_number, "error": str(exc)}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _use_stub(self) -> bool:
        return (
            not self.settings.is_production
            or not self.settings.twilio_account_sid
            or not self.settings.twilio_auth_token
        )

    def _get_twilio_client(self):
        if self._twilio_client is None:
            from twilio.rest import Client
            self._twilio_client = Client(
                self.settings.twilio_account_sid,
                self.settings.twilio_auth_token,
            )
        return self._twilio_client

    @staticmethod
    def _build_message(volunteer: dict, shift: dict, org_name: str) -> str:
        """Format the SMS message from the template in prd.md §4.4."""
        time_str = (shift.get("start_time") or "")[:5]  # HH:MM
        location_part = (
            f" at {shift['location']}" if shift.get("location") else ""
        )
        return (
            f"Hi {volunteer['first_name']}, can you cover {shift['title']} "
            f"on {shift['date']} at {time_str}{location_part}? "
            f"Reply YES to confirm. \u2013 {org_name}"
        )
