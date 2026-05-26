from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable

from .errors import EvalError, LexError, ParseError, format_source_diagnostic
from .native_overlay_scene_bundle import NativeOverlaySceneProgram
from .native_overlay_scene_frontend import (
    try_build_native_overlay_scene_program,
    try_build_native_overlay_scene_program_from_contract_path,
)
from .ui.file_io import write_text_if_changed


DEFAULT_REQUIRED_NATIVE_SCENE_ASSETS = (
    "vf-runtime-shell.js",
    "vf-runtime-source.js",
    "vf-runtime-scene.js",
    "vf-runtime-flow.js",
    "vf-native-scene-face-edge-vertex.js",
    "vf-native-scene-cube-hover.js",
    "vf-native-scene.js",
    "vf-native-scene-dimension-mix.js",
    "vf-native-scene-ocean.js",
    "vf-display.js",
    "vf-frame.css",
    "vf-frame.js",
    "vf-widgets.js",
    "geom/vf-geom-math.js",
    "geom/vf-geom-core.js",
    "geom/vf-geom-frame-adapter.js",
    "geom/vf-geom-wgpu.js",
    "geom/vf-geom-ledger.js",
    "geom/vf-geom-ledger-layout.js",
    "geom/vf-geom-ledger-transport.js",
)

_VERSION_QUERY_RE = re.compile(r"\?v=\d+")


def _seed_runtime_dir(runtime_dir: Path, packets_text: str) -> None:
    runtime_dir.mkdir(parents=True, exist_ok=True)
    write_text_if_changed(runtime_dir / "vf-runtime-packets.json", packets_text)
    write_text_if_changed(runtime_dir / "vf-display.json", '{\n  "screen": [],\n  "frames": {},\n  "geom": {}\n}\n')
    write_text_if_changed(runtime_dir / "vkf-scene.json", "[]\n")
    write_text_if_changed(runtime_dir / "vf-ui-state.json", "{}\n")


def _stage_program_session(program: NativeOverlaySceneProgram, *session_dirs: Path) -> None:
    session_html = _VERSION_QUERY_RE.sub(f"?v={time.time_ns()}", program.html_text)
    for session_dir in session_dirs:
        session_dir.mkdir(parents=True, exist_ok=True)
        write_text_if_changed(session_dir / "vkf-scene.html", session_html)
        write_text_if_changed(session_dir / "vf-runtime-packets.json", program.runtime_packets_text)
        if program.geom_transport_text:
            write_text_if_changed(session_dir / "vf-geom-ledger-transport.json", program.geom_transport_text)
        if program.geom_state_text:
            write_text_if_changed(session_dir / "vf-geom-ledger-state.json", program.geom_state_text)
        if program.event_program_text:
            write_text_if_changed(session_dir / "vf-event-program.json", program.event_program_text)
        else:
            (session_dir / "vf-event-program.json").unlink(missing_ok=True)


def launch_native_overlay_scene_program(
    program: NativeOverlaySceneProgram,
    *,
    root: Path,
    exe: Path,
    sync_display_runtime_assets: Callable[[Path], None],
    required_assets: tuple[str, ...] = DEFAULT_REQUIRED_NATIVE_SCENE_ASSETS,
    reset_overlay_port: Callable[[], None],
    read_overlay_pid: Callable[[], int | None],
    terminate_previous_overlay: Callable[[int], None],
    clear_overlay_port_file: Callable[[Path], None],
    write_overlay_state: Callable[..., None],
    wait_for_overlay_ready: Callable[..., int],
    overlay_web_dir_for_exe: Callable[[Path], Path] | None = None,
    popen: Callable[..., Any] = subprocess.Popen,
    trace_enabled: bool = False,
    use_terminal: bool = False,
) -> int:
    resolved_root = Path(root).resolve()
    resolved_exe = Path(exe).resolve()
    if overlay_web_dir_for_exe is None:
        from .ui.overlay_host_contract import overlay_web_dir_for_exe as _overlay_web_dir_for_exe

        overlay_web_dir_for_exe = _overlay_web_dir_for_exe
    overlay_web_dir = overlay_web_dir_for_exe(resolved_exe)

    sync_display_runtime_assets(resolved_root)
    missing_assets = [asset for asset in required_assets if not (overlay_web_dir / asset).is_file()]
    if missing_assets:
        missing = ", ".join(missing_assets)
        raise RuntimeError(
            "UI not started: built overlay web runtime is missing required "
            f"native scene asset(s): {missing}. Rebuild native/VfOverlay."
        )

    repo_session_dir = resolved_root / "web" / "vf-ui" / "sessions" / program.session_name
    overlay_session_dir = overlay_web_dir / "sessions" / program.session_name
    _stage_program_session(program, repo_session_dir, overlay_session_dir)

    _seed_runtime_dir(resolved_root / "web" / "vf-ui", program.runtime_packets_text)
    _seed_runtime_dir(overlay_web_dir, program.runtime_packets_text)
    if program.event_program_text:
        write_text_if_changed(resolved_root / "web" / "vf-ui" / "vf-event-program.json", program.event_program_text)
        write_text_if_changed(overlay_web_dir / "vf-event-program.json", program.event_program_text)
    else:
        (resolved_root / "web" / "vf-ui" / "vf-event-program.json").unlink(missing_ok=True)
        (overlay_web_dir / "vf-event-program.json").unlink(missing_ok=True)

    reset_overlay_port()
    previous_pid = read_overlay_pid()
    if previous_pid is not None:
        terminate_previous_overlay(previous_pid)
    clear_overlay_port_file(resolved_exe)

    popen_kwargs: dict[str, object] = {"cwd": str(resolved_exe.parent)}
    if not use_terminal:
        popen_kwargs["stdin"] = subprocess.DEVNULL
        popen_kwargs["stdout"] = subprocess.DEVNULL
        popen_kwargs["stderr"] = subprocess.DEVNULL
    if trace_enabled:
        env = dict(os.environ)
        env["VF_OVERLAY_ENQUEUE_LOG"] = "1"
        popen_kwargs["env"] = env

    proc = popen([str(resolved_exe), program.page_rel], **popen_kwargs)
    if getattr(proc, "pid", 0):
        write_overlay_state(pid=int(proc.pid), exe=resolved_exe)
    wait_for_overlay_ready(exe=resolved_exe, proc=proc, page_rel=program.page_rel)
    return 0


def try_run_native_overlay_scene(
    path: Path,
    *,
    build_program: Callable[[Path], NativeOverlaySceneProgram | None] = try_build_native_overlay_scene_program,
) -> int | None:
    try:
        program = build_program(path)
    except (LexError, ParseError, EvalError) as exc:
        try:
            source = path.resolve().read_text(encoding="utf-8")
        except OSError:
            source = ""
        print(format_source_diagnostic(source, exc), file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: native overlay scene build failed: {exc}", file=sys.stderr)
        return 1

    if program is None:
        return None

    try:
        from .stdlib.events import reset_overlay_port
        from .ui.display_runtime import _sync_display_runtime_assets
        from .ui.host_process import terminate_previous_overlay, wait_for_overlay_ready
        from .ui.launch import (
            _clear_overlay_port_file,
            _clear_overlay_state,
            _overlay_trace_enabled,
            _read_overlay_pid,
            _vf_warn,
            find_vektorflow_repo_root,
            find_vf_overlay_exe,
        )
        from .ui.overlay_host_contract import overlay_web_dir_for_exe, write_overlay_state

        root = find_vektorflow_repo_root()
        if root is None:
            raise RuntimeError(
                "UI not started: could not find vektor-flow tree "
                "(expect web/vf-ui/index.html and web/vf-ui/vkf-scene.html). "
                "Set VF_UI_REPO_ROOT explicitly."
            )

        exe = find_vf_overlay_exe(root)
        if exe is None:
            raise RuntimeError(
                "UI not started: vf-overlay.exe not found. "
                "Build native/VfOverlay (.\\scripts\\build-vf-overlay.ps1)."
            )

        use_terminal = (os.environ.get("VF_UI_TERMINAL") or "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        return launch_native_overlay_scene_program(
            program,
            root=root,
            exe=exe,
            sync_display_runtime_assets=lambda current_root: _sync_display_runtime_assets(current_root),
            reset_overlay_port=reset_overlay_port,
            read_overlay_pid=_read_overlay_pid,
            terminate_previous_overlay=terminate_previous_overlay,
            clear_overlay_port_file=_clear_overlay_port_file,
            write_overlay_state=write_overlay_state,
            wait_for_overlay_ready=wait_for_overlay_ready,
            overlay_web_dir_for_exe=overlay_web_dir_for_exe,
            trace_enabled=_overlay_trace_enabled(),
            use_terminal=use_terminal,
        )
    except (OSError, RuntimeError) as exc:
        try:
            from .ui.launch import _clear_overlay_state, _vf_warn

            _clear_overlay_state()
            _vf_warn(f"vektorflow: {exc}")
        except Exception:
            pass
        print(f"error: {exc}", file=sys.stderr)
        return 1


def try_run_native_overlay_scene_contract(
    path: Path,
    *,
    build_program: Callable[[Path], NativeOverlaySceneProgram] = try_build_native_overlay_scene_program_from_contract_path,
    launch_program: Callable[..., int] = launch_native_overlay_scene_program,
) -> int | None:
    resolved = Path(path).resolve()
    try:
        program = build_program(resolved)
    except Exception as exc:
        print(f"error: native overlay scene contract build failed: {exc}", file=sys.stderr)
        return 1

    try:
        from .stdlib.events import reset_overlay_port
        from .ui.display_runtime import _sync_display_runtime_assets
        from .ui.host_process import terminate_previous_overlay, wait_for_overlay_ready
        from .ui.launch import (
            _clear_overlay_port_file,
            _clear_overlay_state,
            _overlay_trace_enabled,
            _read_overlay_pid,
            _vf_warn,
            find_vektorflow_repo_root,
            find_vf_overlay_exe,
        )
        from .ui.overlay_host_contract import overlay_web_dir_for_exe, write_overlay_state

        root = find_vektorflow_repo_root()
        if root is None:
            raise RuntimeError(
                "UI not started: could not find vektor-flow tree "
                "(expect web/vf-ui/index.html and web/vf-ui/vkf-scene.html). "
                "Set VF_UI_REPO_ROOT explicitly."
            )

        exe = find_vf_overlay_exe(root)
        if exe is None:
            raise RuntimeError(
                "UI not started: vf-overlay.exe not found. "
                "Build native/VfOverlay (.\\scripts\\build-vf-overlay.ps1)."
            )

        use_terminal = (os.environ.get("VF_UI_TERMINAL") or "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        return launch_program(
            program,
            root=root,
            exe=exe,
            sync_display_runtime_assets=lambda current_root: _sync_display_runtime_assets(current_root),
            reset_overlay_port=reset_overlay_port,
            read_overlay_pid=_read_overlay_pid,
            terminate_previous_overlay=terminate_previous_overlay,
            clear_overlay_port_file=_clear_overlay_port_file,
            write_overlay_state=write_overlay_state,
            wait_for_overlay_ready=wait_for_overlay_ready,
            overlay_web_dir_for_exe=overlay_web_dir_for_exe,
            trace_enabled=_overlay_trace_enabled(),
            use_terminal=use_terminal,
        )
    except (OSError, RuntimeError) as exc:
        try:
            from .ui.launch import _clear_overlay_state, _vf_warn

            _clear_overlay_state()
            _vf_warn(f"vektorflow: {exc}")
        except Exception:
            pass
        print(f"error: {exc}", file=sys.stderr)
        return 1


__all__ = [
    "DEFAULT_REQUIRED_NATIVE_SCENE_ASSETS",
    "launch_native_overlay_scene_program",
    "try_run_native_overlay_scene_contract",
    "try_run_native_overlay_scene",
]
