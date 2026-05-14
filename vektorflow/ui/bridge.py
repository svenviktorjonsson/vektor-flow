"""HTTP bridge to the vf-overlay user event queue (``/api/enqueue`` / ``/api/pop``)."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Protocol
from pathlib import Path
from typing import Any


def _read_port_file(path: Path) -> int | None:
    try:
        t = path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    m = re.match(r"^(\d{2,5})\s*$", t)
    if not m:
        return None
    n = int(m.group(1), 10)
    if 1 <= n <= 65535:
        return n
    return None


def _port_file_candidates() -> list[Path]:
    from vektorflow.ui.launch import find_vektorflow_repo_root, find_vf_overlay_exe

    out: list[Path] = []
    root = find_vektorflow_repo_root()
    if root is not None:
        out.append(root / "web" / "vf-ui" / "vf-api-port.txt")
        exe = find_vf_overlay_exe(root)
        if exe is not None:
            out.append(exe.parent / "web" / "vf-api-port.txt")
    return out


_cached_base: str | None = None


class _BridgeTimerHost(Protocol):
    """Host callbacks used by bridge polling."""

    def monotonic(self) -> float: ...

    def sleep(self, seconds: float) -> None: ...


class _PythonBridgeTimerHost:
    """Default host adapter backed by Python ``time``."""

    def monotonic(self) -> float:
        import time

        return time.monotonic()

    def sleep(self, seconds: float) -> None:
        import time

        time.sleep(float(seconds))


def _normalize_bridge_timer_host(host: _BridgeTimerHost) -> _BridgeTimerHost:
    for name in ("monotonic", "sleep"):
        if not callable(getattr(host, name, None)):
            raise TypeError(
                "bridge timer host must define monotonic() and sleep(seconds)"
            )
    return host


_timer_host: _BridgeTimerHost = _PythonBridgeTimerHost()


def set_bridge_timer_host(host: _BridgeTimerHost) -> None:
    """Install a custom timer host for vf_base_url polling."""
    global _timer_host
    _timer_host = _normalize_bridge_timer_host(host)


def reset_bridge_timer_host() -> None:
    """Restore the default Python timer host."""
    global _timer_host
    _timer_host = _PythonBridgeTimerHost()


def get_bridge_timer_host() -> _BridgeTimerHost:
    """Return the currently installed timer host."""
    return _timer_host


def _now() -> float:
    return _timer_host.monotonic()


def _sleep(seconds: float) -> None:
    _timer_host.sleep(float(seconds))


def clear_base_cache() -> None:
    """Drop cached result of :func:`vf_base_url` (e.g. after restarting vf-overlay)."""
    global _cached_base
    _cached_base = None


def vf_base_url(
    *,
    wait_seconds: float = 0.0,
    poll_interval: float = 0.05,
) -> str:
    """``http://127.0.0.1:PORT`` for the running overlay, or *env* override.

    * ``VEKTORFLOW_VF_API`` — full base URL, e.g. ``http://127.0.0.1:54321``.
    * Or ``VEKTORFLOW_VF_PORT`` — port number only.
    * Or ``web/vf-ui/vf-api-port.txt`` (written by vf-overlay when HTTP is up),
      next to the built ``vf-overlay.exe`` under ``.../web/vf-api-port.txt``.
    * The first successful resolution is **cached** for later :func:`pop_line_json` calls.
    """
    global _cached_base
    if _cached_base is not None:
        return _cached_base

    env_api = (os.environ.get("VEKTORFLOW_VF_API") or "").strip()
    if env_api:
        _cached_base = env_api.rstrip("/")
        return _cached_base
    ep = (os.environ.get("VEKTORFLOW_VF_PORT") or "").strip()
    if ep.isdigit():
        p = int(ep, 10)
        if 1 <= p <= 65535:
            _cached_base = f"http://127.0.0.1:{p}"
            return _cached_base

    candidates = _port_file_candidates()
    deadline = _now() + max(0.0, wait_seconds)
    while True:
        for c in candidates:
            pr = _read_port_file(c)
            if pr is not None:
                _cached_base = f"http://127.0.0.1:{pr}"
                return _cached_base
        if _now() >= deadline:
            break
        _sleep(poll_interval)

    raise RuntimeError(
        "vf overlay API base not found: set VEKTORFLOW_VF_API, VEKTORFLOW_VF_PORT, or "
        "start vf-overlay and ensure web/vf-ui/vf-api-port.txt exists (under the overlay "
        "``web/`` directory next to vf-overlay.exe)"
    )


def _get_json(url: str) -> Any:
    req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=2.0) as r:  # noqa: S310
        raw = r.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def pop_line_json() -> Any | None:
    """``GET /api/pop`` — one event object (JSON from the enqueued line), or ``None`` if empty."""
    try:
        base = vf_base_url()
    except RuntimeError:
        return None
    try:
        o = _get_json(base + "/api/pop")
    except (OSError, urllib.error.URLError, json.JSONDecodeError, ValueError):
        return None
    if not isinstance(o, dict):
        return None
    line = o.get("line")
    if line is None:
        return None
    s = str(line)
    if not s.strip():
        return None
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return {"raw": s}


def test_enqueue_json(obj: Any) -> None:
    """POST a synthetic event (unit tests; requires reachable ``vf_base_url``)."""
    base = vf_base_url()
    import json as _j

    body = _j.dumps({"line": _j.dumps(obj)}).encode("utf-8")
    req = urllib.request.Request(  # noqa: S310
        base + "/api/enqueue",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=2.0) as r:
        r.read()
