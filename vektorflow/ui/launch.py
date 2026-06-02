"""UI launch — choose between overlay (native), browser (native static-file helper),
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
  Starts a native static-file helper on a random free port (or ``VF_UI_PORT``),
  serving ``web/vf-ui/``. The URL is printed once and the default browser is
  opened automatically. The browser polls ``vf-display.json`` every 500 ms
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
import time
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from vektorflow.ui.host_process import (
    browser_state_path as _process_browser_state_path,
    probe_browser_server as _process_probe_browser_server,
    probe_overlay_page_ready as _process_probe_overlay_page_ready,
    read_browser_state as _process_read_browser_state,
    terminate_previous_overlay as _process_terminate_previous_overlay,
    wait_for_overlay_ready as _process_wait_for_overlay_ready,
    wait_for_process_exit as _process_wait_for_process_exit,
    write_browser_state as _process_write_browser_state,
)
from vektorflow.ui.launch_contract import (
    build_browser_helper_launch as _contract_build_browser_helper_launch,
    find_free_port as _contract_find_free_port,
    find_vf_browser_server_exe as _contract_find_vf_browser_server_exe,
    find_vf_overlay_exe as _contract_find_vf_overlay_exe,
    find_vektorflow_repo_root as _contract_find_vektorflow_repo_root,
    is_vektorflow_repo as _contract_is_vektorflow_repo,
)
from vektorflow.ui.overlay_host_contract import (
    clear_overlay_port_file as _contract_clear_overlay_port_file,
    clear_overlay_state as _contract_clear_overlay_state,
    overlay_port_file_for_exe as _contract_overlay_port_file_for_exe,
    overlay_state_path as _contract_overlay_state_path,
    overlay_web_dir_for_exe as _contract_overlay_web_dir_for_exe,
    read_overlay_pid as _contract_read_overlay_pid,
    read_overlay_port_from_exe as _contract_read_overlay_port_from_exe,
    read_overlay_state as _contract_read_overlay_state,
    write_overlay_state as _contract_write_overlay_state,
)
from vektorflow.ui.runtime_boot import (
    build_browser_launch_plan as _boot_build_browser_launch_plan,
    build_overlay_launch_plan as _boot_build_overlay_launch_plan,
)

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
    """Append one line to %LOCALAPPDATA%\\vektor-flow\\vf-launch.log (diagnostics)."""
    try:
        base = os.environ.get("LOCALAPPDATA", "")
        if not base:
            return
        p = Path(base) / "vektor-flow" / "vf-launch.log"
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
    return _process_browser_state_path()


def _overlay_state_path() -> Path:
    return _contract_overlay_state_path()


def _write_browser_state(port: int) -> None:
    _process_write_browser_state(port)


def _read_browser_state() -> int | None:
    return _process_read_browser_state()


def _read_overlay_state() -> dict[str, object] | None:
    return _contract_read_overlay_state()


def _read_overlay_pid() -> int | None:
    return _contract_read_overlay_pid()


def _write_overlay_state(*, pid: int, exe: Path) -> None:
    _contract_write_overlay_state(pid=pid, exe=exe)


def _clear_overlay_state() -> None:
    _contract_clear_overlay_state()


def _overlay_web_dir_for_exe(exe: Path) -> Path:
    return _contract_overlay_web_dir_for_exe(exe)


def _overlay_port_file_for_exe(exe: Path) -> Path:
    return _contract_overlay_port_file_for_exe(exe)


def _clear_overlay_port_file(exe: Path) -> None:
    _contract_clear_overlay_port_file(exe)


def _read_overlay_port_from_exe(exe: Path) -> int:
    return _contract_read_overlay_port_from_exe(exe)


def _probe_overlay_page_ready(port: int, page_rel: str) -> bool:
    return _process_probe_overlay_page_ready(port, page_rel)


def _wait_for_overlay_ready(
    *,
    exe: Path,
    proc: subprocess.Popen[bytes] | subprocess.Popen[str],
    page_rel: str,
    timeout_s: float = 3.0,
) -> int:
    return _process_wait_for_overlay_ready(
        exe=exe,
        proc=proc,
        page_rel=page_rel,
        timeout_s=timeout_s,
        read_port_from_exe=_read_overlay_port_from_exe,
        probe_overlay_page_ready=_probe_overlay_page_ready,
        wait_fn=lambda seconds: threading.Event().wait(seconds),
    )


def _terminate_previous_overlay(pid: int) -> None:
    _process_terminate_previous_overlay(
        pid,
        platform_name=sys.platform,
        run_fn=subprocess.run,
        kill_fn=os.kill,
        wait_for_process_exit_fn=lambda target_pid, timeout_s: _wait_for_process_exit(target_pid, timeout_s=timeout_s),
        sleep_fn=time.sleep,
    )


def _wait_for_process_exit(pid: int, *, timeout_s: float) -> None:
    _process_wait_for_process_exit(
        pid,
        timeout_s=timeout_s,
        platform_name=sys.platform,
        run_fn=subprocess.run,
        kill_fn=os.kill,
        sleep_fn=time.sleep,
    )


def _probe_browser_server(port: int) -> bool:
    return _process_probe_browser_server(port)


# ---------------------------------------------------------------------------
# Repo / binary discovery (unchanged)
# ---------------------------------------------------------------------------

def find_vektorflow_repo_root() -> Path | None:
    """Locate the tree that contains ``web/vf-ui`` (HTML/JS host for browser + JSON sync)."""
    package_file: Path | None = None
    try:
        import vektorflow as _vf

        package_file = Path(_vf.__file__).resolve()
    except Exception:
        package_file = None
    root = _contract_find_vektorflow_repo_root(
        env_root=os.environ.get("VF_UI_REPO_ROOT") or "",
        cwd=Path.cwd(),
        module_file=Path(__file__),
        sys_executable=Path(sys.executable),
        package_file=package_file,
    )
    env = (os.environ.get("VF_UI_REPO_ROOT") or "").strip()
    if root is None and env:
        _vf_warn(
            f"vektorflow: VF_UI_REPO_ROOT={env!r} is not a vf-ui tree "
            "(expected web/vf-ui/index.html and web/vf-ui/vkf-scene.html)"
        )
    return root


def _is_vektorflow_repo(p: Path) -> bool:
    """True when the browser/headless/test UI bundle is on disk (native overlay is optional)."""
    return _contract_is_vektorflow_repo(p)


def find_vf_overlay_exe(root: Path) -> Path | None:
    """Resolve ``vf-overlay.exe`` from either local build tree or packaged bundle."""
    return _contract_find_vf_overlay_exe(root)


def find_vf_browser_server_exe(root: Path) -> Path | None:
    """Resolve the native browser helper from either local build tree or packaged bundle."""
    return _contract_find_vf_browser_server_exe(root)


# ---------------------------------------------------------------------------
# Browser mode — native static-file helper
# ---------------------------------------------------------------------------

def _find_free_port(prefer: int | None = None) -> int:
    """Return a free TCP port (prefer the given one if free)."""
    return _contract_find_free_port(prefer)


def _spawn_browser_server_process(root: Path, serve_dir: Path) -> int:
    env_port = (os.environ.get("VF_UI_PORT") or "").strip()
    prefer = int(env_port) if env_port.isdigit() else _read_browser_state()
    port = _find_free_port(prefer)
    state_path = _browser_state_path()
    overlay_exe = None
    browser_server_exe = find_vf_browser_server_exe(root)
    if sys.platform == "win32":
        overlay_exe = find_vf_overlay_exe(root)
    command, popen_kwargs = _contract_build_browser_helper_launch(
        serve_dir=serve_dir,
        port=port,
        state_path=state_path,
        platform_name=sys.platform,
        detached_process_flag=getattr(subprocess, "DETACHED_PROCESS", 0),
        new_process_group_flag=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        no_window_flag=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        browser_server_exe=browser_server_exe,
        overlay_exe=overlay_exe,
    )
    subprocess.Popen(command, **popen_kwargs)

    for _ in range(20):
        if _probe_browser_server(port):
            _write_browser_state(port)
            return port
        threading.Event().wait(0.1)
    raise RuntimeError(f"browser helper did not start on port {port}")


def maybe_launch_browser() -> None:
    """Start the native browser helper and open the default browser (once per process)."""
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
    port = _read_browser_state()
    if port is None or not _probe_browser_server(port):
        try:
            port = _spawn_browser_server_process(root, serve_dir)
        except RuntimeError as e:
            _vf_warn(f"vektorflow [browser]: {e}")
            return
    _browser_port = port
    browser_plan = _boot_build_browser_launch_plan(root=root, session=session, port=port)

    url = browser_plan.url
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
        from vektorflow.ui.display_runtime import _sync_display_runtime_assets
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
        overlay_plan = _boot_build_overlay_launch_plan(root=root, exe=exe, session=session)

        previous_pid = _read_overlay_pid()
        if previous_pid is not None:
            _log_launch_line(f"maybe_launch: terminating prior vf-overlay pid={previous_pid}")
            _terminate_previous_overlay(previous_pid)
        _log_launch_line("maybe_launch: syncing overlay runtime assets")
        _sync_display_runtime_assets(root, strict=True)
        _clear_overlay_port_file(exe)

        popen_kwargs: dict[str, object] = {"cwd": str(overlay_plan.cwd)}
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
        proc = subprocess.Popen(overlay_plan.argv, **popen_kwargs)
        if getattr(proc, "pid", 0):
            _write_overlay_state(pid=int(proc.pid), exe=exe)
        _log_launch_line("maybe_launch: Popen returned ok")
        port = _wait_for_overlay_ready(exe=exe, proc=proc, page_rel=overlay_plan.page_rel)
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
