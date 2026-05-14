"""UI launch — choose between overlay (native), browser (built-in HTTP server),
headless (write JSON only), or test (mocked UI seams only).

Mode selection (highest priority wins):
  1. ``ui.set_mode("browser" | "overlay" | "headless" | "test")`` in vkf / Python
  2. ``VF_UI_MODE`` environment variable
  3. Auto-detect: Windows → "overlay" (``vkf`` / apps default to the native host);
     non-Windows → "browser". If ``vf-overlay.exe`` is missing, launch warns and
     does nothing until you build ``native/VfOverlay`` or set ``VF_UI_MODE=browser``.

Repo root (for ``vf-display.json``, static assets, overlay exe):
  - ``VF_UI_REPO_ROOT`` if set to a directory containing ``web/vf-ui/``
  - else walk upward from cwd, then from this package, for ``web/vf-ui/index.html``
    and ``web/vf-ui/vkf-scene.html``

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

Test mode
  Uses the in-memory UI payload and event seams only. No browser server,
  overlay process, or event poller thread is started. Useful for deterministic
  example-driven tests that inject UI payloads directly.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import urllib.request
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Literal

# ---------------------------------------------------------------------------
# Mode type
# ---------------------------------------------------------------------------

UIMode = Literal["overlay", "browser", "headless", "test"]

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_launched = False
_overlay_launch_in_progress = False
_overlay_launch_failed: str | None = None
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
    global _forced_mode, _launched, _overlay_launch_in_progress, _overlay_launch_failed
    m = str(mode).strip().lower()
    if m not in ("overlay", "browser", "headless", "test"):
        raise ValueError(f"ui mode must be 'overlay', 'browser', 'headless', or 'test'; got {m!r}")
    _forced_mode = m  # type: ignore[assignment]
    # Reset so the new mode takes effect on the next _sync_all call.
    _launched = False
    _overlay_launch_in_progress = False
    _overlay_launch_failed = None


def get_ui_mode() -> UIMode:
    """Return the effective UI mode (forced > env > auto-detect)."""
    if _forced_mode is not None:
        return _forced_mode
    env = (os.environ.get("VF_UI_MODE") or "").strip().lower()
    if env in ("overlay", "browser", "headless", "test"):
        return env  # type: ignore[return-value]
    # Default: native overlay on Windows (vkf and embedded use same rule).
    return "overlay" if sys.platform == "win32" else "browser"


def get_browser_port() -> int | None:
    """Port the built-in HTTP server is listening on (None if not started)."""
    return _browser_port


def reset_launch_state() -> None:
    """Reset one-shot launch state (tests + mode switches)."""
    global _launched, _overlay_launch_in_progress, _overlay_launch_failed
    _launched = False
    _overlay_launch_in_progress = False
    _overlay_launch_failed = None
    _clear_overlay_state()
    try:
        from vektorflow.stdlib.events import reset_global_poller, reset_overlay_port

        reset_global_poller()
        reset_overlay_port()
    except Exception:
        pass
    try:
        from vektorflow.ui.session import reset_ui_session

        reset_ui_session()
    except Exception:
        pass
    try:
        from vektorflow.ui.payloads import reset_ui_payload_snapshot

        reset_ui_payload_snapshot()
    except Exception:
        pass
    try:
        from vektorflow.ui.runtime_packet_transport import (
            reset_ui_runtime_packet_transport,
        )

        reset_ui_runtime_packet_transport()
    except Exception:
        pass
    try:
        from vektorflow.ui.event_ingress import reset_ui_event_ingress

        reset_ui_event_ingress()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _reset_ui_launch_for_tests() -> None:
    """Undo one-shot launch state (tests only)."""
    global _launched, _overlay_launch_in_progress, _overlay_launch_failed
    _launched = False
    _overlay_launch_in_progress = False
    _overlay_launch_failed = None


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


def _overlay_trace_enabled() -> bool:
    raw = str(os.environ.get("VF_UI_TRACE_EVENTS", "") or "").strip().lower()
    return raw not in ("", "0", "false", "off", "no")


def _browser_state_path() -> Path:
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    return Path(base) / "vektor-flow" / "browser-server.json"


def _overlay_state_path() -> Path:
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    return Path(base) / "vektor-flow" / "overlay-process.json"


def _write_browser_state(port: int) -> None:
    try:
        p = _browser_state_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"port": int(port)}), encoding="utf-8")
    except OSError:
        pass


def _read_browser_state() -> int | None:
    try:
        data = json.loads(_browser_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    port = data.get("port")
    if isinstance(port, int) and port > 0:
        return port
    return None


def _read_overlay_state() -> dict[str, object] | None:
    try:
        data = json.loads(_overlay_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def _read_overlay_pid() -> int | None:
    data = _read_overlay_state()
    if not isinstance(data, dict):
        return None
    pid = data.get("pid")
    if isinstance(pid, int) and pid > 0:
        return pid
    return None


def _write_overlay_state(*, pid: int, exe: Path) -> None:
    try:
        p = _overlay_state_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(
            json.dumps(
                {
                    "pid": int(pid),
                    "exe": str(exe),
                }
            ),
            encoding="utf-8",
        )
    except OSError:
        pass


def _clear_overlay_state() -> None:
    try:
        _overlay_state_path().unlink(missing_ok=True)
    except OSError:
        pass


def _overlay_web_dir_for_exe(exe: Path) -> Path:
    return (exe.parent / "web").resolve()


def _overlay_port_file_for_exe(exe: Path) -> Path:
    return _overlay_web_dir_for_exe(exe) / "vf-api-port.txt"


def _clear_overlay_port_file(exe: Path) -> None:
    try:
        _overlay_port_file_for_exe(exe).unlink(missing_ok=True)
    except OSError:
        pass


def _read_overlay_port_from_exe(exe: Path) -> int:
    try:
        txt = _overlay_port_file_for_exe(exe).read_text(encoding="utf-8").strip()
    except OSError:
        return 0
    return int(txt) if txt.isdigit() else 0


def _probe_overlay_page_ready(port: int, page_rel: str) -> bool:
    rel = str(page_rel).lstrip("/")
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/{rel}", timeout=0.2) as r:
            return int(getattr(r, "status", 0) or 0) == 200
    except Exception:
        return False


def _wait_for_overlay_ready(
    *,
    exe: Path,
    proc: subprocess.Popen[bytes] | subprocess.Popen[str],
    page_rel: str,
    timeout_s: float = 3.0,
) -> int:
    import time

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        rc = proc.poll()
        if rc is not None:
            raise RuntimeError(
                f"vf-overlay exited before becoming ready (exit code {rc}). "
                "Check %LOCALAPPDATA%\\vektor-flow\\vf-overlay.log for host details."
            )
        port = _read_overlay_port_from_exe(exe)
        if port > 0 and _probe_overlay_page_ready(port, page_rel):
            return port
        threading.Event().wait(0.02)
    raise RuntimeError(
        "vf-overlay did not become ready in time. "
        "Expected vf-api-port.txt and a reachable session page beside the launched executable."
    )


def _terminate_previous_overlay(pid: int) -> None:
    if pid <= 0:
        return
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except OSError:
            pass
        return
    try:
        os.kill(pid, 15)
    except OSError:
        pass


def _probe_browser_server(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/vkf-scene.html", timeout=0.5) as r:
            return int(getattr(r, "status", 0) or 0) == 200
    except Exception:
        return False


def _running_under_pytest() -> bool:
    return "PYTEST_CURRENT_TEST" in os.environ


# ---------------------------------------------------------------------------
# Repo / binary discovery (unchanged)
# ---------------------------------------------------------------------------

def find_vektorflow_repo_root() -> Path | None:
    """Locate the tree that contains ``web/vf-ui`` (HTML/JS host for browser + JSON sync)."""
    env = (os.environ.get("VF_UI_REPO_ROOT") or "").strip()
    if env:
        p = Path(env).expanduser().resolve()
        if _is_vektorflow_repo(p):
            return p
        _vf_warn(
            f"vektorflow: VF_UI_REPO_ROOT={env!r} is not a vf-ui tree "
            "(expected web/vf-ui/index.html and web/vf-ui/vkf-scene.html)"
        )
    try:
        exe_root = Path(sys.executable).resolve().parent
        for base in (exe_root, *exe_root.parents):
            if _is_vektorflow_repo(base):
                return base
    except Exception:
        pass
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
    """True when the browser/headless/test UI bundle is on disk (native overlay is optional)."""
    ui = p / "web" / "vf-ui"
    return ui.joinpath("index.html").is_file() and ui.joinpath("vkf-scene.html").is_file()


def find_vf_overlay_exe(root: Path) -> Path | None:
    """Resolve ``vf-overlay.exe`` from either local build tree or packaged bundle."""
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


def _spawn_browser_server_process(serve_dir: Path) -> int:
    env_port = (os.environ.get("VF_UI_PORT") or "").strip()
    prefer = int(env_port) if env_port.isdigit() else _read_browser_state()
    port = _find_free_port(prefer)
    state_path = _browser_state_path()

    helper = """
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

serve_dir = sys.argv[1]
port = int(sys.argv[2])
state_path = Path(sys.argv[3])

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    def log_error(self, format, *args):
        pass

handler = lambda *a, **kw: QuietHandler(*a, directory=serve_dir, **kw)
server = ThreadingHTTPServer(("127.0.0.1", port), handler)
state_path.parent.mkdir(parents=True, exist_ok=True)
state_path.write_text(json.dumps({"port": port}), encoding="utf-8")
server.serve_forever()
""".strip()

    popen_kwargs: dict[str, object] = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        flags = 0
        flags |= getattr(subprocess, "DETACHED_PROCESS", 0)
        flags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        flags |= getattr(subprocess, "CREATE_NO_WINDOW", 0)
        popen_kwargs["creationflags"] = flags
    else:
        popen_kwargs["start_new_session"] = True

    subprocess.Popen(
        [sys.executable, "-u", "-c", helper, str(serve_dir), str(port), str(state_path)],
        **popen_kwargs,
    )

    for _ in range(20):
        if _probe_browser_server(port):
            _write_browser_state(port)
            return port
        threading.Event().wait(0.1)
    raise RuntimeError(f"browser helper did not start on port {port}")


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
            "(need web/vf-ui/index.html and web/vf-ui/vkf-scene.html). "
            "Set VF_UI_REPO_ROOT or VF_UI_MODE=headless|test to suppress."
        )
        return

    serve_dir = root / "web" / "vf-ui"
    from vektorflow.ui.session import ensure_ui_session

    session = ensure_ui_session(root)
    if _running_under_pytest():
        port, thread = _start_browser_server(serve_dir)
        _browser_port = port
        _browser_thread = thread
    else:
        port = _read_browser_state()
        if port is None or not _probe_browser_server(port):
            try:
                port = _spawn_browser_server_process(serve_dir)
            except RuntimeError as e:
                _vf_warn(f"vektorflow [browser]: {e}")
                return
        _browser_port = port

    url = f"http://127.0.0.1:{port}/{session.page_rel}"
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
    """Launch ``vf-overlay.exe`` through one authoritative seam and fail fast on mismatch."""
    global _launched, _overlay_launch_in_progress, _overlay_launch_failed
    if _launched or _overlay_launch_in_progress or _overlay_launch_failed is not None or not ui_auto_launch_enabled():
        return
    _overlay_launch_in_progress = True
    proc: subprocess.Popen[bytes] | subprocess.Popen[str] | None = None
    try:
        from vektorflow.stdlib.events import reset_overlay_port

        reset_overlay_port()
    except Exception:
        pass

    try:
        root = find_vektorflow_repo_root()
        if root is None:
            raise RuntimeError(
                "UI not started: could not find vektor-flow tree "
                "(expect web/vf-ui/index.html and web/vf-ui/vkf-scene.html). "
                "Set VF_UI_REPO_ROOT explicitly."
            )
        _log_launch_line(f"maybe_launch: repo root {root}")

        exe = find_vf_overlay_exe(root)
        if exe is None:
            raise RuntimeError(
                "UI not started: vf-overlay.exe not found. "
                "Build native/VfOverlay (.\\scripts\\build-vf-overlay.ps1)."
            )
        _log_launch_line(f"maybe_launch: launching {exe} cwd={exe.parent}")

        overlay_web_dir = _overlay_web_dir_for_exe(exe)
        if not overlay_web_dir.is_dir():
            raise RuntimeError(
                f"UI not started: expected overlay web root next to executable: {overlay_web_dir}"
            )
        if not (overlay_web_dir / "vkf-scene.html").is_file():
            raise RuntimeError(
                f"UI not started: overlay web root missing vkf-scene.html: {overlay_web_dir}"
            )

        use_terminal = (os.environ.get("VF_UI_TERMINAL") or "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        from vektorflow.ui.session import ensure_ui_session

        session = ensure_ui_session(root)
        overlay_page = (overlay_web_dir / "sessions" / session.session_id / "vkf-scene.html").resolve()
        if not overlay_page.is_file():
            raise RuntimeError(
                f"UI not started: staged overlay session page missing for launched executable: {overlay_page}"
            )

        previous_pid = _read_overlay_pid()
        if previous_pid is not None:
            _log_launch_line(f"maybe_launch: terminating prior vf-overlay pid={previous_pid}")
            _terminate_previous_overlay(previous_pid)
        _clear_overlay_port_file(exe)

        popen_kwargs: dict[str, object] = {"cwd": str(exe.parent)}
        if not use_terminal:
            popen_kwargs["stdin"] = subprocess.DEVNULL
            popen_kwargs["stdout"] = subprocess.DEVNULL
            popen_kwargs["stderr"] = subprocess.DEVNULL
        if _overlay_trace_enabled():
            env = dict(os.environ)
            env["VF_OVERLAY_ENQUEUE_LOG"] = "1"
            popen_kwargs["env"] = env

        # vf-overlay serves files relative to its adjacent web/ directory.
        # Passing an absolute Windows path becomes an unservable HTTP path
        # such as /C:/Users/... and WebView2 reports navigation failure.
        proc = subprocess.Popen([str(exe), session.page_rel], **popen_kwargs)
        if getattr(proc, "pid", 0):
            _write_overlay_state(pid=int(proc.pid), exe=exe)
        _log_launch_line("maybe_launch: Popen returned ok")
        port = _wait_for_overlay_ready(exe=exe, proc=proc, page_rel=session.page_rel)
        _log_launch_line(f"maybe_launch: overlay ready on port {port}")
        _overlay_launch_failed = None
        _launched = True
    except (OSError, RuntimeError) as e:
        if proc is not None:
            try:
                proc.kill()
            except Exception:
                pass
        _launched = False
        _overlay_launch_failed = str(e)
        _clear_overlay_state()
        _log_launch_line(f"maybe_launch: failed: {e!r}")
        _vf_warn(f"vektorflow: {e}")
    finally:
        _overlay_launch_in_progress = False


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
    # headless/test → do nothing
