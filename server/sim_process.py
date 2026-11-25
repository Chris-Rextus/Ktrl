"""Start, stop and query the C++ simulator (vehicle_sim).

Two kinds of processes:
  - the LIVE run (at most one): `vehicle_sim sim_config.txt [--fast]`, long
    lived, streams to sim_output.txt; stopped with SIGTERM (the simulator
    then writes state = stopped in its status file and exits cleanly);
  - JOBS (one at a time): short commands whose console text is returned:
    --test-all, --batch [S..], --print (config validation).

Everything is asyncio so the FastAPI app can await it without blocking.
"""

from __future__ import annotations

import asyncio
import collections
import contextlib
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from common import BINARY, CONFIG, ROOT, Broadcast
from config_io import ConfigFile


class SimError(RuntimeError):
    """Error meant to be shown to the user as is."""


def _check_binary() -> None:
    if not BINARY.exists():
        raise SimError(f"simulator not found at {BINARY} - build it with "
                       f"'cmake -S cpp -B cpp/build && cmake --build cpp/build'")
    if not os.access(BINARY, os.X_OK):
        raise SimError(f"{BINARY} is not executable")


@dataclass
class JobResult:
    command: list[str]
    returncode: int
    output: str               # stdout + stderr, in order of arrival
    seconds: float

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    def to_dict(self) -> dict[str, Any]:
        return {"command": " ".join(self.command), "returncode": self.returncode,
                "ok": self.ok, "output": self.output, "seconds": round(self.seconds, 3)}


@dataclass
class LiveInfo:
    state: str = "idle"                    # idle | running | exited
    pid: int | None = None
    returncode: int | None = None
    started_at: float | None = None
    fast: bool = False
    log: collections.deque[str] = field(default_factory=lambda: collections.deque(maxlen=500))

    def to_dict(self) -> dict[str, Any]:
        return {"state": self.state, "pid": self.pid, "returncode": self.returncode,
                "started_at": self.started_at, "fast": self.fast, "log": list(self.log)}


class SimManager:
    def __init__(self) -> None:
        self.live = LiveInfo()
        self.console = Broadcast()           # {"source": ..., "line": ...} for the browser
        self._proc: asyncio.subprocess.Process | None = None
        self._reader: asyncio.Task[None] | None = None
        self._job_lock = asyncio.Lock()

    # ================================================================ live run
    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.returncode is None

    async def start(self, fast: bool = False) -> LiveInfo:
        _check_binary()
        if self.running:
            raise SimError("a simulation is already running - stop it first")
        args = [str(BINARY), str(CONFIG)] + (["--fast"] if fast else [])
        self._proc = await asyncio.create_subprocess_exec(
            *args, cwd=ROOT,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        self.live = LiveInfo(state="running", pid=self._proc.pid,
                             started_at=time.time(), fast=fast)
        self._emit("server", f"started: {' '.join(args)} (pid {self._proc.pid})")
        self._reader = asyncio.create_task(self._read_live(self._proc))
        return self.live

    async def stop(self, timeout: float = 3.0) -> LiveInfo:
        proc = self._proc
        if proc is None or proc.returncode is not None:
            return self.live
        proc.terminate()                                    # SIGTERM -> clean stop
        try:
            await asyncio.wait_for(proc.wait(), timeout)
        except asyncio.TimeoutError:
            self._emit("server", "simulator did not stop in time - killing it")
            proc.kill()
            await proc.wait()
        if self._reader:
            await self._reader
        return self.live

    async def _read_live(self, proc: asyncio.subprocess.Process) -> None:
        assert proc.stdout is not None
        async for raw in proc.stdout:
            self._emit("sim", raw.decode(errors="replace").rstrip())
        code = await proc.wait()
        self.live.state = "exited"
        self.live.returncode = code
        self.live.pid = None
        self._emit("server", f"simulator exited with code {code}")

    def _emit(self, source: str, line: str) -> None:
        self.live.log.append(f"[{source}] {line}")
        self.console.publish({"source": source, "line": line, "t": time.time()})

    # ================================================================ jobs
    async def run_job(self, args: list[str], timeout: float = 120.0) -> JobResult:
        """Run `vehicle_sim <args>` to completion and return its console text."""
        _check_binary()
        cmd = [str(BINARY)] + args
        async with self._job_lock:
            t0 = time.perf_counter()
            proc = await asyncio.create_subprocess_exec(
                *cmd, cwd=ROOT,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            try:
                out, _ = await asyncio.wait_for(proc.communicate(), timeout)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                raise SimError(f"'{' '.join(args)}' took longer than {timeout:.0f} s")
            return JobResult(cmd, proc.returncode or 0,
                             out.decode(errors="replace"), time.perf_counter() - t0)

    async def run_tests(self) -> JobResult:
        return await self.run_job([str(CONFIG), "--test-all"])

    async def run_batch(self, presets: list[str] | None = None) -> JobResult:
        presets = presets or []
        for p in presets:
            if p not in ("T0", "S1", "S2", "S3", "S4", "S5", "S6"):
                raise SimError(f"unknown scenario {p!r}")
        return await self.run_job([str(CONFIG), "--batch", *presets], timeout=600)

    async def validate(self, changes: dict[str, dict[str, Any]] | None = None) -> JobResult:
        """Apply `changes` to a temporary copy of the config and let the C++
        program check it (--print). The real config is not touched."""
        cfg = ConfigFile.load(CONFIG)
        try:
            cfg.update(changes or {})
        except ValueError as e:
            return JobResult(["validate"], 1, f"error: {e}\n", 0.0)
        tmp = ROOT / ".tmp_validate.txt"
        cfg.save(tmp)
        try:
            return await self.run_job([str(tmp), "--print"], timeout=10)
        finally:
            with contextlib.suppress(FileNotFoundError):
                tmp.unlink()

    async def analyze(self, kind: str, args: dict[str, Any],
                      changes: dict[str, dict[str, Any]] | None = None) -> JobResult:
        """Run `vehicle_sim <tmp config> --analyze <kind> key=value ...` on a
        temporary copy of the config with `changes` applied."""
        cfg = ConfigFile.load(CONFIG)
        try:
            cfg.update(changes or {})
        except ValueError as e:
            return JobResult(["analyze"], 1, f'{{"error": "{e}"}}\n', 0.0)
        tmp = ROOT / f".tmp_analysis_{os.getpid()}_{time.monotonic_ns()}.txt"
        cfg.save(tmp)
        try:
            argv = [str(tmp), "--analyze", kind] + [f"{k}={v}" for k, v in args.items()]
            return await self.run_job(argv, timeout=900)
        finally:
            with contextlib.suppress(FileNotFoundError):
                tmp.unlink()

    # ================================================================ shutdown
    async def shutdown(self) -> None:
        await self.stop()


# -------------------------------------------------------------------- self-test
if __name__ == "__main__":
    from common import resolve

    async def main() -> None:
        sim = SimManager()
        q = sim.console.subscribe()

        print("-- validate: good change")
        r = await sim.validate({"scenario": {"preset": "S5"}})
        print("  ok =", r.ok, "|", r.output.strip().splitlines()[-1])

        print("-- validate: bad change")
        r = await sim.validate({"simulation": {"dt_ice": 0.0007}})
        print("  ok =", r.ok, "|", r.output.strip().splitlines()[-1][:100])

        print("-- tests")
        r = await sim.run_tests()
        summary = [ln for ln in r.output.splitlines() if ln.startswith("== ") and "test" in ln]
        print(f"  ok = {r.ok} in {r.seconds:.2f} s |", "; ".join(summary))

        print("-- batch S5 S6")
        r = await sim.run_batch(["S5", "S6"])
        print(f"  ok = {r.ok} |", [ln for ln in r.output.splitlines() if ln.startswith("==")])

        print("-- live run (real time) for 1.5 s, then stop")
        await sim.start()
        await asyncio.sleep(1.5)
        cfg = ConfigFile.load(CONFIG)
        out = resolve(cfg.get("output", "file", "sim_output.txt"))
        status = out.with_name(out.stem + "_status.txt")
        print("  status while running:", dict(
            ln.split(" = ", 1) for ln in status.read_text().splitlines())["t"], "s simulated")
        info = await sim.stop()
        st = dict(ln.split(" = ", 1) for ln in status.read_text().splitlines())
        print(f"  after stop: process {info.state} (code {info.returncode}), "
              f"status file state = {st['state']}")

        print("-- console lines received by a subscriber:")
        while not q.empty():
            m = q.get_nowait()
            print(f"  [{m['source']}] {m['line']}")

        try:
            await sim.run_batch(["S9"])
        except SimError as e:
            print("-- bad batch request rejected:", e)

    asyncio.run(main())