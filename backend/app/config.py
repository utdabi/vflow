# config.py
# Feature 1.1: Organizations & Setup Links
# Loads all environment variables with validation using Pydantic BaseSettings.
# All secrets come from backend/.env — never hardcoded here.

from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Supabase
    supabase_url: str
    supabase_service_key: str
    # No longer required: Supabase migrated to RS256 signing keys.
    # Token validation is done via supabase.auth.get_user() instead.
    supabase_jwt_secret: str = ""

    # LaunchDarkly
    launchdarkly_sdk_key: str = ""

    # Twilio
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""

    # Sentry
    sentry_dsn: str = ""

    # App
    environment: str = "development"
    allowed_origins: str = "http://localhost:5173"
    app_base_url: str = "http://localhost:5173"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
