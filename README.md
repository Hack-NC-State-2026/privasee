# Privasee — Signup Privacy Insights

A Chrome extension that surfaces **privacy risks at signup**: when you’re on a sign-up or create-account flow, it shows a concise overlay with top data risks, retention summary, and recommendations. The extension is backed by a FastAPI service that analyzes Privacy Policy and Terms of Service documents and serves overlay summaries.

**Backend AI pipeline:** Policy text is sent to **Google Gemini** (e.g. `gemini-2.5-pro`) via **LangChain** (`langchain-google-genai`). Extraction uses **structured output** (Pydantic `PolicyAnalysis`) with `with_structured_output()` so the model returns typed, schema-valid JSON in one call—no separate tool-calling step. Retries handle validation errors (e.g. filtering disallowed attribute values) so the cache stays populated.

---

## Features

- **Signup overlay** — Detects signup/create-account intent (forms, dialogs, URLs) and shows a compact “Privasee Noir” overlay with:
  - Top high-risk data attributes (by category: e.g. sensitive data, user content, identifiers)
  - Short explanations and mitigations (≤15 words for quick scanning)
  - Data retention summary and actionable recommendations
- **Dashboard (Options page)** — Central view for all sites you’ve logged into or visited:
  - **Control Deck** — Filter by posture (Stable / Watch / Critical), keyword search, and refresh to re-sync from Chrome history.
  - **Signal Lane** — Highest-risk domains first, ordered by privacy risk score.
  - **Risk cards** — Per-site score ring, posture badge, identifiers color-coded from Valkey attribute severity, usage flags, retention summary, and a link to **Chrome’s permission manager** (site settings) for that domain so you can review or revoke permissions in one place.
- **Policy analysis** — Backend fetches policy pages, extracts structured risk signals (data collection, retention, legal terms, red flags) via Gemini + LangChain, and caches results in Valkey.
- **Overlay summary API** — Returns top-3 high-risk attributes (deduplicated by section type), retention explanation, and mitigations for a domain.
- **Cross-browser** — Extension runs on Chrome, Edge, Brave, and Firefox (MV3).

---

## Tech Stack

| Layer        | Technologies |
|-------------|--------------|
| **Extension** | Vite 6, TypeScript 5, React 19, Tailwind CSS 4, DaisyUI, CRX plugin |
| **Backend**   | FastAPI, Pydantic, LangChain + Google Gemini, Valkey (Redis-compatible) |
| **Tooling**   | pnpm, ESLint, Prettier, Husky, commitlint |

---

## Prerequisites

- **Node.js** ≥ 20.x  
- **pnpm** ≥ 8.15.0 (enforced via `preinstall`)  
- **Python** 3.11+ (for backend)  
- **Valkey** or **Redis** (for cache and attribute store)  
- **Google Gemini API key** (for TOS/privacy extraction)

---

## Project Structure

```
.
├── src/                          # Chrome extension (Vite + React)
│   ├── manifest.ts               # MV3 manifest
│   ├── background/               # Service worker
│   ├── content/                  # Content script (overlay UI)
│   ├── popup/                    # Extension popup
│   ├── options/                  # Options page
│   └── assets/
├── backend/                      # FastAPI backend
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── tos_processor/    # Policy fetch + LLM extraction + cache
│   │   │   ├── overlay_summary/ # Top risks, retention, mitigations
│   │   │   ├── attribute_severity/
│   │   │   ├── fetch_page/
│   │   │   └── ...
│   │   ├── severity_store.py     # Attribute severity + per-site ZSET
│   │   └── db.py                 # Valkey client
│   ├── requirements.txt
│   └── .env.example
├── package.json
└── README.md
```

---

## Setup

### 1. Extension

```bash
git clone <repo-url>
cd chrome-ext-starter
pnpm install
```

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium       # for JS-rendered policy pages
cp .env.example .env
```

Edit `.env` and set at least:

- `GEMINI_API_KEY` — required for TOS/privacy extraction  
- `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_PASSWORD` — if Valkey/Redis is not on `localhost:6379`

### 3. Valkey / Redis

Ensure Valkey (or Redis) is running. The backend uses it for cache (policy analysis), per-site attribute ZSETs, and global severity config. See [How we use Valkey](#how-we-use-valkey) for the full data patterns and flow.

---

## Running

### Backend

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- API root: http://localhost:8000/api/  
- Health: http://localhost:8000/api/health  
- Swagger: http://localhost:8000/docs  
- ReDoc: http://localhost:8000/redoc  

### Extension (Chrome)

```bash
pnpm dev
```

Then:

1. Open `chrome://extensions/`  
2. Enable **Developer mode**  
3. Click **Load unpacked** and select the `dist` directory (or the dev output directory used by the CRX plugin)

### Extension (Firefox)

```bash
pnpm dev:firefox
```

Load the extension from `dist-firefox/` via `about:debugging` → **This Firefox** → **Load Temporary Add-on** → select `dist-firefox/manifest.json`.

### Production build

```bash
pnpm build           # Chrome → dist/
pnpm build:firefox   # Firefox → dist-firefox/
```

---

## Main API Endpoints

| Endpoint | Description |
|---------|-------------|
| `GET /api/health` | Health check |
| `GET /api/tos_processor/process?url=...` | Process policy URL(s). Returns 200 + cached analysis (with `overlay_summary` when cached), or 202 while processing. In-memory set avoids duplicate processing for the same domain(s). |
| `GET /api/overlay_summary/top_risks?domain=...` | Top-3 high-risk attributes (by section type), data retention explanation, and mitigations for the given domain. |
| `GET /api/tos_processor/cached?domain=...` | Return cached analyses for the given domain(s) only (no background processing). |

The extension’s background script calls the overlay summary (or embedded overlay from tos_processor) and builds the overlay insight (key concerns, retention summary, recommendations) for the content script.

---

## How we use Valkey

The backend uses a single shared Valkey (Redis-compatible) client. FastAPI’s lifespan in `main.py` calls `db_connect()` on startup and `db_close()` on shutdown, so every request uses the same connection.

### Data patterns

| Pattern | Key | Structure | TTL | Purpose |
|--------|-----|-----------|-----|--------|
| **A — HSET** | `config:attribute_severity` | Hash: field = attribute name, value = JSON `{color, sensitivity_level}` | None | Global severity config; O(1) field read/write, bulk via `HGETALL`. Seeded by `POST /api/attribute_severity/seed`. |
| **B — ZSET** | `tos:attrs:{domain}` | Sorted set: member = attribute name, score = sensitivity_level | None | Per-domain attributes ranked by sensitivity. `ZREVRANGE` returns highest-first; overlay summary filters to red and takes top 3 (by section type). Written by TOS processor after extraction. |
| **C — SET** | `tos:process:{domain(s)}` | Single string: JSON-serialized `PolicyAnalysis` | None (optional `ttl_seconds` in `set_json`) | Full cached policy analysis. Cache-or-compute: 202 + background job on miss, 200 + payload when ready. |
| **D — SET** | `session:{key}` | Plain string/bytes | Optional | Ephemeral session data via `set_session` / `get_session` in `db.py`. |

### How they link

1. **TOS processor** (background) fetches the privacy policy, runs Gemini extraction, then:
   - Writes the full analysis to **SET** `tos:process:{domain}`.
   - Collects attribute names from `data_collection`, then for each domain writes **ZSET** `tos:attrs:{domain}` with scores from the **HSET** `config:attribute_severity`.
2. **Overlay summary** endpoint:
   - Reads **ZSET** for the domain → sorted list of attributes (with colors from HSET).
   - Filters to red, deduplicates by section type, takes top 3.
   - Reads **SET** cache for that domain to fill evidence, explanation, retention, and mitigations.

So: **HSET** = reference table; **ZSET** = per-site ranking; **SET** = full analysis cache. No TTL means keys persist until explicitly deleted or server restarts without persistence.

### RDB persistence

Our Valkey is configured with save rules in `valkey.conf` (e.g. `save 3600 1`, `save 300 100`, `save 60 10000`), it periodically forks and writes the **entire dataset** to a `dump.rdb` file on disk. On restart, it loads `dump.rdb` back into memory—so the severity map, all cached analyses, and all per-domain ZSETs survive a restart. RDB is **all-or-nothing**: every key in memory is included in the snapshot; there is no way to persist only certain keys.

This matters because the permanent data (HSET, ZSET, SET caches) is expensive to rebuild (Gemini API calls). RDB ensures a Valkey restart doesn’t wipe them. Sessions, which are short-lived with TTL, would expire anyway; they are just included in the snapshot. If RDB were disabled (`save ""`), the app would still run (Python falls back to `DEFAULT_ATTRIBUTE_SEVERITY`), but every domain would need to be re-processed from scratch after a restart.

---

## Extension Scripts

| Command | Description |
|--------|-------------|
| `pnpm dev` | Dev build + watch (Chrome) |
| `pnpm dev:firefox` | Dev build + watch (Firefox) |
| `pnpm build` | Production build (Chrome) |
| `pnpm build:firefox` | Production build (Firefox) |
| `pnpm lint` | ESLint |
| `pnpm preview` | Vite preview (no extension packaging) |

---

## Browser Support

| Browser | Min version |
|--------|-------------|
| Chrome / Edge / Brave | 88+ |
| Firefox | 109+ |

---

## Contributing

Contributions are welcome. Please use conventional commits and ensure `pnpm lint` passes. Pre-commit runs ESLint and Prettier via lint-staged.
