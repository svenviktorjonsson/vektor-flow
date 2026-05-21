from __future__ import annotations

from vektorflow.native_scene_ir_entities import (
    normalize_scene_ir_camera_entity,
    normalize_scene_ir_light_entity,
    normalize_scene_ir_light_entity_set,
)
from vektorflow.runtime.axis_tagged import axis_tagged_wrap


def test_normalize_scene_ir_camera_entity_uses_defaults() -> None:
    entity = normalize_scene_ir_camera_entity({})

    assert entity == {
        "properties": {
            "pos": [3.9, -5.6, 3.2],
            "target": [0.0, 0.0, 0.9],
            "fov": 34.0,
            "up": [0.0, 0.0, 1.0],
        },
        "embedding": {
            "pos": "pos",
            "target": "target",
            "fov": "fov",
            "up": "up",
            "min_distance": "min_distance",
            "radius": "radius",
            "height": "height",
            "theta": "theta",
            "turns_per_cycle": "turns_per_cycle",
        },
    }


def test_normalize_scene_ir_light_entity_uses_embedding_and_tracks() -> None:
    entity = normalize_scene_ir_light_entity(
        {
            "properties": {
                "location": [1.0, 2.0, 3.0],
                "beam_power": axis_tagged_wrap([12.0, 24.0], "t"),
            },
            "embedding": {
                "pos": "location",
                "power": "beam_power",
            },
            "kind": "spotlight",
            "dir": [0.0, 0.0, -1.0],
        }
    )

    assert entity["properties"]["location"] == [1.0, 2.0, 3.0]
    assert entity["properties"]["kind"] == "spot"
    assert entity["properties"]["direction"] == [0.0, 0.0, -1.0]
    assert entity["embedding"]["pos"] == "location"
    assert entity["embedding"]["power"] == "beam_power"
    assert entity["tracks"] == {"beam_power": [12.0, 24.0]}


def test_normalize_scene_ir_light_entity_set_flattens_axis_ij() -> None:
    lights = normalize_scene_ir_light_entity_set(
        {
            "lights": axis_tagged_wrap(
                [
                    [{"pos": [0.0, 0.0, 1.0]}, {"pos": [1.0, 0.0, 1.0]}],
                    [{"pos": [0.0, 1.0, 1.0]}],
                ],
                "ij",
            )
        }
    )

    assert [light["properties"]["id"] for light in lights] == ["light_0", "light_1", "light_2"]
    assert [light["properties"]["pos"] for light in lights] == [
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 1.0],
        [0.0, 1.0, 1.0],
    ]
