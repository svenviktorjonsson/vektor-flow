"""UI launch — choose between overlay (native), browser (built-in HTTP server),
or headless (write JSON only).

Mode selection (highest priority wins):
  1. ``ui.set_mode("browser" | "overlay" | "headless")`` in vkf / Python
  2. ``VF_UI_MODE`` environment variable
  3. Auto-detect: Windows → "overlay", everything else → "browser"

Browser mode
  Starts a tiny stdlib http.server on a random free port (or ``VF_UI_PORT``),
  serving ``web/vf-ui/``.  The URL is printed once and the default browser is
  opened automatically.  The browser polls ``vf-display.json`` every 500 ms
  (handled by vkf-scene.html / vf-display.js) — no WebSocket needed.

Overlay mode (Windows only)
  Launches ``vf-overlay.exe`` exactly as before.

Headless mode
  Writes ``vf-display.json`` only; nothing is launched.  Useful for tests,
  CI, or embedding vektorflow inside another tool.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Literal

# ---------------------------------------------------------------------------
# Mode type
# ---------------------------------------------------------------------------

UIMode = Literal["overlay", "browser", "headless"]

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_launched = False
_browser_server: HTTPServer | None = None
_browser_thread: threading.Thread | None = None
_browser_port: int | None = None

# Forced mode — set by ui.set_mode() or $VF_UI_MODE.
# None means "auto-detect".
_forced_mode: UIMode | None = None

# Set True in pytest (conftest) so the suite never spawns any UI process.
_suppress_ui_auto_launch = False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def set_ui_mode(mode: str) -> None:
    """Override the UI mode programmatically (call before ``add_frame``)."""
    global _forced_mode, _launched
    m = str(mode).strip().lower()
    if m not in ("overlay", "browser", "headless"):
        raise ValueError(f"ui mode must be 'overlay', 'browser', or 'headless'; got {m!r}")
    _forced_mode = m  # type: ignore[assignment]
    # Reset so the new mode takes effect on the next _sync_all call.
    _launched = False


def get_ui_mode() -> UIMode:
    """Return the effective UI mode (forced > env > auto-detect)."""
    if _forced_mode is not None:
        return _forced_mode
    env = (os.environ.get("VF_UI_MODE") or "").strip().lower()
    if env in ("overlay", "browser", "headless"):
        return env  # type: ignore[return-value]
    # Auto-detect: prefer overlay on Windows (where the native host is built),
    # fall back to browser on macOS/Linux.
    return "overlay" if sys.platform == "win32" else "browser"


def get_browser_port() -> int | None:
    """Port the built-in HTTP server is listening on (None if not started)."""
    return _browser_port


def reset_launch_state() -> None:
    """Reset one-shot launch state (tests + mode switches)."""
    global _launched
    _launched = False


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _reset_ui_launch_for_tests() -> None:
    """Undo one-shot launch state (tests only)."""
    global _launched
    _launched = False


def ui_auto_launch_enabled() -> bool:
    """Whether the first ``add_frame`` may spawn the UI process."""
    return not _suppress_ui_auto_launch


def _vf_warn(msg: str) -> None:
    print(msg, file=sys.stderr)


def _vf_info(msg: str) -> None:
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


# ---------------------------------------------------------------------------
# Repo / binary discovery (unchanged)
# ---------------------------------------------------------------------------

def find_vektorflow_repo_root() -> Path | None:
    """Locate the vektor-flow repo (``web/vf-ui/index.html`` + ``native/VfOverlay``)."""
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
    return (
        (p / "web" / "vf-ui" / "index.html").is_file()
        and (p / "native" / "VfOverlay" / "CMakeLists.txt").is_file()
    )


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


# ---------------------------------------------------------------------------
# Browser mode — built-in HTTP server
# ---------------------------------------------------------------------------

def _find_free_port(prefer: int | None = None) -> int:
    """Return a free TCP port (prefer the given one if free)."""
    import socket

    if prefer is not None:
        try:
            with socket.socket() as s:
                s.bind(("127.0.0.1", prefer))
                return prefer
        except OSError:
            pass
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _QuietHandler(SimpleHTTPRequestHandler):
    """HTTP handler that suppresses per-request log lines."""

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass  # silence

    def log_error(self, format: str, *args: object) -> None:  # noqa: A002
        pass


def _start_browser_server(serve_dir: Path) -> tuple[int, threading.Thread]:
    """Start ``http.server`` in a daemon thread; return (port, thread)."""
    env_port = (os.environ.get("VF_UI_PORT") or "").strip()
    prefer = int(env_port) if env_port.isdigit() else None
    port = _find_free_port(prefer)

    handler = lambda *a, **kw: _QuietHandler(*a, directory=str(serve_dir), **kw)  # noqa: E731
    server = HTTPServer(("127.0.0.1", port), handler)

    t = threading.Thread(target=server.serve_forever, daemon=True, name="vf-browser-server")
    t.start()

    global _browser_server
    _browser_server = server
    return port, t


def maybe_launch_browser() -> None:
    """Start the built-in HTTP server and open the default browser (once per process)."""
    global _launched, _browser_thread, _browser_port

    if _launched or not ui_auto_launch_enabled():
        return
    _launched = True

    root = find_vektorflow_repo_root()
    if root is None:
        _vf_warn(
            "vektorflow [browser]: could not find repo root "
            "(need web/vf-ui/index.html). Set VF_UI_MODE=headless to suppress."
        )
        return

    serve_dir = root / "web" / "vf-ui"
    port, thread = _start_browser_server(serve_dir)
    _browser_port = port
    _browser_thread = thread

    url = f"http://127.0.0.1:{port}/vkf-scene.html"
    _vf_info(f"vektorflow [browser]: serving {serve_dir}")
    _vf_info(f"vektorflow [browser]: open  {url}")
    _log_launch_line(f"browser mode: serving {serve_dir} on port {port}")

    # Open browser — non-blocking; ignore failures (headless CI etc.)
    try:
        webbrowser.open(url)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Overlay mode (Windows native)
# ---------------------------------------------------------------------------

def maybe_launch_vf_overlay() -> None:
    """Fire-and-forget: run ``vf-overlay.exe`` (WebView2 composition host), once per process."""
    global _launched
    if _launched or not ui_auto_launch_enabled():
        return

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

    use_terminal = (os.environ.get("VF_UI_TERMINAL") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    popen_kwargs: dict[str, object] = {"cwd": str(exe.parent)}
    if not use_terminal:
        popen_kwargs["stdin"] = subprocess.DEVNULL
        popen_kwargs["stdout"] = subprocess.DEVNULL
        popen_kwargs["stderr"] = subprocess.DEVNULL

    try:
        subprocess.Popen([str(exe)], **popen_kwargs)
        _launched = True
        _log_launch_line("maybe_launch: Popen returned ok")
    except OSError as e:
        _log_launch_line(f"maybe_launch: Popen failed: {e!r}")
        _vf_warn(f"vektorflow: could not start vf-overlay: {e}")


# ---------------------------------------------------------------------------
# Unified entry point (called by Display._sync_all)
# ---------------------------------------------------------------------------

def maybe_launch_ui() -> None:
    """Dispatch to the right launch function based on the effective UI mode."""
    if not ui_auto_launch_enabled():
        return
    mode = get_ui_mode()
    if mode == "browser":
        maybe_launch_browser()
    elif mode == "overlay":
        maybe_launch_vf_overlay()
    # headless → do nothing
