from __future__ import annotations

import pytest

from vektorflow.native_scene_entities import (
    embedded_named_property,
    native_json_safe_value,
    normalize_native_named_parameters,
    normalize_native_named_tracks,
)
from vektorflow.runtime.axis_tagged import axis_tagged_data, axis_tagged_idx, axis_tagged_wrap, is_axis_tagged_value


def test_normalize_native_named_parameters_merges_properties_and_top_level() -> None:
    props, embedding = normalize_native_named_parameters(
        {
            "properties": {"eye": [1.0, 2.0, 3.0]},
            "fov": 35.0,
            "embedding": {"pos": "eye"},
        },
        default_embedding={"pos": "pos", "fov": "fov"},
        path="native_scene.camera",
    )

    assert props == {"eye": [1.0, 2.0, 3.0], "fov": 35.0}
    assert embedding == {"pos": "eye", "fov": "fov"}


def test_normalize_native_named_parameters_rejects_duplicate_property_declaration() -> None:
    with pytest.raises(ValueError, match="declared in both properties and top level"):
        normalize_native_named_parameters(
            {
                "properties": {"pos": [1.0, 2.0, 3.0]},
                "pos": [4.0, 5.0, 6.0],
            },
            default_embedding={"pos": "pos"},
            path="native_scene.light",
        )


def test_normalize_native_named_parameters_axis_suffix_sugars_property() -> None:
    props, _ = normalize_native_named_parameters(
        {
            "color_i": [
                [1.0, 0.0, 0.0, 1.0],
                [0.0, 0.0, 1.0, 1.0],
            ]
        },
        default_embedding={"color": "color"},
        path="native_scene.light",
    )

    assert is_axis_tagged_value(props["color"])
    assert axis_tagged_idx(props["color"]) == "i"
    assert axis_tagged_data(props["color"]) == [
        [1.0, 0.0, 0.0, 1.0],
        [0.0, 0.0, 1.0, 1.0],
    ]


def test_normalize_native_named_tracks_lifts_axis_t_and_legacy_suffix_tracks() -> None:
    props, embedding = normalize_native_named_parameters(
        {
            "pos_t": [[0.0, 0.0, 1.0], [0.0, 0.0, 2.0]],
            "properties": {
                "beam": axis_tagged_wrap([10.0, 20.0, 30.0], "t"),
            },
            "embedding": {"power": "beam"},
        },
        default_embedding={"pos": "pos", "power": "power"},
        path="native_scene.light",
    )

    tracks = normalize_native_named_tracks(
        {},
        props,
        embedding,
        legacy_canonical_names=("pos", "power"),
        path="native_scene.light",
    )

    assert tracks == {
        "pos": [[0.0, 0.0, 1.0], [0.0, 0.0, 2.0]],
        "beam": [10.0, 20.0, 30.0],
    }
    assert props == {}


def test_normalize_native_named_tracks_preserves_multi_axis_time_tracks() -> None:
    props, embedding = normalize_native_named_parameters(
        {
            "properties": {
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
        default_embedding={"transform": "transform"},
        path="native_scene.cube",
    )

    tracks = normalize_native_named_tracks(
        {},
        props,
        embedding,
        legacy_canonical_names=("transform",),
        path="native_scene.cube",
    )

    assert is_axis_tagged_value(tracks["transform"])
    assert axis_tagged_idx(tracks["transform"]) == "abt"
    assert axis_tagged_data(tracks["transform"]) == [
        [
            [1.0, 0.0],
            [0.0, 1.0],
        ],
        [
            [0.0, -1.0],
            [1.0, 0.0],
        ],
    ]
    assert props == {}


def test_embedded_named_property_uses_embedding_override() -> None:
    assert embedded_named_property({"eye": [1.0, 2.0, 3.0]}, {"pos": "eye"}, "pos", None) == [1.0, 2.0, 3.0]


def test_native_json_safe_value_unwraps_axis_tagged_values() -> None:
    value = {
        "pos": axis_tagged_wrap([[0.0, 0.0], [1.0, 1.0]], "i"),
        "tracks": (
            axis_tagged_wrap([1.0, 2.0, 3.0], "t"),
            4.0,
        ),
    }

    assert native_json_safe_value(value) == {
        "pos": [[0.0, 0.0], [1.0, 1.0]],
        "tracks": [[1.0, 2.0, 3.0], 4.0],
    }


def test_native_json_safe_value_preserves_multi_axis_axis_tags() -> None:
    value = {
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
    }

    assert native_json_safe_value(value) == {
        "transform": {
            "__vf_axis_tagged__": True,
            "idx": "abt",
            "data": [
                [
                    [1.0, 0.0],
                    [0.0, 1.0],
                ],
                [
                    [0.0, -1.0],
                    [1.0, 0.0],
                ],
            ],
        },
    }
