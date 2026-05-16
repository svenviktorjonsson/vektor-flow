"""Tests for 3-D geometry commands on Display: add_box, add_camera, add_light,
and the mutable SceneBox / SceneCamera / SceneLight objects they return.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path

import pytest

from vektorflow.stdlib.ui import (
    Display,
    SceneBox,
    SceneFieldMesh,
    SceneCamera,
    SceneLight,
    LIGHT_MODELS,
    build_ui_namespace,
)
from vektorflow.runtime.axis_tagged import AxisTaggedValue
from vektorflow.runtime.vfvector import VFVector
from vektorflow.ui.payloads import get_ui_payload_snapshot, reset_ui_payload_snapshot

REPO = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _placed() -> tuple[Display, str]:
    """Return (display, frame_id) with one frame already placed."""
    d = Display()
    f = d.Frame()
    d.add_frame((0.1, 0.1, 0.5, 0.5))
    return d, f._frame_id


def _geom(d: Display, fid: str) -> dict:
    return d._geom.get(fid, {})


# ---------------------------------------------------------------------------
# add_box — returns SceneBox
# ---------------------------------------------------------------------------

class TestAddBox:
    def test_returns_scene_box(self) -> None:
        d, fid = _placed()
        box = d.add_box(center=[0,0,0], scale=[1,1,1], color="red")
        assert isinstance(box, SceneBox)

    def test_data_in_geom(self) -> None:
        d, fid = _placed()
        d.add_box(center=[1,2,3], scale=[1,2,3], color="blue")
        m = _geom(d, fid)["meshes"][0]
        assert m["type"]   == "box"
        assert m["center"] == [1.0, 2.0, 3.0]
        assert m["scale"]  == [1.0, 2.0, 3.0]
        assert m["color"]  == "blue"

    def test_rotation_initialised_to_zero(self) -> None:
        d, fid = _placed()
        box = d.add_box(center=[0,0,0])
        assert _geom(d, fid)["meshes"][0]["rotation"] == [0.0, 0.0, 0.0]

    def test_draw_box_alias(self) -> None:
        d, fid = _placed()
        box = d.draw_box(center=[0,0,0], color="green")
        assert isinstance(box, SceneBox)

    def test_no_frame_raises(self) -> None:
        d = Display()
        with pytest.raises(RuntimeError):
            d.add_box(center=[0,0,0])


# ---------------------------------------------------------------------------
# SceneBox mutations
# ---------------------------------------------------------------------------

class TestSceneBox:
    def _box(self) -> tuple[SceneBox, dict, Display, str]:
        d, fid = _placed()
        box = d.add_box(center=[0,0,0], scale=[1,2,3], color="red")
        data = _geom(d, fid)["meshes"][0]
        return box, data, d, fid

    def test_translate_returns_self(self) -> None:
        box, *_ = self._box()
        assert box.translate([1, 0, 0]) is box

    def test_translate_updates_center(self) -> None:
        box, data, *_ = self._box()
        box.translate([1, 2, 3])
        assert data["center"] == [1.0, 2.0, 3.0]

    def test_translate_accumulates(self) -> None:
        box, data, *_ = self._box()
        box.translate([1, 0, 0])
        box.translate([0, 2, 0])
        assert data["center"] == [1.0, 2.0, 0.0]

    def test_rotate_by_returns_self(self) -> None:
        box, *_ = self._box()
        assert box.rotate_by(30, around="y") is box

    def test_rotate_by_sets_rotation(self) -> None:
        box, data, *_ = self._box()
        box.rotate_by(45, around="y")
        assert data["rotation"][1] == pytest.approx(45.0)

    def test_rotate_by_accumulates_mod_360(self) -> None:
        box, data, *_ = self._box()
        box.rotate_by(200, around="z")
        box.rotate_by(200, around="z")
        assert data["rotation"][2] == pytest.approx(40.0)  # 400 % 360

    def test_rotate_by_axes(self) -> None:
        box, data, *_ = self._box()
        box.rotate_by(10, around="x")
        box.rotate_by(20, around="y")
        box.rotate_by(30, around="z")
        assert data["rotation"] == pytest.approx([10.0, 20.0, 30.0])

    def test_rotate_by_bad_axis(self) -> None:
        box, *_ = self._box()
        with pytest.raises(ValueError):
            box.rotate_by(10, around="w")

    def test_set_color(self) -> None:
        box, data, *_ = self._box()
        box.set_color("cyan")
        assert data["color"] == "cyan"

    def test_set_scale(self) -> None:
        box, data, *_ = self._box()
        box.set_scale([2, 3, 4])
        assert data["scale"] == [2.0, 3.0, 4.0]

    def test_center_property(self) -> None:
        box, *_ = self._box()
        box.translate([5, 0, 0])
        assert box.center == [5.0, 0.0, 0.0]

    def test_scale_property(self) -> None:
        box, *_ = self._box()
        assert box.scale == [1.0, 2.0, 3.0]

    def test_repr(self) -> None:
        box, *_ = self._box()
        assert "SceneBox" in repr(box)

    def test_chaining(self) -> None:
        d, fid = _placed()
        box = d.add_box(center=[0,0,0], scale=[1,1,1], color="red")
        result = box.translate([1,0,0]).rotate_by(45,"y").set_color("blue").set_scale([2,2,2])
        assert result is box


class TestFieldMeshTimeSlices:
    def _mesh(self) -> tuple[SceneFieldMesh, dict, Display, str]:
        d, fid = _placed()
        mesh = d.add(
            x_u=[0, 1, 2],
            y_v=[0, 1],
            z_tuv=[
                [[0, 0], [0, 0], [0, 0]],
                [[1, 1], [1, 1], [1, 1]],
                [[2, 2], [2, 2], [2, 2]],
            ],
            color="blue",
            interpolation=True,
        )
        data = _geom(d, fid)["meshes"][0]
        return mesh, data, d, fid

    def test_add_returns_scene_field_mesh(self) -> None:
        mesh, *_ = self._mesh()
        assert isinstance(mesh, SceneFieldMesh)

    def test_time_metadata_present(self) -> None:
        mesh, data, *_ = self._mesh()
        assert mesh.t == 0
        assert mesh.t_count == 3
        assert mesh.time_boundary == "stop"
        assert data["time_boundary"] == "stop"
        assert data["time_index"] == 0
        assert data["time_count"] == 3

    def test_set_t_rebuilds_visible_slice(self) -> None:
        mesh, data, *_ = self._mesh()
        z0 = data["vertices"][2]
        mesh.set_t(2)
        assert mesh.t == 2
        assert data["time_index"] == 2
        assert data["vertices"][2] == pytest.approx(z0 + 2.0)

    def test_set_t_clamps(self) -> None:
        mesh, data, *_ = self._mesh()
        mesh.set_t(99)
        assert mesh.t == 2
        assert data["time_index"] == 2

    def test_set_t_repeat_wraps(self) -> None:
        mesh, data, *_ = self._mesh()
        mesh.set_time_boundary("repeat")
        mesh.set_t(4)
        assert mesh.t == 1
        assert data["time_index"] == 1

    def test_set_t_mirror_ping_pongs(self) -> None:
        mesh, data, *_ = self._mesh()
        mesh.set_time_boundary("mirror")
        mesh.set_t(3)
        assert mesh.t == 1
        assert data["time_index"] == 1

    def test_set_t_reset_snaps_out_of_range_back_to_zero(self) -> None:
        mesh, data, *_ = self._mesh()
        mesh.set_time_boundary("reset")
        mesh.set_t(99)
        assert mesh.t == 0
        assert data["time_index"] == 0

    def test_set_t_boundary_alias(self) -> None:
        mesh, data, *_ = self._mesh()
        mesh.set_t_boundary("repeat")
        mesh.set_t(5)
        assert mesh.time_boundary == "repeat"
        assert data["time_boundary"] == "repeat"
        assert data["time_index"] == 2

    def test_set_time_boundary_invalid_raises(self) -> None:
        mesh, *_ = self._mesh()
        with pytest.raises(ValueError):
            mesh.set_time_boundary("loop")

    def test_set_time_alias(self) -> None:
        mesh, data, *_ = self._mesh()
        mesh.set_time(1)
        assert mesh.t == 1
        assert data["time_index"] == 1

    def test_set_color_rebuilds_vertex_colors(self) -> None:
        mesh, data, *_ = self._mesh()
        before = data["vertices"][6:10]
        mesh.set_color("#ff0000")
        after = data["vertices"][6:10]
        assert before != after
        assert after == pytest.approx([1.0, 0.0, 0.0, 1.0])

    def test_vector_color_payload_is_json_serializable(self) -> None:
        d, fid = _placed()
        d.set_auto_render(False)
        mesh = d.add(
            x=0,
            y=0,
            z=0,
            vertex_size=0.1,
            color=VFVector([1.0, 0.2, 0.3, 0.4]),
        )
        data = _geom(d, fid)["meshes"][0]
        assert data["color"] == pytest.approx([1.0, 0.2, 0.3, 0.4])
        json.dumps(data)

    def test_set_color_vector_payload_stays_json_serializable(self) -> None:
        d, fid = _placed()
        d.set_auto_render(False)
        mesh = d.add(
            x=0,
            y=0,
            z=0,
            vertex_size=0.1,
            color="blue",
        )
        data = _geom(d, fid)["meshes"][0]
        mesh.set_color(VFVector([1.0, 0.95, 0.2, 0.72]))
        assert data["color"] == pytest.approx([1.0, 0.95, 0.2, 0.72])
        assert data["vertices"][6:10] == pytest.approx([1.0, 0.95, 0.2, 0.72])
        json.dumps(data)

    def test_set_color_publishes_geom_color_patch_without_display_replace(self) -> None:
        reset_ui_payload_snapshot()
        d, fid = _placed()
        d.set_auto_render(False)
        mesh = d.add(x=0, y=0, z=0, vertex_size=0.1, color="blue")
        reset_ui_payload_snapshot()

        mesh.set_color([1.0, 0.95, 0.2, 1.0])

        packets = get_ui_payload_snapshot().packets
        assert [packet.kind for packet in packets] == ["geom.color.patch"]
        assert packets[0].payload == {
            "frame_id": fid,
            "object_id": 1,
            "color": [1.0, 0.95, 0.2, 1.0],
        }

    def test_depth_write_metadata_is_preserved(self) -> None:
        d, fid = _placed()
        d.set_auto_render(False)
        d.add(
            x_uv=[[0, 0], [1, 1]],
            y_uv=[[0, 1], [0, 1]],
            z_uv=[[0, 0], [0, 0]],
            color=[1, 0, 0, 0.4],
            depth_write=True,
        )
        data = _geom(d, fid)["meshes"][0]
        assert data["depth_write"] is True

    def test_add_infers_channel_indices_from_axis_tagged_values(self) -> None:
        d, fid = _placed()
        d.set_auto_render(False)

        d.add(
            x=AxisTaggedValue((-1.0, 0.0, 1.0), "u"),
            y=AxisTaggedValue((-1.0, 0.0, 1.0), "v"),
            z=AxisTaggedValue(
                (
                    (2.0, 1.0, 2.0),
                    (1.0, 0.0, 1.0),
                    (2.0, 1.0, 2.0),
                ),
                "uv",
            ),
            color="cyan",
            interpolation=True,
        )

        data = _geom(d, fid)["meshes"][0]
        assert data["topology"] == "triangle-list"
        assert data["indices"] == [
            0, 3, 4, 0, 4, 1,
            1, 4, 5, 1, 5, 2,
            3, 6, 7, 3, 7, 4,
            4, 7, 8, 4, 8, 5,
        ]
        assert data["manifold_dim_count"] == 2

    def test_explicit_channel_suffix_must_match_axis_tagged_value(self) -> None:
        d, _ = _placed()
        d.set_auto_render(False)

        with pytest.raises(ValueError, match="conflicts with value indices"):
            d.add(
                x_u=AxisTaggedValue((0.0, 1.0), "v"),
                y=0.0,
                z=0.0,
            )

    def test_mixed_grouping_and_manifold_axes_cover_0d_1d_2d_and_3d(self) -> None:
        d, fid = _placed()
        d.set_auto_render(False)

        d.add(
            x=AxisTaggedValue((-7.0, -5.0), "i"),
            y=AxisTaggedValue((-1.0, 1.0), "j"),
            z=AxisTaggedValue((0.0, 1.5), "k"),
            color="orange",
        )
        d.add(
            x=AxisTaggedValue((-1.5, 0.0, 1.5), "u"),
            y=AxisTaggedValue((-4.0, -2.5), "j"),
            z=0.0,
            color="green",
        )
        d.add(
            x=AxisTaggedValue(
                (
                    ((0.5, 2.5), (0.5, 2.5), (0.5, 2.5)),
                    ((2.0, 4.0), (2.0, 4.0), (2.0, 4.0)),
                    ((3.5, 5.5), (3.5, 5.5), (3.5, 5.5)),
                ),
                "uvi",
            ),
            y=AxisTaggedValue((-1.5, 0.0, 1.5), "v"),
            z=AxisTaggedValue(
                (
                    ((0.45, 0.45), (0.0, 0.0), (0.45, 0.45)),
                    ((0.0, 0.0), (-0.45, -0.45), (0.0, 0.0)),
                    ((0.45, 0.45), (0.0, 0.0), (0.45, 0.45)),
                ),
                "uvi",
            ),
            color="cyan",
            interpolation=True,
        )
        d.add(
            x=AxisTaggedValue((-1.0, 0.0, 1.0), "u"),
            y=AxisTaggedValue((-1.0, 0.0, 1.0), "v"),
            z=AxisTaggedValue((-1.0, 0.0, 1.0), "w"),
            color="magenta",
            interpolation=True,
        )

        meshes = _geom(d, fid)["meshes"]
        assert [mesh["topology"] for mesh in meshes] == [
            "point-list",
            "line-list",
            "triangle-list",
            "triangle-list",
        ]
        assert [mesh["manifold_dim_count"] for mesh in meshes] == [0, 1, 2, 3]
        assert meshes[0]["indices"] == list(range(8))
        assert meshes[3]["solid_volume"] is True

    def test_uvw_volume_emits_only_outer_boundary_surfaces(self) -> None:
        d, fid = _placed()
        d.set_auto_render(False)

        d.add(
            x=AxisTaggedValue((0.0, 1.0, 2.0), "u"),
            y=AxisTaggedValue((0.0, 1.0), "v"),
            z=AxisTaggedValue((0.0, 1.0), "w"),
            color="blue",
            interpolation=True,
        )

        mesh = _geom(d, fid)["meshes"][0]
        vertices = mesh["vertices"]
        points = [
            (vertices[offset], vertices[offset + 1], vertices[offset + 2])
            for offset in range(0, len(vertices), 10)
        ]
        triangles = [
            (mesh["indices"][i], mesh["indices"][i + 1], mesh["indices"][i + 2])
            for i in range(0, len(mesh["indices"]), 3)
        ]

        assert mesh["topology"] == "triangle-list"
        assert mesh["manifold_dim_count"] == 3
        assert mesh["solid_volume"] is True
        assert len(mesh["indices"]) == 20 * 3
        assert not any(
            points[a][0] == pytest.approx(1.0)
            and points[b][0] == pytest.approx(1.0)
            and points[c][0] == pytest.approx(1.0)
            for (a, b, c) in triangles
        )


# ---------------------------------------------------------------------------
# add_camera — returns SceneCamera
# ---------------------------------------------------------------------------

class TestAddCamera:
    def test_returns_scene_camera(self) -> None:
        d, _ = _placed()
        cam = d.add_camera(pos=[4,3,5])
        assert isinstance(cam, SceneCamera)

    def test_data_stored(self) -> None:
        d, fid = _placed()
        d.add_camera(pos=[4,3,5], target=[0,0,0], fov=45)
        g = _geom(d, fid)
        assert g["camera"]["pos"]    == [4.0, 3.0, 5.0]
        assert g["camera"]["fov"]    == pytest.approx(45.0)
        assert g["camera"]["target"] == [0.0, 0.0, 0.0]

    def test_second_call_overwrites(self) -> None:
        d, fid = _placed()
        d.add_camera(pos=[1,1,1])
        d.add_camera(pos=[2,2,2])
        assert _geom(d, fid)["camera"]["pos"] == [2.0, 2.0, 2.0]

    def test_default_up_axis_is_z(self) -> None:
        d, fid = _placed()
        d.add_camera(pos=[4,3,5])
        assert _geom(d, fid)["camera"]["up"] == [0.0, 0.0, 1.0]


class TestSceneCamera:
    def _cam(self) -> tuple[SceneCamera, dict]:
        d, fid = _placed()
        cam = d.add_camera(pos=[4, 3, 5], target=[0,0,0], fov=45)
        data = _geom(d, fid)["camera"]
        return cam, data

    def test_translate_moves_pos(self) -> None:
        cam, data = self._cam()
        cam.translate([1, 0, 0])
        assert data["pos"] == pytest.approx([5.0, 3.0, 5.0])

    def test_translate_returns_self(self) -> None:
        cam, _ = self._cam()
        assert cam.translate([0,0,0]) is cam

    def test_look_at(self) -> None:
        cam, data = self._cam()
        cam.look_at([1, 2, 3])
        assert data["target"] == [1.0, 2.0, 3.0]

    def test_set_fov(self) -> None:
        cam, data = self._cam()
        cam.set_fov(30)
        assert data["fov"] == pytest.approx(30.0)

    def test_rotate_by_preserves_xy_radius(self) -> None:
        cam, data = self._cam()
        # pos=[4,3,5], target=[0,0,0]
        # XY radius = sqrt(4^2+3^2) = 5
        cam.rotate_by(90, around="z")
        r_after = math.sqrt(data["pos"][0]**2 + data["pos"][1]**2)
        assert r_after == pytest.approx(5.0, abs=1e-5)

    def test_rotate_by_preserves_z(self) -> None:
        cam, data = self._cam()
        z_before = data["pos"][2]
        cam.rotate_by(45, around="z")
        assert data["pos"][2] == pytest.approx(z_before, abs=1e-5)

    def test_rotate_by_bad_axis(self) -> None:
        cam, _ = self._cam()
        with pytest.raises(ValueError):
            cam.rotate_by(10, around="w")

    def test_rotate_by_full_circle_returns_to_start(self) -> None:
        cam, data = self._cam()
        pos0 = list(data["pos"])
        cam.rotate_by(360, around="z")
        assert data["pos"][0] == pytest.approx(pos0[0], abs=1e-4)
        assert data["pos"][1] == pytest.approx(pos0[1], abs=1e-4)

    def test_rotate_by_returns_self(self) -> None:
        cam, _ = self._cam()
        assert cam.rotate_by(30) is cam

    def test_pos_property(self) -> None:
        cam, _ = self._cam()
        assert cam.pos == pytest.approx([4.0, 3.0, 5.0])

    def test_target_property(self) -> None:
        cam, _ = self._cam()
        assert cam.target == [0.0, 0.0, 0.0]

    def test_fov_property(self) -> None:
        cam, _ = self._cam()
        assert cam.fov == pytest.approx(45.0)

    def test_repr(self) -> None:
        cam, _ = self._cam()
        assert "SceneCamera" in repr(cam)

    def test_continuous_orbit_moves_camera(self) -> None:
        cam, data = self._cam()
        pos0 = list(data["pos"])
        cam.rotate(around="z", omega=180)  # half rotation per second
        time.sleep(0.15)                   # ~27° of rotation
        cam.stop()
        # camera should have moved
        moved = math.sqrt(
            (data["pos"][0] - pos0[0])**2 +
            (data["pos"][1] - pos0[1])**2
        )
        assert moved > 0.1, f"expected camera to have moved, moved={moved:.4f}"

    def test_stop_halts_animation(self) -> None:
        cam, data = self._cam()
        cam.rotate(around="z", omega=60)
        time.sleep(0.08)
        cam.stop()
        pos_after_stop = list(data["pos"])
        time.sleep(0.1)
        # should not have moved after stop
        assert data["pos"] == pytest.approx(pos_after_stop, abs=1e-6)

    def test_stop_when_not_running_is_safe(self) -> None:
        cam, _ = self._cam()
        cam.stop()  # must not raise


# ---------------------------------------------------------------------------
# add_light — returns SceneLight
# ---------------------------------------------------------------------------

class TestAddLight:
    def test_returns_scene_light(self) -> None:
        d, _ = _placed()
        light = d.add_light(pos=[6,8,6], model="blinn_phong", color="white")
        assert isinstance(light, SceneLight)

    def test_data_stored(self) -> None:
        d, fid = _placed()
        d.add_light(pos=[6,8,6], model="blinn_phong", color="white")
        L = _geom(d, fid)["lights"][0]
        assert L["pos"]   == [6.0, 8.0, 6.0]
        assert L["model"] == "blinn_phong"
        assert L["color"] == "white"

    def test_bad_model_raises(self) -> None:
        d, _ = _placed()
        with pytest.raises(ValueError):
            d.add_light(pos=[0,5,0], model="gouraud")

    def test_known_models(self) -> None:
        assert LIGHT_MODELS == {"blinn_phong"}


class TestSceneLight:
    def _light(self) -> tuple[SceneLight, dict]:
        d, fid = _placed()
        light = d.add_light(pos=[6, 8, 6], model="blinn_phong", color="white")
        data = _geom(d, fid)["lights"][0]
        return light, data

    def test_translate_moves_pos(self) -> None:
        light, data = self._light()
        light.translate([1, 0, 0])
        assert data["pos"] == pytest.approx([7.0, 8.0, 6.0])

    def test_translate_returns_self(self) -> None:
        light, _ = self._light()
        assert light.translate([0,0,0]) is light

    def test_set_color(self) -> None:
        light, data = self._light()
        light.set_color("yellow")
        assert data["color"] == "yellow"

    def test_set_model(self) -> None:
        light, data = self._light()
        light.set_model("lambert")
        assert data["model"] == "blinn_phong"

    def test_set_model_bad(self) -> None:
        light, _ = self._light()
        with pytest.raises(ValueError):
            light.set_model("phong2")

    def test_pos_property(self) -> None:
        light, _ = self._light()
        assert light.pos == [6.0, 8.0, 6.0]

    def test_repr(self) -> None:
        light, _ = self._light()
        assert "SceneLight" in repr(light)

    def test_rotate_orbits_around_origin(self) -> None:
        light, data = self._light()
        pos0 = list(data["pos"])
        r0 = math.sqrt(pos0[0]**2 + pos0[1]**2)
        light.rotate(around="z", omega=180)
        time.sleep(0.15)
        light.stop()
        r1 = math.sqrt(data["pos"][0]**2 + data["pos"][1]**2)
        assert r1 == pytest.approx(r0, abs=0.01)

    def test_light_stop_halts(self) -> None:
        light, data = self._light()
        light.rotate(around="z", omega=60)
        time.sleep(0.08)
        light.stop()
        pos_snap = list(data["pos"])
        time.sleep(0.1)
        assert data["pos"] == pytest.approx(pos_snap, abs=1e-6)


# ---------------------------------------------------------------------------
# Pending-frame migration (geom ops before add_frame)
# ---------------------------------------------------------------------------

class TestPendingMigration:
    def test_geom_before_frame_migrates(self) -> None:
        d = Display()
        f = d.Frame()
        box   = d.add_box(center=[0,0,0], color="red")
        cam   = d.add_camera(pos=[4,3,5])
        light = d.add_light(pos=[6,8,6])
        d.add_frame((0.1, 0.1, 0.5, 0.5))
        fid = f._frame_id
        g = _geom(d, fid)
        assert len(g["meshes"]) == 1
        assert g["camera"]  is not None
        assert len(g["lights"]) == 1

    def test_no_pending_keys_after_place(self) -> None:
        d = Display()
        f = d.Frame()
        d.add_box(center=[0,0,0])
        d.add_frame((0.1, 0.1, 0.5, 0.5))
        assert all(not k.startswith("__pending_") for k in d._geom)


# ---------------------------------------------------------------------------
# Two independent frames
# ---------------------------------------------------------------------------

class TestTwoFrames:
    def test_independent_geom(self) -> None:
        d = Display()
        f1 = d.Frame(); d.add_frame((0.0, 0.0, 0.5, 1.0))
        f2 = d.Frame(); d.add_frame((0.5, 0.0, 0.5, 1.0))
        # after placing f2, d._last_frame is f2 — use explicit FrameRef to target f1
        b1 = f1.add_box(center=[0,0,0], color="red")
        b2 = f2.add_box(center=[1,0,0], color="blue")
        assert _geom(d, f1._frame_id)["meshes"][0]["color"] == "red"
        assert _geom(d, f2._frame_id)["meshes"][0]["color"] == "blue"


# ---------------------------------------------------------------------------
# vf-display.json includes geom + rotation
# ---------------------------------------------------------------------------

class TestDisplayJson:
    def _payload(self, d: Display) -> dict:
        placed = {fid: g for fid, g in d._geom.items() if not fid.startswith("__pending_")}
        return {"screen": [], "frames": {}, "geom": placed}

    def test_rotation_serialisable(self) -> None:
        d, fid = _placed()
        box = d.add_box(center=[0,0,0], scale=[1,1,1], color="red")
        box.rotate_by(45, around="y")
        payload = self._payload(d)
        txt = json.dumps(payload)
        obj = json.loads(txt)
        assert obj["geom"][fid]["meshes"][0]["rotation"][1] == pytest.approx(45.0)

    def test_camera_and_lights_serialisable(self) -> None:
        d, fid = _placed()
        d.add_camera(pos=[4,3,5], target=[0,0,0], fov=45)
        d.add_light(pos=[6,8,6], model="blinn_phong", color="white")
        txt = json.dumps(self._payload(d))
        obj = json.loads(txt)
        assert obj["geom"][fid]["camera"]["fov"] == pytest.approx(45.0)
        assert obj["geom"][fid]["lights"][0]["model"] == "blinn_phong"

    def test_frame_geom_options_are_serialisable(self) -> None:
        d, fid = _placed()
        d.set_geom_options(unified_renderer=True)
        d.add_box(center=[0,0,0], scale=[1,1,1], color="red")
        obj = json.loads(json.dumps(self._payload(d)))
        assert obj["geom"][fid]["unified_renderer"] is True

    def test_vector_color_is_serialisable(self) -> None:
        d, fid = _placed()
        box = d.add_box(center=[0,0,0], scale=[1,1,1], color=[1, 0, 0, 0.5])
        box.set_color([0, 1, 0, 0.75])
        obj = json.loads(json.dumps(self._payload(d)))
        assert obj["geom"][fid]["meshes"][0]["color"] == [0.0, 1.0, 0.0, 0.75]


# ---------------------------------------------------------------------------
# lit_box.vkf example
# ---------------------------------------------------------------------------

class TestLitBoxVkf:
    def _run(self):
        from vektorflow.interpreter import Interpreter
        from vektorflow.parser import parse_module
        vkf = REPO / "examples" / "lit_box.vkf"
        src = vkf.read_text(encoding="utf-8")
        ip = Interpreter(vkf)
        ip.run_module(parse_module(src, str(vkf)))
        return ip.globals

    def test_runs(self) -> None:
        g = self._run()
        assert "d" in g

    def test_returns_scene_objects(self) -> None:
        g = self._run()
        assert isinstance(g.get("box"),   SceneBox)
        assert isinstance(g.get("cam"),   SceneCamera)
        assert isinstance(g.get("light"), SceneLight)

    def test_box_has_rotation_from_rotate_by(self) -> None:
        g = self._run()
        box: SceneBox = g["box"]
        # lit_box.vkf calls rotate_by(30, around:"y")
        assert box._data["rotation"][1] == pytest.approx(30.0)

    def test_box_translated(self) -> None:
        g = self._run()
        box: SceneBox = g["box"]
        # lit_box.vkf calls translate([0.5, 0, 0]) after center=[0,0,0]
        assert box.center[0] == pytest.approx(0.5)
