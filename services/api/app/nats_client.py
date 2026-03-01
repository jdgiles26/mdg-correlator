import asyncio
from nats.aio.client import Client as NATS
from .settings import settings

_nc: NATS | None = None
_lock = asyncio.Lock()

async def get_nats() -> NATS:
    global _nc
    async with _lock:
        if _nc and _nc.is_connected:
            return _nc
        _nc = NATS()
        await _nc.connect(servers=[settings.nats_url])
        return _nc
