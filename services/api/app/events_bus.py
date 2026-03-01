import asyncio
import json
from typing import AsyncIterator

from .nats_client import get_nats

EVENT_SUBJECT = "mission.events"

async def publish_event(topic: str, severity: str, source: str, payload: dict, score: float | None = None):
    nc = await get_nats()
    msg = {
        "topic": topic,
        "severity": severity,
        "source": source,
        "payload": payload,
        "score": score,
    }
    await nc.publish(EVENT_SUBJECT, json.dumps(msg).encode("utf-8"))

async def subscribe_events() -> AsyncIterator[dict]:
    nc = await get_nats()
    sub = await nc.subscribe(EVENT_SUBJECT)
    try:
        while True:
            msg = await sub.next_msg(timeout=60)
            yield json.loads(msg.data.decode("utf-8"))
    except asyncio.TimeoutError:
        return
