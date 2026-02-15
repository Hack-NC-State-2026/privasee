"""API router: aggregates all endpoints."""

from fastapi import APIRouter

from app.api import fetch_page, health, kv, root
from app.api import attribute_severity
from app.api.tos_processor import router as tos_processor_router

api_router = APIRouter()

api_router.include_router(root.router)
api_router.include_router(health.router)
api_router.include_router(kv.router)
api_router.include_router(fetch_page.router)
api_router.include_router(tos_processor_router)
api_router.include_router(attribute_severity.router)
