"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI

from app.api.router import api_router
from app.core.config import get_settings
from app.db import close as db_close, connect as db_connect

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup and shutdown events."""
    db_connect()
    try:
        yield
    finally:
        db_close()


def create_application() -> FastAPI:
    """Create and configure the FastAPI app."""
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        description="Backend API for the Chrome Extension starter.",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )
    app.include_router(api_router, prefix="/api")
    return app


app = create_application()
