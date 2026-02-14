"""Root / welcome endpoint."""

from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.schemas.common import MessageResponse

router = APIRouter(tags=["root"])


@router.get("/", response_model=MessageResponse)
def root(settings: Settings = Depends(get_settings)) -> MessageResponse:
    """Welcome message and API info."""
    return MessageResponse(
        message=f"{settings.app_name} is running. Use /docs for Swagger UI."
    )
