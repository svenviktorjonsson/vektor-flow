from __future__ import annotations

import json
from pathlib import Path

from vektorflow.ui.overlay_host_contract import (
    clear_overlay_port_file,
    clear_overlay_state,
    overlay_port_file_for_exe,
    overlay_web_dir_for_exe,
    read_overlay_pid,
    read_overlay_port_from_exe,
    read_overlay_state,
    write_overlay_state,
)


def test_overlay_state_round_trips(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))

    exe = tmp_path / "native" / "VfOverlay" / "build" / "Release" / "vf-overlay.exe"
    exe.parent.mkdir(parents=True, exist_ok=True)
    exe.write_bytes(b"")

    write_overlay_state(pid=12345, exe=exe)

    assert read_overlay_state() == {"pid": 12345, "exe": str(exe)}
    assert read_overlay_pid() == 12345

    clear_overlay_state()

    assert read_overlay_state() is None
    assert read_overlay_pid() is None


def test_overlay_port_file_helpers_use_adjacent_web_dir(tmp_path: Path) -> None:
    exe = tmp_path / "native" / "VfOverlay" / "build" / "Release" / "vf-overlay.exe"
    exe.parent.mkdir(parents=True, exist_ok=True)
    exe.write_bytes(b"")

    web_dir = overlay_web_dir_for_exe(exe)
    assert web_dir == (exe.parent / "web").resolve()

    port_file = overlay_port_file_for_exe(exe)
    port_file.parent.mkdir(parents=True, exist_ok=True)
    port_file.write_text("43125", encoding="utf-8")

    assert read_overlay_port_from_exe(exe) == 43125

    clear_overlay_port_file(exe)

    assert not port_file.exists()
    assert read_overlay_port_from_exe(exe) == 0
