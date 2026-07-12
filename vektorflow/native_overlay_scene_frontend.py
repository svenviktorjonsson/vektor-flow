from __future__ import annotations

from pathlib import Path

from .native_overlay_scene_bundle import build_native_overlay_scene_program_from_contract
from .native_overlay_scene_contract import NativeOverlaySceneContract
from .native_overlay_scene_contract_io import read_native_overlay_scene_contract
from .native_overlay_scene_extractor import (
    extract_declarative_ui_scene_probe_spec,
    extract_scene_probe_spec,
    find_top_level_struct_binding,
)
from .parser import parse_module


def try_extract_native_overlay_scene_contract_from_module(
    module,
    *,
    session_stem: str,
    source_path: Path | None = None,
) -> NativeOverlaySceneContract | None:
    declared = find_top_level_struct_binding(module, "native_scene", source_path=source_path)
    if declared is not None:
        return NativeOverlaySceneContract(
            session_stem=session_stem,
            kind="native_scene",
            payload=declared,
        )
    spec = extract_declarative_ui_scene_probe_spec(module)
    if spec is None:
        spec = extract_scene_probe_spec(module)
    if spec is None:
        return None
    return NativeOverlaySceneContract(
        session_stem=session_stem,
        kind="scene_probe",
        payload=spec,
    )


def try_build_native_overlay_scene_program_from_source(
    source_text: str,
    *,
    filename: str,
    session_stem: str,
):
    module = parse_module(source_text, filename=filename)
    contract = try_extract_native_overlay_scene_contract_from_module(
        module,
        session_stem=session_stem,
        source_path=Path(filename),
    )
    if contract is None:
        return None
    return build_native_overlay_scene_program_from_contract(contract)


def try_build_native_overlay_scene_program(source_path: Path):
    resolved = Path(source_path).resolve()
    return try_build_native_overlay_scene_program_from_source(
        resolved.read_text(encoding="utf-8"),
        filename=resolved.as_posix(),
        session_stem=resolved.stem or "native-scene-probe",
    )


def try_build_native_overlay_scene_program_from_contract_path(contract_path: Path):
    resolved = Path(contract_path).resolve()
    contract = read_native_overlay_scene_contract(resolved)
    return build_native_overlay_scene_program_from_contract(contract)


__all__ = [
    "try_build_native_overlay_scene_program_from_contract_path",
    "try_extract_native_overlay_scene_contract_from_module",
    "try_build_native_overlay_scene_program",
    "try_build_native_overlay_scene_program_from_source",
]
