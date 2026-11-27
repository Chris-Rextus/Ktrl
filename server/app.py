"""Ktrl web server: FastAPI app connecting the browser to vehicle_sim.

Run from the repository root (venv active):
    python3 server/app.py                 # http://127.0.0.1:8000
    python3 server/app.py --host 0.0.0.0  # reachable from the local network

REST (JSON):
    GET  /api/health                 binary / config paths, process state
    GET  /api/config                 all sections as {key: {value, type, comment, choices}}
    POST /api/config/validate        {"changes": {...}} -> C++ check on a temp copy
    PUT  /api/config                 {"changes": {...}, "check": true} -> validate + save
    PUT  /api/runtime                {"v_set": 25, "pause": true, ...} -> [runtime] keys
    GET  /api/run                    process info + last status
    POST /api/run/start              {"fast": false}
    POST /api/run/stop
    POST /api/run/restart            running: bump restart_id; otherwise start
    POST /api/tests                  vehicle_sim --test-all
    POST /api/batch                  {"presets": ["S5", "S6"]} (empty = all)
    POST /api/analysis               {"kind": "min_gap", "args": {"v0": 30}, "use_runtime": true}
    GET  /api/batch                  list of batch files + summary text
    GET  /api/batch/{file}           one batch file parsed {meta, columns, rows}
    GET  /api/output                 current run (same as the WebSocket snapshot)
WebSocket /ws:
    first {"type": "snapshot", ...} and {"type": "console_history", ...},
    then "header" | "rows" | "status" | "console" | "error" messages.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import math
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from common import BATCH_DIR, BINARY, CONFIG, ROOT
from config_io import ConfigFile
from output_tail import OutputTail
from sim_process import SimError, SimManager

STATIC_DIR = Path(__file__).resolve().parent / "static"
WEB_DIST = ROOT / "web" / "dist"          # the real frontend, once built

# [runtime] keys the browser may set, and how to check their values
RUNTIME_KEYS: dict[str, str] = {
    "pause": "bool", "stop": "bool", "restart_id": "int",
    "realtime_factor": "number",
    "v_set": "number|scenario", "leader_accel": "number|scenario",
    "h": "number", "lambda": "number", "d0": "number", "d_set": "number",
    "spacing": "choice:time_gap|fixed",
    "k_p": "number", "k_i": "number", "k_d": "number", "beta": "number",
}

sim = SimManager()
tail = OutputTail()
config_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    tail.start()
    yield
    await sim.shutdown()                  # never leave a simulator running
    await tail.stop()


app = FastAPI(title="Ktrl", lifespan=lifespan)


# ------------------------------------------------------------------ helpers
@app.exception_handler(SimError)
async def _sim_error(_request, exc: SimError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


def _finite(x: float) -> float | None:
    return x if math.isfinite(x) else None


def _clean(msg: dict[str, Any]) -> dict[str, Any]:
    """JSON has no NaN/Infinity: replace them with null in row data."""
    if "rows" in msg:
        msg = {**msg, "rows": [[_finite(v) for v in r] for r in msg["rows"]]}
    return msg


def _check_runtime_value(key: str, value: Any) -> Any:
    kind = RUNTIME_KEYS.get(key)
    if kind is None:
        raise HTTPException(400, f"'{key}' is not a runtime key "
                                 f"(allowed: {', '.join(RUNTIME_KEYS)})")
    if value is None:
        return None                                    # remove the key
    if kind == "bool":
        if not isinstance(value, bool):
            raise HTTPException(400, f"runtime.{key} must be true or false")
        return value
    if kind == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise HTTPException(400, f"runtime.{key} must be an integer")
        return value
    if kind.startswith("choice:"):
        choices = kind[len("choice:"):].split("|")
        if value not in choices:
            raise HTTPException(400, f"runtime.{key} must be one of {', '.join(choices)}")
        return value
    if kind.endswith("|scenario") and value == "scenario":
        return value
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"runtime.{key} must be a number"
                                 + (" or 'scenario'" if "scenario" in kind else ""))
    if not math.isfinite(v):
        raise HTTPException(400, f"runtime.{key} must be finite")
    return v


def parse_output_file(path: Path) -> dict[str, Any]:
    """Read a whole output/batch file: {meta, columns, rows}."""
    meta: dict[str, str] = {}
    columns: list[str] = []
    rows: list[list[float | None]] = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith("#"):
                if " = " in line:
                    k, v = line[1:].split(" = ", 1)
                    meta[k.strip()] = v.strip()
                continue
            if not columns:
                columns = line.split()
                continue
            parts = line.split()
            if len(parts) == len(columns):
                rows.append([_finite(float(x)) for x in parts])
    return {"file": path.name, "meta": meta, "columns": columns, "rows": rows}


# ------------------------------------------------------------------ health
@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"root": str(ROOT), "binary": str(BINARY), "binary_exists": BINARY.exists(),
            "config": str(CONFIG), "running": sim.running, "clients": tail.bus.count}


# ------------------------------------------------------------------ config
class ConfigChanges(BaseModel):
    changes: dict[str, dict[str, Any]] = {}
    check: bool = True                       # validate with the C++ program before saving


@app.get("/api/config")
async def get_config() -> dict[str, Any]:
    cfg = ConfigFile.load(CONFIG)
    return {"path": str(CONFIG), "sections": cfg.to_dict()}


@app.post("/api/config/validate")
async def validate_config(body: ConfigChanges) -> dict[str, Any]:
    return (await sim.validate(body.changes)).to_dict()


@app.put("/api/config")
async def put_config(body: ConfigChanges) -> dict[str, Any]:
    if "runtime" in body.changes:
        raise HTTPException(400, "use PUT /api/runtime for [runtime] keys")
    async with config_lock:
        if body.check:
            res = await sim.validate(body.changes)
            if not res.ok:
                raise HTTPException(422, res.output.strip())
        cfg = ConfigFile.load(CONFIG)
        try:
            cfg.update(body.changes)
        except ValueError as e:
            raise HTTPException(400, str(e))
        cfg.save()
    tail.refresh_paths()
    note = ("saved; physics changes apply at the next start or restart"
            if sim.running else "saved")
    return {"message": note, "sections": cfg.to_dict()}


@app.put("/api/runtime")
async def put_runtime(values: dict[str, Any] = Body(...)) -> dict[str, Any]:
    changes = {k: _check_runtime_value(k, v) for k, v in values.items()}
    async with config_lock:
        cfg = ConfigFile.load(CONFIG)
        cfg.update({"runtime": changes})
        cfg.save()
    return {"runtime": cfg.to_dict().get("runtime", {})}


# ------------------------------------------------------------------ live run
class StartRequest(BaseModel):
    fast: bool = False


@app.get("/api/run")
async def run_info() -> dict[str, Any]:
    return {"process": sim.live.to_dict(), "status": tail.status}


@app.post("/api/run/start")
async def run_start(body: StartRequest = StartRequest()) -> dict[str, Any]:
    if sim.running:
        # A simulator is alive (running, paused, or waiting after the end or a
        # collision with on_finish = wait). Real time: restart it in place.
        # Fast: it needs a new process, so stop the old one first.
        if not body.fast:
            return await run_restart()
        await sim.stop()
    async with config_lock:
        # make sure a leftover 'pause = true' or 'stop = true' does not
        # freeze or end the new run
        cfg = ConfigFile.load(CONFIG)
        for key in ("pause", "stop"):
            if cfg.get("runtime", key) == "true":
                cfg.set("runtime", key, False)
        cfg.save()
    tail.refresh_paths()
    info = await sim.start(fast=body.fast)
    tail.reset()
    return info.to_dict()


@app.post("/api/run/stop")
async def run_stop() -> dict[str, Any]:
    if sim.running:
        return (await sim.stop()).to_dict()
    # Not started by this server (e.g. launched from a terminal): ask it to
    # stop through the config file. Every vehicle_sim reading this config
    # stops within 0.1 s. The next Start resets the flag.
    async with config_lock:
        cfg = ConfigFile.load(CONFIG)
        cfg.update({"runtime": {"stop": True}})
        cfg.save()
    return {**sim.live.to_dict(),
            "message": "no simulator started by this server; runtime.stop = true written "
                       "so any other vehicle_sim using this config stops"}


@app.post("/api/run/restart")
async def run_restart() -> dict[str, Any]:
    if not sim.running:
        return await run_start(StartRequest())
    async with config_lock:
        cfg = ConfigFile.load(CONFIG)
        rid = int(cfg.get("runtime", "restart_id", "0") or 0) + 1
        cfg.update({"runtime": {"restart_id": rid, "pause": False}})
        cfg.save()
    return {"message": f"restart requested (restart_id = {rid})"}


@app.get("/api/output")
async def output() -> dict[str, Any]:
    return _clean(tail.snapshot())


# ------------------------------------------------------------------ jobs
class BatchRequest(BaseModel):
    presets: list[str] = []


@app.post("/api/tests")
async def run_tests() -> dict[str, Any]:
    return (await sim.run_tests()).to_dict()


@app.post("/api/batch")
async def run_batch(body: BatchRequest = BatchRequest()) -> dict[str, Any]:
    res = (await sim.run_batch(body.presets)).to_dict()
    return {**res, **(await list_batch())}


@app.get("/api/batch")
async def list_batch() -> dict[str, Any]:
    files = sorted(p.name for p in BATCH_DIR.glob("*.txt") if p.name != "summary.txt") \
        if BATCH_DIR.exists() else []
    summary = BATCH_DIR / "summary.txt"
    return {"files": files, "summary": summary.read_text() if summary.exists() else ""}


@app.get("/api/batch/{name}")
async def get_batch_file(name: str) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9_\-]+\.txt", name):
        raise HTTPException(400, "bad file name")
    path = BATCH_DIR / name
    if not path.exists():
        raise HTTPException(404, f"{name} not found - run a batch first")
    return parse_output_file(path)


# ------------------------------------------------------------------ analysis
ANALYSES = ("plant", "steps", "bode", "min_gap", "sweep")
# [runtime] keys that map onto saved sections (live overrides)
RUNTIME_TO_SECTION = {"k_p": "controller", "k_i": "controller", "k_d": "controller", "h": "controller",
                      "lambda": "controller", "d0": "controller", "d_set": "controller",
                      "spacing": "controller", "beta": "environment"}


class AnalysisRequest(BaseModel):
    kind: str
    args: dict[str, Any] = {}
    use_runtime: bool = False               # apply the live overrides of [runtime]
    changes: dict[str, dict[str, Any]] = {}  # extra config changes (not saved)


@app.post("/api/analysis")
async def run_analysis(body: AnalysisRequest) -> dict[str, Any]:
    if body.kind not in ANALYSES:
        raise HTTPException(400, f"unknown analysis '{body.kind}' ({', '.join(ANALYSES)})")
    args: dict[str, str] = {}
    for k, v in body.args.items():
        sv = str(v)
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k) or not re.fullmatch(r"[A-Za-z0-9_.+\-]*", sv):
            raise HTTPException(400, f"bad argument {k}={sv!r}")
        args[k] = sv
    changes = {s: dict(kv) for s, kv in body.changes.items()}
    if body.use_runtime:
        rt = ConfigFile.load(CONFIG).to_dict().get("runtime", {})
        for k, entry in rt.items():
            sec = RUNTIME_TO_SECTION.get(k)
            if sec and entry.get("value") not in (None, "", "scenario"):
                changes.setdefault(sec, {})[k] = entry["value"]
    res = await sim.analyze(body.kind, args, changes)
    line = next((ln for ln in reversed(res.output.splitlines()) if ln.startswith("{")), "")
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        raise HTTPException(500, f"analysis output not understood:\n{res.output[-2000:]}")
    if "error" in data:
        raise HTTPException(422, data["error"])
    data["applied_changes"] = changes
    data["wall_seconds"] = res.seconds
    return data


# ------------------------------------------------------------------ WebSocket
@app.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    await websocket.accept()
    q_data = tail.bus.subscribe()
    q_console = sim.console.subscribe()

    async def send(msg: dict[str, Any]) -> None:
        await websocket.send_text(json.dumps(_clean(msg), separators=(",", ":")))

    async def pump(q: asyncio.Queue, kind: str | None) -> None:
        while True:
            m = await q.get()
            await send({"type": kind, **m} if kind else m)

    async def drain_incoming() -> None:          # ends when the browser disconnects
        while True:
            await websocket.receive_text()

    tasks: list[asyncio.Task] = []
    try:
        await send(tail.snapshot())
        await send({"type": "console_history", "lines": list(sim.live.log)})
        tasks = [asyncio.create_task(pump(q_data, None)),
                 asyncio.create_task(pump(q_console, "console")),
                 asyncio.create_task(drain_incoming())]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, Exception):
                await t
        tail.bus.unsubscribe(q_data)
        sim.console.unsubscribe(q_console)


# ------------------------------------------------------------------ static files
# The built frontend (web/dist) when it exists, otherwise the test page.
app.mount("/", StaticFiles(directory=WEB_DIST if WEB_DIST.exists() else STATIC_DIR,
                           html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    ap = argparse.ArgumentParser(description="Ktrl web server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    print(f"Ktrl server on http://{args.host}:{args.port}  (simulator: {BINARY})")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
