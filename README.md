# Federated Mission Data Grid (Open Source MVP)

A **working, runnable** open-source MVP for a federated “mission data grid” style system:
- **RTSP/RTMP ingestion** (your own permitted streams) via **MediaMTX** (restreams to **HLS/WebRTC**).
- **AI/ML video inference** (frame sampling + object detection) and **predictive/anomaly** scoring over event rates.
- **OSINT ingestion** via **public RSS feeds** (configurable; no brittle/illegal scraping).
- **Uploads ingestion** for documents/video/audio + **URL ingestion** (fetch & store with basic text extraction).
- **Live events** over WebSocket to a React dashboard.
- Storage: **Postgres + pgvector** (metadata + vectors) + **MinIO** (objects).
- Messaging: **NATS** for event streams (data-in-motion).

## Important safety + legality notes
This repo is designed for **legitimate monitoring and situational awareness** and assumes you only ingest:
- feeds you **own**, or
- feeds you have **explicit permission** to access, or
- feeds that are **explicitly published for public redistribution**.

<img width="900" height="600" alt="image" src="https://github.com/user-attachments/assets/a7b7d5ae-14c9-4b9d-ab2b-80c99cb490ea" />

- many feeds are not meant for bulk aggregation,
- access and redistribution often has terms-of-service or legal constraints,
- some could materially enable wrongdoing.

Instead, you get a **plugin-based ingestion framework** and sample **public RSS sources**. You can add **approved feed URLs** in `configs/feeds.yaml`.

## Quick start (Docker)
Prereqs: Docker + Docker Compose.

```bash
cd repo
cp .env.example .env
docker compose up -d --build
```

Then open:
- UI: http://localhost:5173
- API: http://localhost:8080/docs
- MediaMTX:
  - RTMP publish: `rtmp://localhost:1935/<app>/<streamKey>`
  - RTSP: `rtsp://localhost:8554/<stream>`
  - HLS: `http://localhost:8888/<stream>/index.m3u8`
- MinIO: http://localhost:9001 (user/pass from `.env`)

## Compose-first workflow
This project is expected to be developed and verified with Docker Compose, not ad-hoc local service starts.

Primary workflow:
```bash
docker compose up -d --build
docker compose ps
docker compose logs -f api worker ui
```

When you change code, rebuild the same way:
```bash
docker compose up -d --build
```

## Feed source rules
- The **Feeds** tab is for direct media sources only: `rtsp://`, `rtsps://`, `rtmp://`, `rtmps://`, `srt://`, `udp://`, `tcp://`, or direct media URLs such as HLS `.m3u8`.
- Browser pages, livestream landing pages, and embedded players belong in **Multigrid**, not the background feed registry.
- The dashboard system status card and feed cards now surface the latest connection issue and hint when a feed is misconfigured.

## Add an RTSP feed
In the UI: **Feeds → Add feed** with your RTSP URL.
Or via API:
```bash
curl -X POST http://localhost:8080/api/feeds   -H "Content-Type: application/json"   -d '{"name":"mycam","rtsp_url":"rtsp://user:pass@camera.example/stream"}'
```

MediaMTX will restream it as:
- RTSP: `rtsp://localhost:8554/mycam`
- HLS:  `http://localhost:8888/mycam/index.m3u8`

## DJI drone RTMP live stream
Use the UI tab **DJI Live** to generate stream settings and preview playback.

Example:
- DJI Server URL: `rtmp://localhost:1935/dji`
- DJI Stream Key: `my-drone-01`
- Full publish URL (if your app asks for one field): `rtmp://localhost:1935/dji/my-drone-01`
- Playback URL: `http://localhost:8888/dji/my-drone-01/index.m3u8`

In the DJI app (Custom RTMP), set:
1. Server URL = generated DJI Server URL
2. Stream key = generated DJI Stream Key
3. Start live stream, then open the built-in player preview in the same tab.

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
  - `nats`, `postgres` (with `pgvector`), `minio`
  - `ui` (React)
- `services/api` backend
- `services/worker` background workers
- `services/ui` frontend

## Known limitations (MVP)
- Video inference uses CPU and samples frames (default 1 FPS). Increase at your own risk.
- Object detection uses **Ultralytics YOLOv8n** weights downloaded at first run.
- URL ingestion is conservative (HTML text extraction). No bypassing paywalls/auth.
- Vector embedding is optional, stored directly in Postgres via `pgvector`, and can be disabled.

## License
Apache-2.0 (see `LICENSE`).
