from __future__ import annotations

from vektorflow.native_overlay_scene_extractor import (
    extract_declarative_ui_scene_probe_spec,
    find_top_level_struct_binding,
)
from vektorflow.parser import parse_module


def test_find_top_level_struct_binding_extracts_native_scene_literal() -> None:
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
    declared = find_top_level_struct_binding(module, "native_scene")
    assert declared is not None
    assert declared["kind"] == "scene_3d"
    assert declared["frame_id"] == "scene_3d_frame"


def test_extract_declarative_ui_scene_probe_spec_extracts_ui_probe() -> None:
    module = parse_module(
        """
ui:.ui
ui.set_mode("overlay")
screen: ui.display
widgets: ui.widgets
input_frame: screen.Frame()
log_frame: screen.Frame()
screen.add_frame(input_frame, (0.06, 0.08, 0.38, 0.78))
screen.add_frame(log_frame, (0.48, 0.05, 0.46, 0.86), body: [
    widgets.text_area("log", text: "native-scene-probe ready\\nfocus left pane")
])
screen.render()
""",
        filename="probe.vkf",
    )
    spec = extract_declarative_ui_scene_probe_spec(module)
    assert spec is not None
    assert spec["run_tag"] == "native-scene-probe ready"
    assert spec["prompt"] == "focus left pane"
    assert spec["input_frame_id"] == "input_frame"
    assert spec["log_frame_id"] == "log_frame"

