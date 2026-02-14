"""Application settings via pydantic-settings."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Load from environment and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Backend API"
    debug: bool = False
    environment: Literal["development", "staging", "production"] = "development"
    gemini_api_key: str | None = None


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance."""
    return Settings()
