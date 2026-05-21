from __future__ import annotations

from vektorflow.native_scene_topology import (
    delaunay_simplices,
    normalize_add_simplices_spec,
    require_hull_point_sets,
)
from vektorflow.runtime.axis_tagged import axis_tagged_wrap


def test_require_hull_point_sets_accepts_h_and_hi() -> None:
    one, mode_one = require_hull_point_sets(
        axis_tagged_wrap(
            [
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
            "h",
        ),
        path="points",
    )
    many, mode_many = require_hull_point_sets(
        axis_tagged_wrap(
            [
                [
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                ],
                [
                    [2.0, 0.0, 0.0],
                    [3.0, 0.0, 0.0],
                    [2.0, 1.0, 0.0],
                    [2.0, 0.0, 1.0],
                ],
            ],
            "hi",
        ),
        path="points",
    )

    assert mode_one == "h"
    assert len(one) == 1
    assert mode_many == "hi"
    assert len(many) == 2


def test_normalize_add_simplices_spec_accepts_edges_faces_and_volumes() -> None:
    simplices = normalize_add_simplices_spec(
        {
            "edges": [[0, 1]],
            "faces": [[0, 1, 2]],
            "volumes": [[0, 1, 2, 3]],
        },
        path="simplices",
    )

    assert simplices["edges"] == [[0, 1]]
    assert simplices["faces"] == [[0, 1, 2]]
    assert simplices["volumes"] == [[0, 1, 2, 3]]


def test_delaunay_simplices_returns_faces_for_planar_points() -> None:
    simplices = delaunay_simplices(
        [
            [-1.0, -1.0, 0.2],
            [1.0, -1.0, 0.2],
            [1.0, 1.0, 0.2],
            [-1.0, 1.0, 0.2],
            [0.0, 0.0, 0.2],
        ],
        path="points",
    )

    assert simplices["faces"]
    assert simplices["edges"]
    assert simplices["volumes"] == []


def test_delaunay_simplices_returns_tetrahedra_for_3d_points() -> None:
    simplices = delaunay_simplices(
        [
            [-1.0, -1.0, 0.0],
            [1.0, -1.0, 0.2],
            [1.0, 1.0, -0.1],
            [-1.0, 1.0, 0.3],
            [0.0, 0.0, 1.0],
            [0.2, -0.2, -0.8],
        ],
        path="points",
    )

    assert simplices["volumes"]
    assert simplices["edges"]
    assert simplices["faces"] == []
