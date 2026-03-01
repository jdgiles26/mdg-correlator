# Federated Mission Data Grid (Open Source MVP)

A **working, runnable** open-source MVP for a federated “mission data grid” style system:
- **RTSP ingestion** (your own permitted RTSP URLs) via **MediaMTX** (restreams to **HLS/WebRTC**).
- **AI/ML video inference** (frame sampling + object detection) and **predictive/anomaly** scoring over event rates.
- **OSINT ingestion** via **public RSS feeds** (configurable; no brittle/illegal scraping).
- **Uploads ingestion** for documents/video/audio + **URL ingestion** (fetch & store with basic text extraction).
- **Live events** over WebSocket to a React dashboard.
- Storage: **Postgres** (metadata) + **MinIO** (objects) + optional **Qdrant** (vectors).
- Messaging: **NATS** for event streams (data-in-motion).

## Important safety + legality notes
This repo is designed for **legitimate monitoring and situational awareness** and assumes you only ingest:
- feeds you **own**, or
- feeds you have **explicit permission** to access, or
- feeds that are **explicitly published for public redistribution**.

I did **not** implement “grab all government cameras / military feeds” automation, because:
- many feeds are not meant for bulk aggregation,
- access and redistribution often has terms-of-service or legal constraints,
- some could materially enable wrongdoing.

Instead, you get a **plugin-based ingestion framework** and sample **public RSS sources**. You can add **approved feed URLs** in `configs/feeds.yaml`.

## Quick start (Docker)
Prereqs: Docker + Docker Compose.

```bash
cd repo
cp .env.example .env
docker compose up --build
```

Then open:
- UI: http://localhost:5173
- API: http://localhost:8080/docs
- MediaMTX: RTSP `rtsp://localhost:8554/<stream>` and HLS `http://localhost:8888/<stream>/index.m3u8`
- MinIO: http://localhost:9001 (user/pass from `.env`)

## Add an RTSP feed
In the UI: **Feeds → Add feed** with your RTSP URL.
Or via API:
```bash
curl -X POST http://localhost:8080/api/feeds   -H "Content-Type: application/json"   -d '{"name":"mycam","rtsp_url":"rtsp://user:pass@camera.example/stream"}'
```

MediaMTX will restream it as:
- RTSP: `rtsp://localhost:8554/mycam`
- HLS:  `http://localhost:8888/mycam/index.m3u8`

## Upload docs/audio/video + URL
- Use UI **Ingest → Upload** or
- API `POST /api/ingest/upload` or `POST /api/ingest/url`

Objects are stored in MinIO, metadata in Postgres.

## OSINT sources
Configured in `configs/osint.yaml` as RSS URLs. These are examples; swap/add your own.
The OSINT ingest service periodically pulls, normalizes, and emits events.

## Repo structure
- `docker-compose.yml` brings up:
  - `api` (FastAPI) + `worker` (ingest/inference jobs)
  - `mediamtx` (RTSP→HLS/WebRTC restream)
  - `nats`, `postgres`, `minio`, `qdrant` (optional)
  - `ui` (React)
- `services/api` backend
- `services/worker` background workers
- `services/ui` frontend

## Known limitations (MVP)
- Video inference uses CPU and samples frames (default 1 FPS). Increase at your own risk.
- Object detection uses **Ultralytics YOLOv8n** weights downloaded at first run.
- URL ingestion is conservative (HTML text extraction). No bypassing paywalls/auth.
- Vector embedding is optional and uses a small local model; can be disabled.

## License
Apache-2.0 (see `LICENSE`).
