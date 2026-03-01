import asyncio
import json
from nats.aio.client import Client as NATS
from .settings import settings

EVENT_SUBJECT = "mission.events"

_nc: NATS | None = None
_lock = asyncio.Lock()

async def nc() -> NATS:
    global _nc
    async with _lock:
        if _nc and _nc.is_connected:
            return _nc
        _nc = NATS()
        await _nc.connect(servers=[settings.nats_url])
        return _nc

async def publish(topic: str, severity: str, source: str, payload: dict, score: float | None = None):
    c = await nc()
    msg = {"topic": topic, "severity": severity, "source": source, "payload": payload, "score": score}
    await c.publish(EVENT_SUBJECT, json.dumps(msg).encode("utf-8"))
