from __future__ import annotations

from pathlib import Path

from vektorflow.ui.launch_contract import (
    build_browser_helper_launch,
    find_vf_overlay_exe,
    find_vektorflow_repo_root,
    is_vektorflow_repo,
)


def test_is_vektorflow_repo_detects_ui_tree(tmp_path: Path) -> None:
    ui = tmp_path / "web" / "vf-ui"
    ui.mkdir(parents=True)
    (ui / "index.html").write_text("<!doctype html>", encoding="utf-8")
    (ui / "vkf-scene.html").write_text("<!doctype html>", encoding="utf-8")

    assert is_vektorflow_repo(tmp_path) is True


def test_find_vf_overlay_exe_prefers_known_build_layout(tmp_path: Path) -> None:
    exe = tmp_path / "native" / "VfOverlay" / "build" / "Release" / "vf-overlay.exe"
    exe.parent.mkdir(parents=True, exist_ok=True)
    exe.write_bytes(b"")

    assert find_vf_overlay_exe(tmp_path) == exe.resolve()


def test_find_vektorflow_repo_root_uses_env_first(tmp_path: Path) -> None:
    ui = tmp_path / "web" / "vf-ui"
    ui.mkdir(parents=True)
    (ui / "index.html").write_text("<!doctype html>", encoding="utf-8")
    (ui / "vkf-scene.html").write_text("<!doctype html>", encoding="utf-8")

    root = find_vektorflow_repo_root(
        env_root=str(tmp_path),
        cwd=tmp_path / "child",
        module_file=tmp_path / "pkg" / "launch.py",
        sys_executable=tmp_path / "python.exe",
        package_file=None,
    )

    assert root == tmp_path.resolve()


def test_build_browser_helper_launch_windows_uses_detached_flags(tmp_path: Path) -> None:
    serve_dir = tmp_path / "web" / "vf-ui"
    state_path = tmp_path / "browser-server.json"

    command, kwargs = build_browser_helper_launch(
        serve_dir=serve_dir,
        port=43125,
        state_path=state_path,
        python_executable=Path("C:/Python/python.exe"),
        platform_name="win32",
        detached_process_flag=0x00000008,
        new_process_group_flag=0x00000200,
        no_window_flag=0x08000000,
    )

    assert Path(command[0]) == Path("C:/Python/python.exe")
    assert command[1:3] == ["-u", "-c"]
    assert str(serve_dir) in command
    assert "43125" in command
    assert str(state_path) in command
    assert kwargs["stdin"] is not None
    assert kwargs["stdout"] is not None
    assert kwargs["stderr"] is not None
    assert kwargs["creationflags"] == (0x00000008 | 0x00000200 | 0x08000000)


def test_build_browser_helper_launch_windows_prefers_overlay_serve_only(tmp_path: Path) -> None:
    serve_dir = tmp_path / "web" / "vf-ui"
    state_path = tmp_path / "browser-server.json"
    overlay_exe = tmp_path / "native" / "VfOverlay" / "build" / "Release" / "vf-overlay.exe"
    overlay_exe.parent.mkdir(parents=True, exist_ok=True)
    overlay_exe.write_bytes(b"")

    command, kwargs = build_browser_helper_launch(
        serve_dir=serve_dir,
        port=43125,
        state_path=state_path,
        python_executable=Path("C:/Python/python.exe"),
        platform_name="win32",
        detached_process_flag=0x00000008,
        new_process_group_flag=0x00000200,
        no_window_flag=0x08000000,
        overlay_exe=overlay_exe,
    )

    assert command == [str(overlay_exe.resolve()), "--serve-only", "--port", "43125"]
    assert kwargs["stdin"] is not None
    assert kwargs["stdout"] is not None
    assert kwargs["stderr"] is not None
    assert kwargs["creationflags"] == (0x00000008 | 0x00000200 | 0x08000000)
