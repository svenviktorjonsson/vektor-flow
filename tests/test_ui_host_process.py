from __future__ import annotations

from types import SimpleNamespace
from pathlib import Path

from vektorflow.ui.host_process import (
    read_browser_state,
    terminate_previous_overlay,
    wait_for_overlay_ready,
    write_browser_state,
)


def test_browser_state_round_trips(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))

    write_browser_state(43125)

    assert read_browser_state() == 43125


def test_wait_for_overlay_ready_returns_when_port_and_probe_ready(tmp_path: Path) -> None:
    exe = tmp_path / "vf-overlay.exe"
    exe.write_bytes(b"")
    proc = SimpleNamespace(poll=lambda: None)

    calls = {"read": 0}

    def fake_read_port(_: Path) -> int:
        calls["read"] += 1
        return 43125 if calls["read"] >= 2 else 0

    def fake_probe(port: int, page_rel: str) -> bool:
        return port == 43125 and page_rel == "sessions/test/vkf-scene.html"

    port = wait_for_overlay_ready(
        exe=exe,
        proc=proc,
        page_rel="sessions/test/vkf-scene.html",
        timeout_s=0.2,
        read_port_from_exe=fake_read_port,
        probe_overlay_page_ready=fake_probe,
        wait_fn=lambda _: None,
    )

    assert port == 43125


def test_wait_for_overlay_ready_raises_when_process_exits(tmp_path: Path) -> None:
    exe = tmp_path / "vf-overlay.exe"
    exe.write_bytes(b"")
    proc = SimpleNamespace(poll=lambda: 7)

    try:
        wait_for_overlay_ready(
            exe=exe,
            proc=proc,
            page_rel="sessions/test/vkf-scene.html",
            timeout_s=0.2,
            read_port_from_exe=lambda _: 0,
            probe_overlay_page_ready=lambda *_: False,
            wait_fn=lambda _: None,
        )
    except RuntimeError as exc:
        assert "exit code 7" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")


def test_terminate_previous_overlay_windows_kills_waits_and_settles() -> None:
    calls: list[tuple[str, object]] = []

    terminate_previous_overlay(
        777,
        platform_name="win32",
        run_fn=lambda args, **kwargs: calls.append(("run", tuple(args))) or SimpleNamespace(),
        kill_fn=lambda pid, sig: calls.append(("kill", (pid, sig))),
        wait_for_process_exit_fn=lambda pid, timeout_s: calls.append(("wait", (pid, timeout_s))),
        sleep_fn=lambda seconds: calls.append(("sleep", seconds)),
    )

    assert calls == [
        ("run", ("taskkill", "/PID", "777", "/T", "/F")),
        ("wait", (777, 2.0)),
        ("sleep", 0.25),
    ]
