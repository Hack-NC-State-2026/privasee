# Backend (FastAPI)

Basic FastAPI boilerplate with a flat API structure.

## Structure

```
backend/
├── app/
│   ├── main.py           # App factory and entry point
│   ├── core/             # Config, security
│   │   └── config.py     # Settings (pydantic-settings)
│   ├── api/
│   │   ├── router.py     # Aggregates all API routes
│   │   ├── health.py
│   │   ├── root.py
│   │   └── tos_processor/
│   │       ├── __init__.py
│   │       └── router.py
│   └── schemas/          # Pydantic request/response models
├── requirements.txt
├── .env.example
└── README.md
```

## Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium   # headless browser for JS-rendered pages
cp .env.example .env       # optional: edit .env
```

Set `GEMINI_API_KEY` in `backend/.env`. The Valkey defaults in `.env.example` already point to a local Docker container on `127.0.0.1:6379`.

## Local Valkey Container

Build and run Valkey from the repo root:

```bash
docker build -f docker/valkey/Dockerfile -t privasee-valkey .
docker run -d \
  --name privasee-valkey \
  -p 127.0.0.1:6379:6379 \
  -v privasee-valkey-data:/data \
  privasee-valkey
```

Useful follow-up commands:

```bash
docker logs -f privasee-valkey
docker start privasee-valkey
docker stop privasee-valkey
```

## Run

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Before starting the API, make sure the `privasee-valkey` container is running. The Docker command above binds Valkey to `127.0.0.1` only, so it stays local to your machine while remaining reachable by the backend.

- API root: http://localhost:8000/api/
- Health: http://localhost:8000/api/health
- TOS processor: http://localhost:8000/api/tos_processor/
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Adding endpoints

- **Flat route**: add a module under `app/api/` (e.g. `app/api/items.py`) with a `router`, then include it in `app/api/router.py`.
- **Feature folder**: add a folder under `app/api/` (e.g. `app/api/tos_processor/`) with its own `router.py`, then include that router in `app/api/router.py`.

For database access, add `app/db/` and `app/models/`, and wire a session dependency in `app/core/`.
