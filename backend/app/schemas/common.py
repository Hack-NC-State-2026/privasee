"""Common response schemas."""

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = Field(..., description="Service status")
    environment: str = Field(..., description="Current environment")


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str = Field(..., description="Response message")
