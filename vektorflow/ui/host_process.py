"""Host process helpers for browser and overlay readiness."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable

from vektorflow.ui.overlay_host_contract import read_overlay_port_from_exe


def browser_state_path() -> Path:
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    return Path(base) / "vektor-flow" / "browser-server.json"


def write_browser_state(port: int) -> None:
    try:
        p = browser_state_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"port": int(port)}), encoding="utf-8")
    except OSError:
        pass


def read_browser_state() -> int | None:
    try:
        data = json.loads(browser_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    port = data.get("port")
    if isinstance(port, int) and port > 0:
        return port
    return None


def probe_overlay_page_ready(port: int, page_rel: str) -> bool:
    rel = str(page_rel).lstrip("/")
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/{rel}", timeout=0.2) as r:  # noqa: S310
            return int(getattr(r, "status", 0) or 0) == 200
    except Exception:
        return False


def probe_browser_server(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/vkf-scene.html", timeout=0.5) as r:  # noqa: S310
            return int(getattr(r, "status", 0) or 0) == 200
    except Exception:
        return False


def wait_for_overlay_ready(
    *,
    exe: Path,
    proc: Any,
    page_rel: str,
    timeout_s: float = 3.0,
    read_port_from_exe: Callable[[Path], int] = read_overlay_port_from_exe,
    probe_overlay_page_ready: Callable[[int, str], bool] = probe_overlay_page_ready,
    wait_fn: Callable[[float], None] = time.sleep,
) -> int:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        rc = proc.poll()
        if rc is not None:
            raise RuntimeError(
                f"vf-overlay exited before becoming ready (exit code {rc}). "
                "Check %LOCALAPPDATA%\\vektor-flow\\vf-overlay.log for host details."
            )
        port = read_port_from_exe(exe)
        if port > 0 and probe_overlay_page_ready(port, page_rel):
            return port
        wait_fn(0.02)
    raise RuntimeError(
        "vf-overlay did not become ready in time. "
        "Expected vf-api-port.txt and a reachable session page beside the launched executable."
    )


def wait_for_process_exit(
    pid: int,
    *,
    timeout_s: float,
    platform_name: str = os.sys.platform,
    run_fn: Callable[..., Any] = subprocess.run,
    kill_fn: Callable[[int, int], None] = os.kill,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> None:
    if pid <= 0 or timeout_s <= 0:
        return
    deadline = time.monotonic() + timeout_s
    if platform_name == "win32":
        while time.monotonic() < deadline:
            try:
                result = run_fn(
                    ["tasklist", "/FI", f"PID eq {pid}"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    check=False,
                    text=True,
                    encoding="utf-8",
                    errors="ignore",
                )
            except OSError:
                return
            if str(pid) not in (getattr(result, "stdout", "") or ""):
                return
            sleep_fn(0.05)
        return
    while time.monotonic() < deadline:
        try:
            kill_fn(pid, 0)
        except OSError:
            return
        sleep_fn(0.05)


def terminate_previous_overlay(
    pid: int,
    *,
    platform_name: str = os.sys.platform,
    run_fn: Callable[..., Any] = subprocess.run,
    kill_fn: Callable[[int, int], None] = os.kill,
    wait_for_process_exit_fn: Callable[[int, float], None] | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> None:
    if pid <= 0:
        return
    wait_fn = wait_for_process_exit_fn or (lambda target_pid, timeout_s: wait_for_process_exit(
        target_pid,
        timeout_s=timeout_s,
        platform_name=platform_name,
        run_fn=run_fn,
        kill_fn=kill_fn,
        sleep_fn=sleep_fn,
    ))
    if platform_name == "win32":
        try:
            run_fn(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except OSError:
            pass
        wait_fn(pid, 2.0)
        sleep_fn(0.25)
        return
    try:
        kill_fn(pid, 15)
    except OSError:
        pass
    wait_fn(pid, 2.0)


__all__ = [
    "browser_state_path",
    "probe_browser_server",
    "probe_overlay_page_ready",
    "read_browser_state",
    "terminate_previous_overlay",
    "wait_for_overlay_ready",
    "wait_for_process_exit",
    "write_browser_state",
]
