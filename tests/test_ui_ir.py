"""UI IR round-trip (host bridge)."""

from __future__ import annotations

import json

from vektorflow.ui_display_ir import (
    build_scene_light_payload,
    build_scene_mesh_payload,
    frame_scene_from_runtime_geom,
)
from vektorflow.ui import FrameFlags, FrameSpec, NormRect, UiCommand, dumps_scene
from vektorflow.ui.ir import parse_dock_location


def test_norm_rect_and_frame_spec_json() -> None:
    r = NormRect(0.1, 0.1, 0.4, 0.5)
    r.validate()
    spec = FrameSpec(
        id="main",
        title="Hello",
        rect=r,
        flags=FrameFlags(
            draggable=True,
            dockable=True,
            resizable=False,
            closable=True,
            use_browser=False,
        ),
        alpha=0.5,
        master=False,
    )
    raw = json.dumps(spec.to_json_obj())
    back = json.loads(raw)
    assert back["id"] == "main"
    assert back["rect"]["w"] == 0.4
    assert back["flags"]["use_browser"] is False
    assert back["master"] is False
    assert back["title_align"] == "left"
    assert back["dock_location"] == "bl"


def test_dumps_scene() -> None:
    cmds = [
        UiCommand("frame_upsert", "f1", {"title": "Tools"}),
        UiCommand("frame_expand_to_fit", "f1", {}),
    ]
    s = dumps_scene(cmds)
    assert "frame_upsert" in s
    assert "frame_expand_to_fit" in s


def test_parse_dock_location_aliases() -> None:
    assert parse_dock_location("bl") == "bl"
    assert parse_dock_location("LB") == "bl"
    assert parse_dock_location("bottom_left") == "bl"
    assert parse_dock_location("bc") == "bc"
    assert parse_dock_location("CR") == "cr"
    assert parse_dock_location("rc") == "cr"
    assert parse_dock_location("center_right") == "cr"
    assert parse_dock_location("bottom") == "bl"
    try:
        parse_dock_location("cc")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_scene_light_payload_round_trips_spotlight_fields() -> None:
    payload = build_scene_light_payload(
        pos=(1.0, 2.0, 3.0),
        model="blinn_phong",
        color=[1.0, 0.9, 0.7, 1.0],
        intensity=42.0,
        kind="spot",
        direction=(0.0, 0.0, -1.0),
        target=(0.0, 0.0, 0.0),
        inner_cone_deg=12.0,
        outer_cone_deg=20.0,
        range=8.0,
    )
    scene = frame_scene_from_runtime_geom({"meshes": [], "camera": None, "lights": [payload]})
    light = scene.lights[0]
    assert light.kind == "spot"
    assert light.intensity == 42.0
    assert light.direction == (0.0, 0.0, -1.0)
    assert light.target == (0.0, 0.0, 0.0)
    assert light.inner_cone_deg == 12.0
    assert light.outer_cone_deg == 20.0
    assert light.range == 8.0


def test_scene_mesh_payload_round_trips_procedural_texture_fields() -> None:
    payload = build_scene_mesh_payload(
        "box",
        center=(0.0, 0.0, 0.0),
        scale=(1.0, 1.0, 1.0),
        color=[0.92, 0.92, 0.92, 1.0],
        texture={
            "kind": "checker",
            "scale": [8.0, 12.0],
            "color_a": [0.10, 0.12, 0.18, 1.0],
            "color_b": [0.88, 0.90, 0.98, 1.0],
        },
    )
    scene = frame_scene_from_runtime_geom({"meshes": [payload], "camera": None, "lights": []})
    mesh = scene.meshes[0]
    assert mesh.texture is not None
    assert mesh.texture["kind"] == "checker"
    assert mesh.texture["scale"] == [8.0, 12.0]
    assert mesh.texture["color_a"] == [0.10, 0.12, 0.18, 1.0]
    assert mesh.texture["color_b"] == [0.88, 0.90, 0.98, 1.0]
