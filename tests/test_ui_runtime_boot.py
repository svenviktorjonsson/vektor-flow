from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow.ui.runtime_boot import (
    build_browser_launch_plan,
    build_overlay_launch_plan,
)
from vektorflow.ui.session_staging import UISessionArtifacts


def test_build_browser_launch_plan_uses_session_page_rel(tmp_path: Path) -> None:
    root = tmp_path
    serve_dir = root / "web" / "vf-ui"
    serve_dir.mkdir(parents=True)
    session = UISessionArtifacts(
        session_id="abc123",
        page_rel="sessions/abc123/vkf-scene.html",
        repo_web_dir=serve_dir,
        repo_session_dir=serve_dir / "sessions" / "abc123",
        built_web_dirs=(),
    )

    plan = build_browser_launch_plan(root=root, session=session, port=43125)

    assert plan.serve_dir == serve_dir
    assert plan.url == "http://127.0.0.1:43125/sessions/abc123/vkf-scene.html"


def test_build_overlay_launch_plan_validates_adjacent_web_root(tmp_path: Path) -> None:
    root = tmp_path
    exe = root / "native" / "VfOverlay" / "build" / "Release" / "vf-overlay.exe"
    exe.parent.mkdir(parents=True, exist_ok=True)
    exe.write_bytes(b"")
    web_dir = exe.parent / "web"
    (web_dir / "vkf-scene.html").parent.mkdir(parents=True, exist_ok=True)
    (web_dir / "vkf-scene.html").write_text("<!doctype html>", encoding="utf-8")
    session_page = web_dir / "sessions" / "abc123" / "vkf-scene.html"
    session_page.parent.mkdir(parents=True, exist_ok=True)
    session_page.write_text("<!doctype html>", encoding="utf-8")

    session = UISessionArtifacts(
        session_id="abc123",
        page_rel="sessions/abc123/vkf-scene.html",
        repo_web_dir=root / "web" / "vf-ui",
        repo_session_dir=root / "web" / "vf-ui" / "sessions" / "abc123",
        built_web_dirs=(web_dir,),
    )

    plan = build_overlay_launch_plan(root=root, exe=exe, session=session)

    assert plan.root == root.resolve()
    assert plan.exe == exe.resolve()
    assert plan.overlay_web_dir == web_dir.resolve()
    assert plan.overlay_page == session_page.resolve()
    assert plan.argv == [str(exe.resolve()), "sessions/abc123/vkf-scene.html"]
    assert plan.cwd == exe.parent.resolve()


def test_build_overlay_launch_plan_rejects_missing_session_page(tmp_path: Path) -> None:
    root = tmp_path
    exe = root / "native" / "VfOverlay" / "build" / "Release" / "vf-overlay.exe"
    exe.parent.mkdir(parents=True, exist_ok=True)
    exe.write_bytes(b"")
    web_dir = exe.parent / "web"
    (web_dir / "vkf-scene.html").parent.mkdir(parents=True, exist_ok=True)
    (web_dir / "vkf-scene.html").write_text("<!doctype html>", encoding="utf-8")

    session = UISessionArtifacts(
        session_id="abc123",
        page_rel="sessions/abc123/vkf-scene.html",
        repo_web_dir=root / "web" / "vf-ui",
        repo_session_dir=root / "web" / "vf-ui" / "sessions" / "abc123",
        built_web_dirs=(web_dir,),
    )

    with pytest.raises(RuntimeError, match="staged overlay session page missing"):
        build_overlay_launch_plan(root=root, exe=exe, session=session)
