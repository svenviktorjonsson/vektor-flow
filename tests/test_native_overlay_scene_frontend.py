from __future__ import annotations

from pathlib import Path

from vektorflow.native_overlay_scene_bundle import build_native_overlay_scene_program_from_contract
from vektorflow.native_overlay_scene_contract import NativeOverlaySceneContract
from vektorflow.native_overlay_scene_contract_io import write_native_overlay_scene_contract
from vektorflow.native_overlay_scene_frontend import (
    try_extract_native_overlay_scene_contract_from_module,
    try_build_native_overlay_scene_program_from_contract_path,
    try_build_native_overlay_scene_program,
    try_build_native_overlay_scene_program_from_source,
)
from vektorflow.parser import parse_module


def test_try_extract_native_overlay_scene_contract_from_module_extracts_native_scene() -> None:
    module = parse_module(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "scene_3d_frame",
    title: "Cube + Plane + Hard Shadow",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.15],
        size: 1.6,
        face_color: [0.96, 0.22, 0.16, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [3.9, -5.6, 3.2],
        target: [0.0, 0.0, 0.9],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: false
        )
    ],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
""",
        filename="memory_scene.vkf",
    )
    contract = try_extract_native_overlay_scene_contract_from_module(
        module,
        session_stem="memory-scene",
    )
    assert contract is not None
    assert contract.kind == "native_scene"
    assert contract.session_stem == "memory-scene"
    assert contract.payload["kind"] == "scene_3d"


def test_contract_build_round_trips_to_program() -> None:
    module = parse_module(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "scene_3d_frame",
    title: "Cube + Plane + Hard Shadow",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.15],
        size: 1.6,
        face_color: [0.96, 0.22, 0.16, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [3.9, -5.6, 3.2],
        target: [0.0, 0.0, 0.9],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: false
        )
    ],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
""",
        filename="memory_scene.vkf",
    )
    contract = try_extract_native_overlay_scene_contract_from_module(
        module,
        session_stem="memory-scene",
    )
    assert contract is not None
    program = build_native_overlay_scene_program_from_contract(contract)
    assert program.session_name == "memory-scene"
    assert program.page_rel == "sessions/memory-scene/vkf-scene.html"


def test_try_build_native_overlay_scene_program_from_source_builds_native_scene() -> None:
    program = try_build_native_overlay_scene_program_from_source(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "scene_3d_frame",
    title: "Cube + Plane + Hard Shadow",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.15],
        size: 1.6,
        face_color: [0.96, 0.22, 0.16, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [3.9, -5.6, 3.2],
        target: [0.0, 0.0, 0.9],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: false
        )
    ],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
""",
        filename="memory_scene.vkf",
        session_stem="memory-scene",
    )
    assert program is not None
    assert program.session_name == "memory-scene"
    assert program.page_rel == "sessions/memory-scene/vkf-scene.html"


def test_try_build_native_overlay_scene_program_from_source_returns_none_for_non_native() -> None:
    program = try_build_native_overlay_scene_program_from_source(
        'print("hello")\n',
        filename="plain_program.vkf",
        session_stem="plain-program",
    )
    assert program is None


def test_try_build_native_overlay_scene_program_reads_file(tmp_path: Path) -> None:
    path = tmp_path / "scene_file.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "scene_3d_frame",
    title: "Cube + Plane + Hard Shadow",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.15],
        size: 1.6,
        face_color: [0.96, 0.22, 0.16, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [3.9, -5.6, 3.2],
        target: [0.0, 0.0, 0.9],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: false
        )
    ],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
""",
        encoding="utf-8",
    )
    program = try_build_native_overlay_scene_program(path)
    assert program is not None
    assert program.session_name == "scene-file"


def test_try_build_native_overlay_scene_program_from_contract_path_reads_contract_file(
    tmp_path: Path,
) -> None:
    path = tmp_path / "scene.contract.json"
    write_native_overlay_scene_contract(
        path,
        NativeOverlaySceneContract(
            session_stem="memory-scene",
            kind="native_scene",
            payload={
                "kind": "scene_3d",
                "frame_id": "scene_3d_frame",
                "title": "Cube + Plane + Hard Shadow",
                "rect": [0.08, 0.08, 0.72, 0.78],
                "cube": {
                    "center": [0.0, 0.0, 1.15],
                    "size": 1.6,
                    "face_color": [0.96, 0.22, 0.16, 1.0],
                },
                "plane": {
                    "center": [0.0, 0.0],
                    "size": 7.0,
                    "z": 0.0,
                    "color": [0.20, 0.22, 0.26, 1.0],
                },
                "camera": {
                    "pos": [3.9, -5.6, 3.2],
                    "target": [0.0, 0.0, 0.9],
                    "fov": 34.0,
                    "up": [0.0, 0.0, 1.0],
                },
                "lights": [
                    {
                        "kind": "point",
                        "pos": [0.0, 4.8, 4.8],
                        "power": 24000.0,
                        "range": 18.0,
                        "casts_shadow": False,
                    }
                ],
                "shadow": {
                    "enabled": False,
                    "color": [0.0, 0.0, 0.0, 1.0],
                    "lift": 0.002,
                },
            },
        ),
    )
    program = try_build_native_overlay_scene_program_from_contract_path(path)
    assert program is not None
    assert program.session_name == "memory-scene"
    assert program.page_rel == "sessions/memory-scene/vkf-scene.html"

