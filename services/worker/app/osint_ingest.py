import asyncio
import json
import time
import feedparser
import httpx
from typing import Any

from .config import load_yaml
from .nats_bus import publish

def _is_json_source(url: str) -> bool:
    return url.lower().endswith(".json") or "products/alerts" in url.lower()

async def fetch_rss(name: str, url: str) -> list[dict]:
    parsed = feedparser.parse(url)
    items = []
    for e in parsed.entries[:25]:
        items.append({
            "title": getattr(e, "title", ""),
            "link": getattr(e, "link", ""),
            "published": getattr(e, "published", ""),
            "summary": getattr(e, "summary", "")[:8000],
        })
    return items

async def fetch_json(name: str, url: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        r = await client.get(url, headers={"User-Agent": "mission-grid-osint/0.1"})
        r.raise_for_status()
        data = r.json()
    # Normalize to list
    if isinstance(data, list):
        return data[:50]
    return [{"data": data}]

async def osint_loop(stop_event: asyncio.Event, config_path: str = "/app/configs/osint.yaml"):
    cfg = load_yaml(config_path)
    interval = int(cfg.get("poll_interval_seconds", 300))
    sources = cfg.get("sources", [])

    seen: set[str] = set()

    await publish("osint.start", "INFO", "worker", {"sources": len(sources), "interval": interval})

    while not stop_event.is_set():
        for s in sources:
            name = s.get("name", "osint")
            url = s.get("url")
            if not url:
                continue
            try:
                items = await (fetch_json(name, url) if _is_json_source(url) else fetch_rss(name, url))
                for item in items:
                    key = json.dumps([name, item.get("title"), item.get("link"), item.get("published")], sort_keys=True)
                    if key in seen:
                        continue
                    seen.add(key)
                    await publish("osint.item", "INFO", f"osint:{name}", {"source": name, "url": url, "item": item})
            except Exception as e:
                await publish("osint.error", "WARN", f"osint:{name}", {"url": url, "error": str(e)[:300]})

        # sleep
        for _ in range(max(1, interval)):
            if stop_event.is_set():
                break
            await asyncio.sleep(1)
