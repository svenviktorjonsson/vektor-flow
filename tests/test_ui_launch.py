"""UI auto-launch on first ``add_frame`` (``vektorflow.ui.launch``).

Covers:
  - Overlay mode: Popen called exactly once (existing behaviour).
  - Browser mode: HTTP server starts, URL is reachable, Popen NOT called.
  - Headless mode: neither Popen nor HTTP server started.
  - set_ui_mode() / get_ui_mode() / UIRoot.set_mode() / UIRoot.mode
  - VF_UI_MODE env var respected.
  - maybe_launch_ui() dispatches correctly per mode.
  - Double-launch guard: _launched flag prevents a second spawn.
"""

from __future__ import annotations

import os
import time
import urllib.request
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

import vektorflow.ui.launch as L
from vektorflow.stdlib.ui import build_ui_namespace, UIRoot
from vektorflow.ui.launch import (
    _reset_ui_launch_for_tests,
    maybe_launch_vf_overlay,
    maybe_launch_browser,
    maybe_launch_ui,
    get_ui_mode,
    set_ui_mode,
    get_browser_port,
    find_vektorflow_repo_root,
)

_REPO = Path(__file__).resolve().parents[1]
_HAS_MARKERS = (
    (_REPO / "web" / "vf-ui" / "index.html").is_file()
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    """Reset all launch state before each test."""
    monkeypatch.setattr(L, "_launched", False)
    monkeypatch.setattr(L, "_forced_mode", None)
    monkeypatch.setattr(L, "_browser_server", None)
    monkeypatch.setattr(L, "_browser_thread", None)
    monkeypatch.setattr(L, "_browser_port", None)
    monkeypatch.setattr(L, "_suppress_ui_auto_launch", False)
    # Remove env var so auto-detect kicks in cleanly
    monkeypatch.delenv("VF_UI_MODE", raising=False)
    yield
    # After test: kill any server that was started
    if L._browser_server is not None:
        try:
            L._browser_server.shutdown()
        except Exception:
            pass
        L._browser_server = None


# ---------------------------------------------------------------------------
# get_ui_mode / set_ui_mode
# ---------------------------------------------------------------------------

class TestGetSetMode:
    def test_auto_detect_non_windows(self, monkeypatch) -> None:
        monkeypatch.setattr("sys.platform", "linux")
        assert get_ui_mode() == "browser"

    def test_auto_detect_windows(self, monkeypatch) -> None:
        monkeypatch.setattr("sys.platform", "win32")
        assert get_ui_mode() == "overlay"

    def test_env_var_browser(self, monkeypatch) -> None:
        monkeypatch.setenv("VF_UI_MODE", "browser")
        assert get_ui_mode() == "browser"

    def test_env_var_overlay(self, monkeypatch) -> None:
        monkeypatch.setenv("VF_UI_MODE", "overlay")
        assert get_ui_mode() == "overlay"

    def test_env_var_headless(self, monkeypatch) -> None:
        monkeypatch.setenv("VF_UI_MODE", "headless")
        assert get_ui_mode() == "headless"

    def test_forced_mode_beats_env(self, monkeypatch) -> None:
        monkeypatch.setenv("VF_UI_MODE", "overlay")
        set_ui_mode("browser")
        assert get_ui_mode() == "browser"

    def test_forced_mode_beats_platform(self, monkeypatch) -> None:
        monkeypatch.setattr("sys.platform", "win32")
        set_ui_mode("headless")
        assert get_ui_mode() == "headless"

    def test_set_mode_resets_launched(self) -> None:
        L._launched = True
        set_ui_mode("headless")
        assert L._launched is False

    def test_set_mode_invalid_raises(self) -> None:
        with pytest.raises(ValueError, match="must be"):
            set_ui_mode("turbo")

    def test_set_mode_case_insensitive(self) -> None:
        set_ui_mode("BROWSER")
        assert get_ui_mode() == "browser"


# ---------------------------------------------------------------------------
# UIRoot.set_mode / UIRoot.mode
# ---------------------------------------------------------------------------

class TestUIRootMode:
    def test_set_mode_browser(self) -> None:
        ui = UIRoot()
        ui.set_mode("browser")
        assert ui.mode == "browser"

    def test_set_mode_headless(self) -> None:
        ui = UIRoot()
        ui.set_mode("headless")
        assert ui.mode == "headless"

    def test_mode_property_reflects_global(self) -> None:
        set_ui_mode("overlay")
        ui = UIRoot()
        assert ui.mode == "overlay"

    def test_set_mode_invalid(self) -> None:
        ui = UIRoot()
        with pytest.raises(ValueError):
            ui.set_mode("badmode")


# ---------------------------------------------------------------------------
# maybe_launch_ui dispatch
# ---------------------------------------------------------------------------

class TestMaybeLaunchUiDispatch:
    def test_headless_calls_nothing(self, monkeypatch) -> None:
        set_ui_mode("headless")
        with (
            patch.object(L, "maybe_launch_browser") as mb,
            patch.object(L, "maybe_launch_vf_overlay") as mo,
        ):
            maybe_launch_ui()
        mb.assert_not_called()
        mo.assert_not_called()

    def test_browser_mode_calls_browser(self, monkeypatch) -> None:
        set_ui_mode("browser")
        with (
            patch.object(L, "maybe_launch_browser") as mb,
            patch.object(L, "maybe_launch_vf_overlay") as mo,
        ):
            maybe_launch_ui()
        mb.assert_called_once()
        mo.assert_not_called()

    def test_overlay_mode_calls_overlay(self, monkeypatch) -> None:
        set_ui_mode("overlay")
        with (
            patch.object(L, "maybe_launch_browser") as mb,
            patch.object(L, "maybe_launch_vf_overlay") as mo,
        ):
            maybe_launch_ui()
        mb.assert_not_called()
        mo.assert_called_once()

    def test_suppress_skips_everything(self, monkeypatch) -> None:
        set_ui_mode("browser")
        monkeypatch.setattr(L, "_suppress_ui_auto_launch", True)
        with patch.object(L, "maybe_launch_browser") as mb:
            maybe_launch_ui()
        mb.assert_not_called()


# ---------------------------------------------------------------------------
# Browser mode: HTTP server actually works
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _HAS_MARKERS, reason="web/vf-ui not present")
class TestBrowserServer:
    def test_server_starts_and_is_reachable(self) -> None:
        set_ui_mode("browser")
        with patch("webbrowser.open"):  # don't actually open a browser
            maybe_launch_browser()

        time.sleep(0.15)
        port = get_browser_port()
        assert port is not None, "Browser server did not start"

        url = f"http://127.0.0.1:{port}/vf-display.json"
        r = urllib.request.urlopen(url, timeout=3)
        assert r.status == 200

    def test_server_not_started_twice(self) -> None:
        set_ui_mode("browser")
        with patch("webbrowser.open"):
            maybe_launch_browser()
            first_port = get_browser_port()
            maybe_launch_browser()  # second call is a no-op
            second_port = get_browser_port()
        assert first_port == second_port

    def test_headless_does_not_start_server(self) -> None:
        set_ui_mode("headless")
        maybe_launch_ui()
        assert get_browser_port() is None

    def test_browser_does_not_call_popen(self) -> None:
        set_ui_mode("browser")
        with (
            patch("webbrowser.open"),
            patch("vektorflow.ui.launch.subprocess.Popen") as popen,
        ):
            maybe_launch_browser()
        popen.assert_not_called()

    def test_index_html_served(self) -> None:
        set_ui_mode("browser")
        with patch("webbrowser.open"):
            maybe_launch_browser()
        time.sleep(0.1)
        port = get_browser_port()
        url = f"http://127.0.0.1:{port}/index.html"
        r = urllib.request.urlopen(url, timeout=3)
        assert r.status == 200

    def test_vkf_scene_html_served(self) -> None:
        set_ui_mode("browser")
        with patch("webbrowser.open"):
            maybe_launch_browser()
        time.sleep(0.1)
        port = get_browser_port()
        url = f"http://127.0.0.1:{port}/vkf-scene.html"
        r = urllib.request.urlopen(url, timeout=3)
        assert r.status == 200


# ---------------------------------------------------------------------------
# Overlay mode: Popen called exactly once
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _HAS_MARKERS, reason="web/vf-ui or native/VfOverlay not present")
class TestOverlayMode:
    def test_launch_skipped_when_suppressed(self, monkeypatch) -> None:
        monkeypatch.setattr(L, "_suppress_ui_auto_launch", True)
        with patch("vektorflow.ui.launch.subprocess.Popen") as popen:
            maybe_launch_vf_overlay()
        popen.assert_not_called()

    def test_popen_called_once_then_guarded(self, monkeypatch) -> None:
        fake_exe = _REPO / "native" / "VfOverlay" / "build" / "Release" / "fake-overlay.exe"
        monkeypatch.setattr(L, "find_vektorflow_repo_root", lambda: _REPO)
        monkeypatch.setattr(L, "find_vf_overlay_exe", lambda r: fake_exe)
        set_ui_mode("overlay")

        proc = MagicMock()
        proc.pid = 12345

        with (
            patch("vektorflow.ui.launch.subprocess.Popen", return_value=proc) as popen,
            patch.object(L, "_wait_for_overlay_ready", return_value=12345),
        ):
            maybe_launch_vf_overlay()
            maybe_launch_vf_overlay()  # second call must be a no-op

        assert popen.call_count == 1

    def test_overlay_exe_missing_warns(self, monkeypatch, capsys) -> None:
        monkeypatch.setattr(L, "find_vektorflow_repo_root", lambda: _REPO)
        monkeypatch.setattr(L, "find_vf_overlay_exe", lambda r: None)
        set_ui_mode("overlay")
        with patch("vektorflow.ui.launch.subprocess.Popen") as popen:
            maybe_launch_vf_overlay()
        popen.assert_not_called()
        err = capsys.readouterr().err
        assert "vf-overlay.exe not found" in err or "UI not started" in err

    def test_exec_root_fallback(self, monkeypatch, tmp_path) -> None:
        bundle_root = tmp_path / "bundle"
        web_root = bundle_root / "web" / "vf-ui"
        (web_root / "index.html").parent.mkdir(parents=True, exist_ok=True)
        (web_root / "index.html").write_text("<!doctype html>", encoding="utf-8")
        (web_root / "vkf-scene.html").write_text("<!doctype html>", encoding="utf-8")
        exe = bundle_root / "vf-overlay.exe"
        exe.write_bytes(b"")
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(sys, "executable", str(exe))
        monkeypatch.setattr(L, "__file__", str((tmp_path / "fake_launch.py").resolve()))
        root = L.find_vektorflow_repo_root()
        assert root == bundle_root

# ---------------------------------------------------------------------------
# Integration: add_frame triggers maybe_launch_ui via Display._sync_all
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _HAS_MARKERS, reason="web/vf-ui not present")
class TestAddFrameTriggersMaybelaunchUi:
    def test_headless_add_frame_calls_maybe_launch_ui(self, monkeypatch) -> None:
        set_ui_mode("headless")
        with patch.object(L, "maybe_launch_ui") as mu:
            ui = build_ui_namespace()["ui"]
            ui.display.add_frame((0.1, 0.1, 0.8, 0.8))
        mu.assert_called()

    def test_browser_add_frame_no_popen(self, monkeypatch) -> None:
        set_ui_mode("browser")
        with (
            patch("webbrowser.open"),
            patch("vektorflow.ui.launch.subprocess.Popen") as popen,
        ):
            ui = build_ui_namespace()["ui"]
            ui.display.add_frame((0.1, 0.1, 0.8, 0.8))
        popen.assert_not_called()
