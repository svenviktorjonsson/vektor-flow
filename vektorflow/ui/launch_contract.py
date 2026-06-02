"""Discovery and launch-contract helpers for UI host startup."""

from __future__ import annotations

import socket
import subprocess
from pathlib import Path


def is_vektorflow_repo(path: Path) -> bool:
    ui = Path(path) / "web" / "vf-ui"
    return ui.joinpath("index.html").is_file() and ui.joinpath("vkf-scene.html").is_file()


def find_vektorflow_repo_root(
    *,
    env_root: str,
    cwd: Path,
    module_file: Path,
    sys_executable: Path,
    package_file: Path | None,
) -> Path | None:
    env = (env_root or "").strip()
    if env:
        p = Path(env).expanduser().resolve()
        if is_vektorflow_repo(p):
            return p
    try:
        exe_root = Path(sys_executable).resolve().parent
        for base in (exe_root, *exe_root.parents):
            if is_vektorflow_repo(base):
                return base
    except Exception:
        pass
    cur = Path(cwd).resolve()
    for _ in range(40):
        if is_vektorflow_repo(cur):
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    for base in Path(module_file).resolve().parents:
        if is_vektorflow_repo(base):
            return base
    if package_file is not None:
        try:
            p = Path(package_file).resolve().parent
            for _ in range(24):
                if is_vektorflow_repo(p):
                    return p
                if p.parent == p:
                    break
                p = p.parent
        except Exception:
            pass
    return None


def find_vf_overlay_exe(root: Path) -> Path | None:
    for rel in (
        Path("native") / "VfOverlay" / "build" / "Release" / "vf-overlay.exe",
        Path("native") / "VfOverlay" / "build" / "Debug" / "vf-overlay.exe",
        Path("native") / "VfOverlay" / "build" / "x64" / "Release" / "vf-overlay.exe",
        Path("native") / "VfOverlay" / "build" / "x64" / "Debug" / "vf-overlay.exe",
        Path("native") / "VfOverlay" / "build" / "vf-overlay.exe",
        Path("native") / "build" / "VfOverlay" / "Release" / "vf-overlay.exe",
        Path("native") / "build" / "VfOverlay" / "Debug" / "vf-overlay.exe",
        Path("native") / "build" / "vf-overlay.exe",
        Path("native") / "VfOverlay" / "build" / "dist" / "vf-overlay-win64" / "vf-overlay.exe",
    ):
        candidate = (root / rel).resolve()
        if candidate.is_file():
            return candidate
    return None


def find_vf_browser_server_exe(root: Path) -> Path | None:
    names = ("vf-browser-server.exe", "vf-browser-server")
    for name in names:
        for rel in (
            Path(name),
            Path("native") / "VfOverlay" / "build" / "Release" / name,
            Path("native") / "VfOverlay" / "build" / "Debug" / name,
            Path("native") / "VfOverlay" / "build" / name,
            Path("dist") / "releases" / "windows-overlay" / name,
            Path("dist") / "releases" / "linux-browser" / name,
            Path("dist") / "releases" / "macos-browser" / name,
        ):
            candidate = (root / rel).resolve()
            if candidate.is_file():
                return candidate
    return None


def find_free_port(prefer: int | None = None) -> int:
    if prefer is not None:
        try:
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", prefer))
                return prefer
        except OSError:
            pass
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def build_browser_helper_launch(
    *,
    serve_dir: Path,
    port: int,
    state_path: Path,
    platform_name: str,
    detached_process_flag: int = 0,
    new_process_group_flag: int = 0,
    no_window_flag: int = 0,
    browser_server_exe: Path | None = None,
    overlay_exe: Path | None = None,
) -> tuple[list[str], dict[str, object]]:
    kwargs: dict[str, object] = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if platform_name == "win32":
        flags = 0
        flags |= detached_process_flag
        flags |= new_process_group_flag
        flags |= no_window_flag
        kwargs["creationflags"] = flags
        if overlay_exe is not None:
            resolved_overlay = Path(overlay_exe).resolve()
            return [str(resolved_overlay), "--serve-only", "--port", str(int(port))], kwargs
    if browser_server_exe is not None:
        resolved_helper = Path(browser_server_exe).resolve()
        return [
            str(resolved_helper),
            "--serve-dir",
            str(serve_dir),
            "--port",
            str(int(port)),
            "--state-path",
            str(state_path),
        ], kwargs
    raise RuntimeError(
        "browser mode requires a native browser helper or overlay serve-only host; "
        "Python http.server fallback has been removed"
    )


__all__ = [
    "build_browser_helper_launch",
    "find_free_port",
    "find_vf_browser_server_exe",
    "find_vf_overlay_exe",
    "find_vektorflow_repo_root",
    "is_vektorflow_repo",
]
