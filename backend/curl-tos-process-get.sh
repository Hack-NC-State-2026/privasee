#!/usr/bin/env sh
# GET /api/tos_processor/process
# Pass one or more policy URLs; returns 200 with cached analysis + overlay_summary on cache hit, or 202 while processing.

curl -s -X GET 'http://localhost:8000/api/tos_processor/process?url=https%3A%2F%2Fpolicies.google.com%2Fprivacy' | jq .
