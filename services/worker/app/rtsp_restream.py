import asyncio
import shlex
from dataclasses import dataclass

from .nats_bus import publish
from .settings import settings

@dataclass
class RestreamProc:
    name: str
    src: str
    proc: asyncio.subprocess.Process

async def start_restream(name: str, src_rtsp: str) -> RestreamProc:
    # Pull from src, publish to MediaMTX as RTSP.
    # Uses stream copy when possible; if codec mismatch you can change to transcode.
    dst = f"{settings.mediamtx_rtsp_base}/{name}"
    cmd = f"ffmpeg -rtsp_transport tcp -stimeout 5000000 -i {shlex.quote(src_rtsp)} -c copy -f rtsp {shlex.quote(dst)}"
    proc = await asyncio.create_subprocess_shell(
        cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await publish("rtsp.restream.start", "INFO", "worker", {"name": name, "dst": dst})
    return RestreamProc(name=name, src=src_rtsp, proc=proc)

async def stop_restream(rp: RestreamProc):
    try:
        rp.proc.terminate()
        await asyncio.wait_for(rp.proc.wait(), timeout=5)
    except Exception:
        try:
            rp.proc.kill()
        except Exception:
            pass
    await publish("rtsp.restream.stop", "INFO", "worker", {"name": rp.name})
