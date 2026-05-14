from __future__ import annotations

from pathlib import Path

from vektorflow.ui.session import ensure_ui_session, reset_ui_session, write_session_file


def _write_minimal_web_tree(root: Path) -> Path:
    repo_web_dir = root / "web" / "vf-ui"
    repo_web_dir.mkdir(parents=True)
    (repo_web_dir / "vkf-scene.html").write_text(
        "\n".join(
            [
                '<link rel="stylesheet" href="vf-frame.css" />',
                '<script src="vf-frame.js?v=1"></script>',
                '<script src="vf-browser-transport.js?v=1"></script>',
                '<script src="vf-game-camera.js?v=1"></script>',
                '<script src="vf-display.js?v=1"></script>',
                '<script src="geom/vf-geom-core.js?v=1"></script>',
            ]
        ),
        encoding="utf-8",
    )
    built_web_dir = root / "native" / "VfOverlay" / "build" / "Release" / "web"
    built_web_dir.mkdir(parents=True)
    (built_web_dir / "vkf-scene.html").write_text("<!doctype html>", encoding="utf-8")
    return built_web_dir


def test_overlay_session_contains_seed_payloads_and_root_asset_links(tmp_path) -> None:
    reset_ui_session()
    built_web_dir = _write_minimal_web_tree(tmp_path)

    try:
        session = ensure_ui_session(tmp_path)

        built_session_dir = built_web_dir / "sessions" / session.session_id
        assert (built_session_dir / "vf-display.json").is_file()
        assert (built_session_dir / "vf-runtime-packets.json").is_file()
        assert (built_session_dir / "vf-ui-state.json").is_file()
        assert (built_session_dir / "vkf-scene.json").is_file()

        html = (built_session_dir / "vkf-scene.html").read_text(encoding="utf-8")
        assert 'href="../../vf-frame.css"' in html
        assert 'src="../../vf-browser-transport.js' in html
        assert 'src="../../vf-game-camera.js' in html
        assert 'src="../../vf-display.js' in html
        assert 'src="../../geom/vf-geom-core.js' in html
    finally:
        reset_ui_session()


def test_write_session_file_mirrors_runtime_payloads_to_overlay_session(tmp_path) -> None:
    reset_ui_session()
    built_web_dir = _write_minimal_web_tree(tmp_path)

    try:
        session = ensure_ui_session(tmp_path)

        write_session_file(session, "vf-display.json", '{"frames":{"f1":{}}}\n')

        assert (session.repo_session_dir / "vf-display.json").read_text(encoding="utf-8") == '{"frames":{"f1":{}}}\n'
        built_display = built_web_dir / "sessions" / session.session_id / "vf-display.json"
        assert built_display.read_text(encoding="utf-8") == '{"frames":{"f1":{}}}\n'
    finally:
        reset_ui_session()
