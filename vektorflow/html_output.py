from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import tempfile
from typing import Any

from . import ast
from .interpreter import Interpreter
from .native_overlay_scene_bundle import NativeOverlaySceneProgram
from .native_overlay_scene_frontend import try_build_native_overlay_scene_program
from .parser import parse_module
from .ui.display_runtime import build_display_payload


HTML_OUTPUT_MANIFEST = "vektorflow-html-output.json"
HTML_OUTPUT_KIND = "vektorflow-html-output"


class NoHtmlOutputError(RuntimeError):
    """Raised when a valid VKF program has no vf-ui/browser surface."""


@dataclass(frozen=True)
class HtmlOutputBundle:
    output_dir: Path
    entrypoint: str
    mode: str
    manifest_path: Path


def export_html_output(source_path: Path, output_dir: Path) -> HtmlOutputBundle:
    source = source_path.resolve()
    target = output_dir.resolve()
    program = try_build_native_overlay_scene_program(source)
    display_payload: tuple[str, str] | None = None
    mode = "native_scene"

    if program is None:
        display_payload = _build_display_payload(source, _repository_root() / "web" / "vf-ui")
        if display_payload is None:
            raise NoHtmlOutputError(f"{source.name} does not declare a vf-ui display or native_scene output")
        mode = "display"

    ui_root = _repository_root() / "web" / "vf-ui"
    if not (ui_root / "vkf-scene.html").is_file():
        raise RuntimeError(f"vf-ui runtime is unavailable at {ui_root}")

    _prepare_output_dir(target)
    shutil.copytree(ui_root, target, dirs_exist_ok=True, ignore=_runtime_copy_ignore)

    if program is not None:
        _write_native_scene_output(target, program)
    else:
        assert display_payload is not None
        scene_json, display_json = display_payload
        (target / "vkf-scene.json").write_text(scene_json, encoding="utf-8")
        (target / "vf-display.json").write_text(display_json, encoding="utf-8")
        (target / "vf-ui-state.json").write_text("{}\n", encoding="utf-8")

    manifest = {
        "schema_version": 1,
        "kind": HTML_OUTPUT_KIND,
        "language": "vektorflow",
        "source": source.name,
        "mode": mode,
        "entrypoint": "vkf-scene.html",
        "runtime": "vf-ui",
    }
    manifest_path = target / HTML_OUTPUT_MANIFEST
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return HtmlOutputBundle(
        output_dir=target,
        entrypoint="vkf-scene.html",
        mode=mode,
        manifest_path=manifest_path,
    )


def _repository_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _prepare_output_dir(target: Path) -> None:
    if target.exists() and any(target.iterdir()):
        manifest_path = target / HTML_OUTPUT_MANIFEST
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                f"refusing to replace non-Vektor Flow output directory: {target}"
            ) from exc
        if manifest.get("kind") != HTML_OUTPUT_KIND:
            raise RuntimeError(f"refusing to replace non-Vektor Flow output directory: {target}")
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)


def _runtime_copy_ignore(directory: str, names: list[str]) -> set[str]:
    ignored = {
        "sessions",
        "vf-api-port.txt",
        "vf-display.json",
        "vf-event-program.json",
        "vf-geom-ledger-state.json",
        "vf-geom-ledger-transport.json",
        "vf-runtime-packets.json",
        "vf-ui-state.json",
        "vkf-scene.json",
    }
    return {name for name in names if name in ignored}


def _build_display_payload(source_path: Path, ui_root: Path) -> tuple[str, str] | None:
    source = source_path.read_text(encoding="utf-8")
    module = parse_module(source, str(source_path))
    if not _imports_ui(module):
        return None
    with _isolated_ui_build_root(ui_root):
        interpreter = Interpreter(source_path)
        interpreter.run_module(module)

    display = interpreter.globals.get("d")
    if not _is_display(display):
        displays = [value for value in interpreter.globals.values() if _is_display(value)]
        if len(displays) != 1:
            return None
        display = displays[0]

    scene_json = display.dumps()
    if hasattr(display, "display_json"):
        display_json = display.display_json()
    else:
        payload: dict[str, Any] = build_display_payload(
            screen_ops=list(getattr(display, "_screen_ops", [])),
            screen_repr_ops=dict(getattr(display, "_screen_repr_ops", {})),
            frame_ops=dict(getattr(display, "_frame_ops", {})),
            frame_repr_ops=dict(getattr(display, "_frame_repr_ops", {})),
            geom=dict(getattr(display, "_geom", {})),
        )
        display_json = json.dumps(payload, indent=2) + "\n"
    return scene_json, display_json


@contextmanager
def _isolated_ui_build_root(ui_root: Path):
    """Keep compiler-time UI writes and launch state out of the source checkout."""
    from .ui import launch

    previous_repo_root = os.environ.get("VF_UI_REPO_ROOT")
    previous_suppressed = launch._suppress_ui_auto_launch
    previous_forced_mode = launch._forced_mode
    with tempfile.TemporaryDirectory(prefix="vektorflow-html-output-") as temp_dir:
        isolated_root = Path(temp_dir)
        shutil.copytree(ui_root, isolated_root / "web" / "vf-ui")
        os.environ["VF_UI_REPO_ROOT"] = str(isolated_root)
        launch._suppress_ui_auto_launch = True
        try:
            yield isolated_root
        finally:
            launch._suppress_ui_auto_launch = previous_suppressed
            launch._forced_mode = previous_forced_mode
            launch.reset_launch_state()
            if previous_repo_root is None:
                os.environ.pop("VF_UI_REPO_ROOT", None)
            else:
                os.environ["VF_UI_REPO_ROOT"] = previous_repo_root


def _is_display(value: object) -> bool:
    return value is not None and callable(getattr(value, "dumps", None))


def _imports_ui(module: ast.Module) -> bool:
    return any(
        isinstance(statement, ast.SpillImport)
        and list(getattr(statement.path, "segments", [])) == ["ui"]
        for statement in module.statements
    )


def _write_native_scene_output(target: Path, program: NativeOverlaySceneProgram) -> None:
    (target / "vkf-scene.html").write_text(program.html_text, encoding="utf-8")
    (target / "vf-runtime-packets.json").write_text(program.runtime_packets_text, encoding="utf-8")
    (target / "vf-display.json").write_text(
        '{\n  "screen": [],\n  "frames": {},\n  "geom": {}\n}\n',
        encoding="utf-8",
    )
    (target / "vkf-scene.json").write_text("[]\n", encoding="utf-8")
    (target / "vf-ui-state.json").write_text("{}\n", encoding="utf-8")
    if program.geom_transport_text:
        (target / "vf-geom-ledger-transport.json").write_text(program.geom_transport_text, encoding="utf-8")
    if program.geom_state_text:
        (target / "vf-geom-ledger-state.json").write_text(program.geom_state_text, encoding="utf-8")
    if program.event_program_text:
        (target / "vf-event-program.json").write_text(program.event_program_text, encoding="utf-8")
