"""Follow sim_output.txt and its status file while vehicle_sim writes them.

Publishes three kinds of messages through a Broadcast:
    {"type": "header", "run_id", "meta": {...}, "columns": [...]}
    {"type": "rows",   "run_id", "rows": [[t, ...], ...]}      (batched per poll)
    {"type": "status", ...fields of sim_output_status.txt...}

A new run is detected when the status file shows another run_id, or when the
output file is replaced or truncated (restart). The header is then read
again. Only complete lines are parsed (the simulator may be mid-write).

The whole current run is kept in memory, so a browser that connects late
gets the history first (snapshot()).
"""

from __future__ import annotations

import asyncio
import contextlib
import os
from pathlib import Path
from typing import Any

from common import CONFIG, Broadcast, resolve
from config_io import ConfigFile


def output_paths(config: Path = CONFIG) -> tuple[Path, Path]:
    """(output file, status file) as vehicle_sim names them."""
    out = resolve(ConfigFile.load(config).get("output", "file", "sim_output.txt") or "")
    return out, out.with_name(out.stem + "_status.txt")


def parse_status(text: str) -> dict[str, Any]:
    st: dict[str, Any] = {}
    for line in text.splitlines():
        if " = " not in line:
            continue
        k, v = line.split(" = ", 1)
        try:
            st[k] = int(v) if k in ("run_id", "lines") else float(v) if k in (
                "t", "duration", "realtime_factor", "lag") else v
        except ValueError:
            st[k] = v
    return st

# Rows kept in memory for late-joining browsers. 30000 rows = 10 min at 50 Hz;
# older rows of an endless run are dropped here (the file keeps everything).
MAX_ROWS = 30000

class OutputTail:
    def __init__(self, poll: float = 0.02) -> None:
        self.poll = poll
        self.bus = Broadcast(maxsize=2000)
        self.status: dict[str, Any] = {}
        self.meta: dict[str, str] = {}
        self.columns: list[str] = []
        self.rows: list[list[float]] = []
        self.run_id: int | None = None

        self._out_path, self._status_path = output_paths()
        self._f = None                       # open output file
        self._ino: int | None = None
        self._pos = 0
        self._partial = b""
        self._status_mtime: float | None = None
        self._task: asyncio.Task[None] | None = None

    # ------------------------------------------------------------ public
    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        self._close()

    def reset(self) -> None:
        """Re-read the output from the top. Call right after starting a new
        simulator process: it truncates the file and can, in --fast mode,
        write more than the old size before the next poll, which would hide
        the truncation."""
        self._close()
        self._status_mtime = None
        self.run_id = None

    def refresh_paths(self) -> None:
        """Call after output.file may have changed in the config."""
        out, status = output_paths()
        if (out, status) != (self._out_path, self._status_path):
            self._out_path, self._status_path = out, status
            self._close()
            self._status_mtime = None

    def snapshot(self) -> dict[str, Any]:
        """Everything a newly connected client needs."""
        return {"type": "snapshot", "run_id": self.run_id, "meta": self.meta,
                "columns": self.columns, "rows": self.rows, "status": self.status}

    # ------------------------------------------------------------ loop
    async def _loop(self) -> None:
        while True:
            try:
                self._check_status()
                self._read_output()
            except Exception as e:                       # keep tailing whatever happens
                self.bus.publish({"type": "error", "message": f"tail: {e!r}"})
            await asyncio.sleep(self.poll)

    def _check_status(self) -> None:
        try:
            mt = self._status_path.stat().st_mtime
        except FileNotFoundError:
            return
        if mt == self._status_mtime:
            return
        try:
            st = parse_status(self._status_path.read_text())
        except FileNotFoundError:
            return
        self._status_mtime = mt
        if st.get("run_id") is not None and self.run_id is not None and st["run_id"] != self.run_id:
            self._close()                                # new run: re-read from the top
        self.status = st
        self.bus.publish({"type": "status", **st})

    def _read_output(self) -> None:
        if self._f is None and not self._open():
            return
        assert self._f is not None
        try:
            st = os.stat(self._out_path)
        except FileNotFoundError:
            self._close()
            return
        if st.st_ino != self._ino or st.st_size < self._pos:
            self._close()                                # replaced or truncated
            if not self._open():
                return

        chunk = self._f.read()
        if not chunk:
            return
        self._pos += len(chunk)
        data = self._partial + chunk
        lines = data.split(b"\n")
        self._partial = lines.pop()                      # incomplete last line (or b"")

        new_rows: list[list[float]] = []
        for raw in lines:
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            if line.startswith("#"):
                if " = " in line:
                    k, v = line[1:].split(" = ", 1)
                    self.meta[k.strip()] = v.strip()
                continue
            if not self.columns:
                self.columns = line.split()
                if "run_id" in self.meta:
                    self.run_id = int(self.meta["run_id"])
                self.bus.publish({"type": "header", "run_id": self.run_id,
                                  "meta": self.meta, "columns": self.columns})
                continue
            parts = line.split()
            if len(parts) != len(self.columns):
                continue                                 # corrupt line: skip
            try:
                new_rows.append([float(x) for x in parts])
            except ValueError:
                continue
        if new_rows:
            self.rows.extend(new_rows)
            if len(self.rows) > MAX_ROWS * 1.1:              # trim in chunks, not per row
                del self.rows[: len(self.rows) - MAX_ROWS]
            self.bus.publish({"type": "rows", "run_id": self.run_id, "rows": new_rows})

    def _open(self) -> bool:
        try:
            self._f = open(self._out_path, "rb")
            self._ino = os.fstat(self._f.fileno()).st_ino
        except FileNotFoundError:
            self._f = None
            return False
        self._pos = 0
        self._partial = b""
        self.meta, self.columns, self.rows = {}, [], []
        return True

    def _close(self) -> None:
        if self._f:
            self._f.close()
        self._f = None
        self._ino = None


# -------------------------------------------------------------------- self-test
if __name__ == "__main__":
    from sim_process import SimManager

    async def main() -> None:
        sim = SimManager()
        tail = OutputTail()
        q = tail.bus.subscribe()
        tail.start()

        print("-- live run in real time, 2 s")
        await sim.start()
        tail.reset()
        await asyncio.sleep(2.0)

        print("-- restart via runtime.restart_id")
        cfg = ConfigFile.load(CONFIG)
        old_id = int(cfg.get("runtime", "restart_id", "0") or 0)
        cfg.set("runtime", "restart_id", old_id + 1)
        cfg.save()
        await asyncio.sleep(1.5)
        await sim.stop()
        await asyncio.sleep(0.2)

        print("-- fast run (60 s simulated in a fraction of a second)")
        await sim.start(fast=True)
        tail.reset()
        while sim.running:
            await asyncio.sleep(0.05)
        await asyncio.sleep(0.2)

        cfg.set("runtime", "restart_id", old_id)          # put the file back
        cfg.save()
        await tail.stop()

        counts: dict[int, dict[str, int]] = {}
        headers = []
        seq = 0                                           # a header starts a new run
        last_status = {}
        while not q.empty():
            m = q.get_nowait()
            if m["type"] == "header":
                seq += 1
                headers.append((m["run_id"], len(m["columns"]), m["columns"][:4]))
            elif m["type"] == "rows":
                c = counts.setdefault(seq, {"msgs": 0, "rows": 0})
                c["msgs"] += 1
                c["rows"] += len(m["rows"])
            elif m["type"] == "status":
                last_status = m
            elif m["type"] == "error":
                print("  ERROR", m["message"])
        for i, h in enumerate(headers, 1):
            c = counts.get(i, {"rows": 0, "msgs": 0})
            print(f"  header #{i}: run_id={h[0]}, {h[1]} columns -> "
                  f"{c['rows']} rows in {c['msgs']} messages")
        print(f"  last status: state={last_status.get('state')}, run_id={last_status.get('run_id')}, "
              f"t={last_status.get('t')}")
        snap = tail.snapshot()
        print(f"  snapshot: run {snap['run_id']}, {len(snap['rows'])} rows, "
              f"last t = {snap['rows'][-1][0] if snap['rows'] else None}")

    asyncio.run(main())