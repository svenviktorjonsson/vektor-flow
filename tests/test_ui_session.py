from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow.ui.session import (
    ensure_ui_session,
    reset_ui_session,
    write_session_file,
)


PAYLOAD_FILENAMES = (
    "vf-display.json",
    "vkf-scene.json",
    "vf-ui-state.json",
    "vf-runtime-packets.json",
)


@pytest.fixture(autouse=True)
def _reset_session_state() -> None:
    reset_ui_session()
    yield
    reset_ui_session()


def _make_ui_root(root: Path) -> Path:
    ui_dir = root / "web" / "vf-ui"
    ui_dir.mkdir(parents=True)
    (ui_dir / "index.html").write_text("<html></html>", encoding="utf-8")
    (ui_dir / "vkf-scene.html").write_text(
        '<html><script src="vf-runtime-shell.js?v=1"></script></html>',
        encoding="utf-8",
    )
    (ui_dir / "vf-runtime-shell.js").write_text("// shell", encoding="utf-8")
    return ui_dir


def _make_built_overlay_web(root: Path) -> Path:
    built_web_dir = root / "native" / "VfOverlay" / "build" / "Release" / "web"
    built_web_dir.mkdir(parents=True)
    (built_web_dir / "vkf-scene.html").write_text("<html></html>", encoding="utf-8")
    (built_web_dir / "vf-runtime-shell.js").write_text("// built shell", encoding="utf-8")
    return built_web_dir


def _make_native_build_overlay_web(root: Path) -> Path:
    built_web_dir = root / "native" / "build" / "VfOverlay" / "Release" / "web"
    built_web_dir.mkdir(parents=True)
    (built_web_dir / "vkf-scene.html").write_text("<html></html>", encoding="utf-8")
    (built_web_dir / "vf-runtime-shell.js").write_text("// built shell", encoding="utf-8")
    return built_web_dir


def test_overlay_session_staging_keeps_only_host_page_in_built_tree(tmp_path: Path) -> None:
    _make_ui_root(tmp_path)
    built_web_dir = _make_built_overlay_web(tmp_path)

    session = ensure_ui_session(tmp_path)

    built_session_dir = session.built_session_dirs
    assert built_session_dir == ((built_web_dir / "sessions" / session.session_id).resolve(),)
    assert (built_session_dir[0] / "vkf-scene.html").is_file()
    for filename in PAYLOAD_FILENAMES:
        assert not (built_session_dir[0] / filename).exists()
        assert not (built_web_dir / filename).exists()


def test_payload_writes_stay_repo_local_even_when_overlay_session_exists(tmp_path: Path) -> None:
    _make_ui_root(tmp_path)
    built_web_dir = _make_built_overlay_web(tmp_path)

    session = ensure_ui_session(tmp_path)
    write_session_file(session, "vf-display.json", '{"screen":[]}\n', mirror_root=True)

    assert (session.repo_session_dir / "vf-display.json").read_text(encoding="utf-8") == '{"screen":[]}\n'
    assert (session.repo_web_dir / "vf-display.json").read_text(encoding="utf-8") == '{"screen":[]}\n'
    assert not (session.built_session_dirs[0] / "vf-display.json").exists()
    assert not (built_web_dir / "vf-display.json").exists()


def test_overlay_session_staging_includes_native_build_release_tree(tmp_path: Path) -> None:
    _make_ui_root(tmp_path)
    built_web_dir = _make_native_build_overlay_web(tmp_path)

    session = ensure_ui_session(tmp_path)

    assert session.built_session_dirs == ((built_web_dir / "sessions" / session.session_id).resolve(),)
    assert (session.built_session_dirs[0] / "vkf-scene.html").is_file()
    for filename in PAYLOAD_FILENAMES:
        assert not (session.built_session_dirs[0] / filename).exists()
        assert not (built_web_dir / filename).exists()


def test_ensure_ui_session_does_not_delete_existing_live_sessions(tmp_path: Path) -> None:
    _make_ui_root(tmp_path)
    built_web_dir = _make_native_build_overlay_web(tmp_path)
    stale_session = built_web_dir / "sessions" / "stale-run"
    stale_session.mkdir(parents=True)
    (stale_session / "vkf-scene.html").write_text("<html>stale</html>", encoding="utf-8")

    session = ensure_ui_session(tmp_path)

    assert stale_session.is_dir()
    assert (stale_session / "vkf-scene.html").is_file()
    assert (session.built_session_dirs[0] / "vkf-scene.html").is_file()
