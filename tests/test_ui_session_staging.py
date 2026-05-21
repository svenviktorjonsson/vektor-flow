from __future__ import annotations

from pathlib import Path
import pathlib

from vektorflow.ui.session_staging import mirror_session_file, stage_ui_session


def _write_minimal_web_tree(root: Path) -> Path:
    repo_web_dir = root / "web" / "vf-ui"
    repo_web_dir.mkdir(parents=True)
    (repo_web_dir / "index.html").write_text("<!doctype html>", encoding="utf-8")
    (repo_web_dir / "vkf-scene.html").write_text(
        "\n".join(
            [
                '<link rel="stylesheet" href="vf-frame.css" />',
                '<script src="vf-runtime-shell.js"></script>',
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


def test_stage_ui_session_seeds_repo_and_built_session_dirs(tmp_path: Path) -> None:
    built_web_dir = _write_minimal_web_tree(tmp_path)

    session = stage_ui_session(tmp_path, session_id="test-session")

    assert session.session_id == "test-session"
    assert session.page_rel == "sessions/test-session/vkf-scene.html"
    assert (session.repo_session_dir / "vf-display.json").is_file()
    built_session_dir = built_web_dir / "sessions" / "test-session"
    assert (built_session_dir / "vf-display.json").is_file()
    html = (built_session_dir / "vkf-scene.html").read_text(encoding="utf-8")
    assert 'href="../../vf-frame.css?v=' in html
    assert 'src="../../vf-display.js?v=' in html


def test_mirror_session_file_writes_repo_and_built_paths(tmp_path: Path) -> None:
    built_web_dir = _write_minimal_web_tree(tmp_path)
    session = stage_ui_session(tmp_path, session_id="mirror-session")

    mirror_session_file(session, "vf-display.json", '{"frames":{"f1":{}}}\n')

    assert (session.repo_session_dir / "vf-display.json").read_text(encoding="utf-8") == '{"frames":{"f1":{}}}\n'
    assert (built_web_dir / "sessions" / "mirror-session" / "vf-display.json").read_text(encoding="utf-8") == '{"frames":{"f1":{}}}\n'


def test_mirror_session_file_skips_unchanged_rewrites(tmp_path: Path, monkeypatch) -> None:
    _write_minimal_web_tree(tmp_path)
    session = stage_ui_session(tmp_path, session_id="mirror-session")
    mirror_session_file(session, "vf-display.json", '{"frames":{"f1":{}}}\n')

    targets = {
        str((session.repo_session_dir / "vf-display.json").resolve()),
        *(str(path.resolve()) for path in (
            built_session_dir / "vf-display.json"
            for built_session_dir in session.built_session_dirs
        )),
    }
    real_write_text = pathlib.Path.write_text
    writes: list[str] = []

    def record_write_text(self: Path, text: str, *args, **kwargs):
        if str(self.resolve()) in targets:
            writes.append(str(self.resolve()))
        return real_write_text(self, text, *args, **kwargs)

    monkeypatch.setattr(pathlib.Path, "write_text", record_write_text)

    mirror_session_file(session, "vf-display.json", '{"frames":{"f1":{}}}\n')

    assert writes == []
