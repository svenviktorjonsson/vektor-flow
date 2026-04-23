"""UI auto-launch on first ``add_frame`` (``vektorflow.ui.launch``)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

import vektorflow.ui.launch
from vektorflow.stdlib.ui import build_ui_namespace
from vektorflow.ui.launch import _reset_ui_launch_for_tests, maybe_launch_vf_overlay

_REPO = Path(__file__).resolve().parents[1]
_MARKERS = (_REPO / "web" / "vf-ui" / "index.html").is_file() and (
    _REPO / "native" / "VfOverlay" / "CMakeLists.txt"
).is_file()


@pytest.mark.skipif(not _MARKERS, reason="web/vf-ui or native/VfOverlay not present")
def test_launch_skipped_when_disabled(monkeypatch) -> None:
    _reset_ui_launch_for_tests()
    with patch("vektorflow.ui.launch.subprocess.Popen") as popen:
        maybe_launch_vf_overlay()
        maybe_launch_vf_overlay()
        popen.assert_not_called()


@pytest.mark.skipif(not _MARKERS, reason="web/vf-ui or native/VfOverlay not present")
def test_first_add_frame_calls_popen_once_when_enabled(monkeypatch) -> None:
    monkeypatch.setattr(vektorflow.ui.launch, "_suppress_ui_auto_launch", False)
    _reset_ui_launch_for_tests()

    monkeypatch.setattr(
        "vektorflow.ui.launch.find_vektorflow_repo_root",
        lambda: _REPO,
    )
    fake_exe = Path(r"C:\fake\vf-overlay.exe")
    monkeypatch.setattr(
        "vektorflow.ui.launch.find_vf_overlay_exe",
        lambda _root: fake_exe,
    )

    d = build_ui_namespace()["ui"].display
    f = d.frame(draggable=True)

    calls: list = []

    def _fake_popen(*args, **kwargs) -> None:  # noqa: ANN001
        calls.append((args, kwargs))
        return None

    with patch("vektorflow.ui.launch.subprocess.Popen", side_effect=_fake_popen):
        d.add_frame(f, (0.1, 0.1, 0.3, 0.3))
        f2 = d.frame(draggable=True)
        d.add_frame(f2, (0.2, 0.2, 0.3, 0.3))

    assert len(calls) == 1
    argv = calls[0][0][0]
    assert argv[0] == str(fake_exe)
