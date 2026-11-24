"""Paths and small shared helpers for the Ktrl server.

Paths default to the repository layout (this file lives in <root>/server/)
and can be overridden with environment variables:
    KTRL_ROOT    repository root (working directory of vehicle_sim)
    KTRL_BIN     simulator executable
    KTRL_CONFIG  configuration file
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("KTRL_ROOT", Path(__file__).resolve().parent.parent)).resolve()
BINARY = Path(os.environ.get("KTRL_BIN", ROOT / "cpp" / "build" / "vehicle_sim")).resolve()
CONFIG = Path(os.environ.get("KTRL_CONFIG", ROOT / "sim_config.txt")).resolve()
BATCH_DIR = ROOT / "batch"


def resolve(path: str | Path) -> Path:
    """Paths inside the config (output.file, ...) are relative to ROOT,
    because vehicle_sim runs with ROOT as its working directory."""
    p = Path(path)
    return p if p.is_absolute() else ROOT / p


class Broadcast:
    """Fan-out of messages to any number of async subscribers (WebSocket
    clients). A slow subscriber loses its oldest messages instead of
    blocking the producer."""

    def __init__(self, maxsize: int = 1000) -> None:
        self._subs: set[asyncio.Queue[Any]] = set()
        self._maxsize = maxsize

    def subscribe(self) -> asyncio.Queue[Any]:
        q: asyncio.Queue[Any] = asyncio.Queue(self._maxsize)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[Any]) -> None:
        self._subs.discard(q)

    def publish(self, msg: Any) -> None:
        for q in list(self._subs):
            if q.full():
                try:
                    q.get_nowait()          # drop the oldest
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(msg)

    @property
    def count(self) -> int:
        return len(self._subs)