from __future__ import annotations

from pathlib import Path

from vektorflow.native_overlay_scene_bundle import build_native_overlay_scene_program_from_contract
from vektorflow.native_overlay_scene_contract import NativeOverlaySceneContract
from vektorflow.native_overlay_scene_contract_io import (
    native_overlay_scene_contract_from_data,
    native_overlay_scene_contract_to_data,
    read_native_overlay_scene_contract,
    write_native_overlay_scene_contract,
)
from vektorflow.runtime.axis_tagged import axis_tagged_data, axis_tagged_idx, axis_tagged_wrap, is_axis_tagged_value


def test_native_overlay_scene_contract_round_trips_through_data() -> None:
    contract = NativeOverlaySceneContract(
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
    )
    data = native_overlay_scene_contract_to_data(contract)
    rebuilt = native_overlay_scene_contract_from_data(data)
    assert rebuilt == contract


def test_native_overlay_scene_contract_round_trips_axis_tagged_payload_values(
    tmp_path: Path,
) -> None:
    contract = NativeOverlaySceneContract(
        session_stem="memory-scene",
        kind="native_scene",
        payload={
            "kind": "scene_3d",
            "object": {
                "points": axis_tagged_wrap(
                    [
                        [0.0, 0.0, 1.0],
                        [1.0, 0.0, 1.0],
                        [0.0, 1.0, 1.0],
                    ],
                    "h",
                )
            },
        },
    )
    path = tmp_path / "axis-tagged.contract.json"
    write_native_overlay_scene_contract(path, contract)
    rebuilt = read_native_overlay_scene_contract(path)
    rebuilt_points = rebuilt.payload["object"]["points"]
    assert is_axis_tagged_value(rebuilt_points) is True
    assert axis_tagged_idx(rebuilt_points) == "h"
    assert axis_tagged_data(rebuilt_points) == [
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 1.0],
        [0.0, 1.0, 1.0],
    ]


def test_native_overlay_scene_contract_round_trips_multi_axis_time_track_values(
    tmp_path: Path,
) -> None:
    contract = NativeOverlaySceneContract(
        session_stem="memory-scene",
        kind="native_scene",
        payload={
            "kind": "scene_3d",
            "cube": {
                "transform": axis_tagged_wrap(
                    [
                        [
                            [1.0, 0.0],
                            [0.0, 1.0],
                        ],
                        [
                            [0.0, -1.0],
                            [1.0, 0.0],
                        ],
                    ],
                    "abt",
                ),
            },
        },
    )
    path = tmp_path / "axis-tagged-transform.contract.json"
    write_native_overlay_scene_contract(path, contract)
    rebuilt = read_native_overlay_scene_contract(path)
    rebuilt_transform = rebuilt.payload["cube"]["transform"]
    assert is_axis_tagged_value(rebuilt_transform) is True
    assert axis_tagged_idx(rebuilt_transform) == "abt"
    assert axis_tagged_data(rebuilt_transform) == [
        [
            [1.0, 0.0],
            [0.0, 1.0],
        ],
        [
            [0.0, -1.0],
            [1.0, 0.0],
        ],
    ]


def test_read_native_overlay_scene_contract_reads_written_file(tmp_path: Path) -> None:
    contract = NativeOverlaySceneContract(
        session_stem="memory-scene",
        kind="scene_probe",
        payload={
            "run_tag": "native-scene-probe ready",
            "prompt": "focus left pane",
            "input_title": "Input Surface",
            "log_title": "Native Log",
            "input_rect": [0.06, 0.08, 0.38, 0.78],
            "log_rect": [0.48, 0.05, 0.46, 0.86],
            "input_frame_id": "input_frame",
            "log_frame_id": "log_frame",
            "log_widget_id": "log",
            "event_probe": None,
        },
    )
    path = tmp_path / "scene.contract.json"
    write_native_overlay_scene_contract(path, contract)
    rebuilt = read_native_overlay_scene_contract(path)
    assert rebuilt == contract


def test_contract_loaded_from_file_builds_program(tmp_path: Path) -> None:
    contract = NativeOverlaySceneContract(
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
    )
    path = tmp_path / "scene.contract.json"
    write_native_overlay_scene_contract(path, contract)
    rebuilt = read_native_overlay_scene_contract(path)
    program = build_native_overlay_scene_program_from_contract(rebuilt)
    assert program.session_name == "memory-scene"
    assert program.page_rel == "sessions/memory-scene/vkf-scene.html"

