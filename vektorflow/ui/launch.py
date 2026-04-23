"""Start the vf-overlay UI (WebView2 + DirectComposition) when a frame is added."""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

_launched = False
# Set True in pytest (conftest) so the suite never spawns the native UI process.
_suppress_ui_auto_launch = False


def _reset_ui_launch_for_tests() -> None:
    """Undo one-shot launch state (tests only)."""
    global _launched
    _launched = False


def ui_auto_launch_enabled() -> bool:
    """Whether the first ``add_frame`` may spawn the UI process."""
    return not _suppress_ui_auto_launch


def _vf_warn(msg: str) -> None:
    print(msg, file=sys.stderr)


def _log_launch_line(msg: str) -> None:
    """Append one line to %LOCALAPPDATA%\\vektor-flow\\python-vf-launch.log (diagnostics)."""
    try:
        base = os.environ.get("LOCALAPPDATA", "")
        if not base:
            return
        p = Path(base) / "vektor-flow" / "python-vf-launch.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with p.open("a", encoding="utf-8") as f:
            f.write(f"{ts} {msg}\n")
    except OSError:
        pass


def find_vektorflow_repo_root() -> Path | None:
    """Locate the vektor-flow repo (``web/vf-ui/index.html`` + ``native/VfOverlay``)."""
    # Prefer walking up from cwd (e.g. ``vkf`` run from ``examples/``) before package install paths.
    cur = Path.cwd().resolve()
    for _ in range(40):
        if _is_vektorflow_repo(cur):
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    for base in Path(__file__).resolve().parents:
        if _is_vektorflow_repo(base):
            return base
    try:
        import vektorflow as _vf

        p = Path(_vf.__file__).resolve().parent
        for _ in range(24):
            if _is_vektorflow_repo(p):
                return p
            if p.parent == p:
                break
            p = p.parent
    except Exception:
        pass
    return None


def _is_vektorflow_repo(p: Path) -> bool:
    return (p / "web" / "vf-ui" / "index.html").is_file() and (p / "native" / "VfOverlay" / "CMakeLists.txt").is_file()


def find_vf_overlay_exe(root: Path) -> Path | None:
    """Resolve ``vf-overlay.exe`` (built under ``native/VfOverlay/build/...``)."""
    for rel in (
        Path("native") / "VfOverlay" / "build" / "Release" / "vf-overlay.exe",
        Path("native") / "VfOverlay" / "build" / "Debug" / "vf-overlay.exe",
        Path("native") / "VfOverlay" / "build" / "x64" / "Release" / "vf-overlay.exe",
        Path("native") / "VfOverlay" / "build" / "x64" / "Debug" / "vf-overlay.exe",
        Path("native") / "VfOverlay" / "build" / "vf-overlay.exe",
    ):
        c = (root / rel).resolve()
        if c.is_file():
            return c
    return None


def maybe_launch_vf_overlay() -> None:
    """Fire-and-forget: run ``vf-overlay.exe`` (WebView2 composition host), once per process."""
    global _launched
    if _launched or not ui_auto_launch_enabled():
        return
    _launched = True

    root = find_vektorflow_repo_root()
    if root is None:
        _log_launch_line("maybe_launch: repo root not found (cwd and package walk failed)")
        _vf_warn(
            "vektorflow: UI not started: could not find vektor-flow repo "
            "(expect web/vf-ui/index.html and native/VfOverlay/CMakeLists.txt)."
        )
        return
    _log_launch_line(f"maybe_launch: repo root {root}")

    exe = find_vf_overlay_exe(root)
    if exe is None:
        _log_launch_line("maybe_launch: vf-overlay.exe not found under native/VfOverlay/build/...")
        _vf_warn(
            "vektorflow: UI not started: vf-overlay.exe not found. Build native/VfOverlay "
            "(.\\scripts\\build-vf-overlay.ps1) so the executable exists under that tree."
        )
        return
    _log_launch_line(f"maybe_launch: launching {exe} cwd={exe.parent}")

    try:
        subprocess.Popen(
            [str(exe)],
            cwd=str(exe.parent),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _log_launch_line("maybe_launch: Popen returned ok")
    except OSError as e:
        _log_launch_line(f"maybe_launch: Popen failed: {e!r}")
        _vf_warn(f"vektorflow: could not start vf-overlay: {e}")
