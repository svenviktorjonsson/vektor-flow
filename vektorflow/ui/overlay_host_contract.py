"""Overlay host state and file contract helpers."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path


def overlay_state_path() -> Path:
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    return Path(base) / "vektor-flow" / "overlay-process.json"


def read_overlay_state() -> dict[str, object] | None:
    try:
        data = json.loads(overlay_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def read_overlay_pid() -> int | None:
    data = read_overlay_state()
    if not isinstance(data, dict):
        return None
    pid = data.get("pid")
    if isinstance(pid, int) and pid > 0:
        return pid
    return None


def write_overlay_state(*, pid: int, exe: Path) -> None:
    try:
        p = overlay_state_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(
            json.dumps(
                {
                    "pid": int(pid),
                    "exe": str(exe),
                }
            ),
            encoding="utf-8",
        )
    except OSError:
        pass


def clear_overlay_state() -> None:
    try:
        overlay_state_path().unlink(missing_ok=True)
    except OSError:
        pass


def overlay_web_dir_for_exe(exe: Path) -> Path:
    return (exe.parent / "web").resolve()


def overlay_port_file_for_exe(exe: Path) -> Path:
    return overlay_web_dir_for_exe(exe) / "vf-api-port.txt"


def clear_overlay_port_file(exe: Path) -> None:
    try:
        overlay_port_file_for_exe(exe).unlink(missing_ok=True)
    except OSError:
        pass


def read_overlay_port_from_exe(exe: Path) -> int:
    try:
        txt = overlay_port_file_for_exe(exe).read_text(encoding="utf-8").strip()
    except OSError:
        return 0
    return int(txt) if txt.isdigit() else 0


__all__ = [
    "clear_overlay_port_file",
    "clear_overlay_state",
    "overlay_port_file_for_exe",
    "overlay_state_path",
    "overlay_web_dir_for_exe",
    "read_overlay_pid",
    "read_overlay_port_from_exe",
    "read_overlay_state",
    "write_overlay_state",
]
