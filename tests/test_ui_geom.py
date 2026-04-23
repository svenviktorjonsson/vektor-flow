"""Tests for 3-D geometry commands on Display: draw_box, add_camera, add_light.

These verify that:
- The Python-side API builds the correct vf-display.json geom section.
- Lighting model names are validated.
- Pending-frame geom ops migrate correctly on add_frame.
- FrameRef.draw_box / .add_camera / .add_light work the same way.
- The lit_box.vkf example runs without error.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from vektorflow.stdlib.ui import Display, build_ui_namespace, LIGHT_MODELS

REPO = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _display_with_placed_frame() -> tuple[Display, str]:
    """Return (display, frame_id) with one frame already placed."""
    d = Display()
    f = d.Frame()
    d.add_frame((0.1, 0.1, 0.5, 0.5))
    return d, f._frame_id


def _geom_for(d: Display, fid: str) -> dict:
    return d._geom.get(fid, {})


# ---------------------------------------------------------------------------
# draw_box
# ---------------------------------------------------------------------------

class TestDrawBox:
    def test_draw_box_defaults(self) -> None:
        d, fid = _display_with_placed_frame()
        d.draw_box(center=[0, 0, 0], scale=[1, 1, 1], color="red")
        g = _geom_for(d, fid)
        assert len(g["meshes"]) == 1
        m = g["meshes"][0]
        assert m["type"] == "box"
        assert m["center"] == [0.0, 0.0, 0.0]
        assert m["scale"]  == [1.0, 1.0, 1.0]
        assert m["color"]  == "red"

    def test_draw_box_scale(self) -> None:
        d, fid = _display_with_placed_frame()
        d.draw_box(center=[0, 0, 0], scale=[1, 2, 3], color="blue")
        m = _geom_for(d, fid)["meshes"][0]
        assert m["scale"] == [1.0, 2.0, 3.0]

    def test_draw_box_hex_color(self) -> None:
        d, fid = _display_with_placed_frame()
        d.draw_box(center=[0, 0, 0], scale=[1, 1, 1], color="#ff8800")
        m = _geom_for(d, fid)["meshes"][0]
        assert m["color"] == "#ff8800"

    def test_draw_box_no_color(self) -> None:
        d, fid = _display_with_placed_frame()
        d.draw_box(center=[1, 2, 3])
        m = _geom_for(d, fid)["meshes"][0]
        assert m["color"] is None

    def test_multiple_boxes_accumulate(self) -> None:
        d, fid = _display_with_placed_frame()
        d.draw_box(center=[0, 0, 0], scale=[1, 1, 1], color="red")
        d.draw_box(center=[3, 0, 0], scale=[0.5, 0.5, 0.5], color="green")
        assert len(_geom_for(d, fid)["meshes"]) == 2

    def test_draw_box_before_frame_raises(self) -> None:
        d = Display()
        with pytest.raises(RuntimeError, match="no frame has been placed"):
            d.draw_box(center=[0, 0, 0])


# ---------------------------------------------------------------------------
# add_camera
# ---------------------------------------------------------------------------

class TestAddCamera:
    def test_camera_pos_target_fov(self) -> None:
        d, fid = _display_with_placed_frame()
        d.add_camera(pos=[4, 3, 5], target=[0, 0, 0], fov=45)
        cam = _geom_for(d, fid)["camera"]
        assert cam is not None
        assert cam["pos"]    == [4.0, 3.0, 5.0]
        assert cam["target"] == [0.0, 0.0, 0.0]
        assert cam["fov"]    == pytest.approx(45.0)
        assert cam["up"]     == [0.0, 1.0, 0.0]

    def test_camera_default_target_and_up(self) -> None:
        d, fid = _display_with_placed_frame()
        d.add_camera(pos=[5, 5, 5])
        cam = _geom_for(d, fid)["camera"]
        assert cam["target"] == [0.0, 0.0, 0.0]
        assert cam["up"]     == [0.0, 1.0, 0.0]

    def test_camera_fov_30(self) -> None:
        d, fid = _display_with_placed_frame()
        d.add_camera(pos=[4, 3, 5], fov=30)
        assert _geom_for(d, fid)["camera"]["fov"] == pytest.approx(30.0)

    def test_camera_overwritten_on_second_call(self) -> None:
        d, fid = _display_with_placed_frame()
        d.add_camera(pos=[1, 1, 1])
        d.add_camera(pos=[2, 2, 2])
        assert _geom_for(d, fid)["camera"]["pos"] == [2.0, 2.0, 2.0]

    def test_camera_requires_pos(self) -> None:
        d, _ = _display_with_placed_frame()
        with pytest.raises(TypeError):
            d.add_camera()  # type: ignore[call-arg]

    def test_camera_custom_up(self) -> None:
        d, fid = _display_with_placed_frame()
        d.add_camera(pos=[0, 5, 0], target=[0, 0, 0], up=[0, 0, 1])
        assert _geom_for(d, fid)["camera"]["up"] == [0.0, 0.0, 1.0]


# ---------------------------------------------------------------------------
# add_light
# ---------------------------------------------------------------------------

class TestAddLight:
    def test_light_blinn_phong(self) -> None:
        d, fid = _display_with_placed_frame()
        d.add_light(pos=[6, 8, 6], model="blinn_phong", color="white")
        lights = _geom_for(d, fid)["lights"]
        assert len(lights) == 1
        assert lights[0]["model"] == "blinn_phong"
        assert lights[0]["color"] == "white"
        assert lights[0]["pos"]   == [6.0, 8.0, 6.0]

    def test_light_lambert(self) -> None:
        d, fid = _display_with_placed_frame()
        d.add_light(pos=[0, 5, 0], model="lambert", color="yellow")
        assert _geom_for(d, fid)["lights"][0]["model"] == "lambert"

    def test_light_flat(self) -> None:
        d, fid = _display_with_placed_frame()
        d.add_light(pos=[0, 5, 0], model="flat")
        assert _geom_for(d, fid)["lights"][0]["model"] == "flat"

    def test_light_phong_alias(self) -> None:
        """'phong' is accepted as alias for blinn_phong."""
        d, fid = _display_with_placed_frame()
        d.add_light(pos=[0, 5, 0], model="phong")
        assert _geom_for(d, fid)["lights"][0]["model"] == "phong"

    def test_light_bad_model_raises(self) -> None:
        d, _ = _display_with_placed_frame()
        with pytest.raises(ValueError, match="unknown"):
            d.add_light(pos=[0, 5, 0], model="gouraud")

    def test_multiple_lights(self) -> None:
        d, fid = _display_with_placed_frame()
        d.add_light(pos=[5, 5, 5], model="blinn_phong", color="white")
        d.add_light(pos=[-5, 3, 0], model="lambert", color="cyan")
        assert len(_geom_for(d, fid)["lights"]) == 2

    def test_known_models_set(self) -> None:
        assert "blinn_phong" in LIGHT_MODELS
        assert "lambert"     in LIGHT_MODELS
        assert "flat"        in LIGHT_MODELS


# ---------------------------------------------------------------------------
# Pending-frame migration
# ---------------------------------------------------------------------------

class TestPendingGeomMigration:
    def test_geom_before_add_frame_migrates(self) -> None:
        d = Display()
        f = d.Frame()
        # add geom BEFORE placing the frame
        d.draw_box(center=[0, 0, 0], scale=[1, 1, 1], color="red")
        d.add_camera(pos=[4, 3, 5])
        d.add_light(pos=[6, 8, 6], model="blinn_phong")
        assert f._frame_id == ""  # not placed yet

        # now place
        d.add_frame((0.1, 0.1, 0.5, 0.5))
        fid = f._frame_id
        assert fid != ""

        g = _geom_for(d, fid)
        assert len(g["meshes"]) == 1
        assert g["camera"] is not None
        assert len(g["lights"]) == 1

    def test_pending_key_cleaned_up(self) -> None:
        d = Display()
        f = d.Frame()
        d.draw_box(center=[0, 0, 0])
        d.add_frame((0.1, 0.1, 0.5, 0.5))
        # no __pending_ keys remain
        for k in d._geom:
            assert not k.startswith("__pending_")


# ---------------------------------------------------------------------------
# FrameRef.draw_box / .add_camera / .add_light
# ---------------------------------------------------------------------------

class TestFrameRefGeom:
    def test_frameref_draw_box(self) -> None:
        d = Display()
        f = d.Frame()
        d.add_frame((0.1, 0.1, 0.5, 0.5))
        fid = f._frame_id
        f.draw_box(center=[1, 0, 0], scale=[2, 1, 1], color="cyan")
        m = _geom_for(d, fid)["meshes"][0]
        assert m["center"] == [1.0, 0.0, 0.0]
        assert m["color"]  == "cyan"

    def test_frameref_add_camera(self) -> None:
        d = Display()
        f = d.Frame()
        d.add_frame((0.1, 0.1, 0.5, 0.5))
        f.add_camera(pos=[3, 3, 3], target=[0, 0, 0], fov=60)
        cam = _geom_for(d, f._frame_id)["camera"]
        assert cam["fov"] == pytest.approx(60.0)

    def test_frameref_add_light(self) -> None:
        d = Display()
        f = d.Frame()
        d.add_frame((0.1, 0.1, 0.5, 0.5))
        f.add_light(pos=[0, 10, 0], model="lambert", color="orange")
        lights = _geom_for(d, f._frame_id)["lights"]
        assert lights[0]["model"] == "lambert"

    def test_two_frames_independent_geom(self) -> None:
        d = Display()
        f1 = d.Frame()
        d.add_frame((0.0, 0.0, 0.5, 1.0))
        f2 = d.Frame()
        d.add_frame((0.5, 0.0, 0.5, 1.0))
        f1.draw_box(center=[0, 0, 0], color="red")
        f2.draw_box(center=[1, 0, 0], color="blue")
        assert len(_geom_for(d, f1._frame_id)["meshes"]) == 1
        assert len(_geom_for(d, f2._frame_id)["meshes"]) == 1
        assert _geom_for(d, f1._frame_id)["meshes"][0]["color"] == "red"
        assert _geom_for(d, f2._frame_id)["meshes"][0]["color"] == "blue"


# ---------------------------------------------------------------------------
# vf-display.json geom section
# ---------------------------------------------------------------------------

class TestDisplayJsonGeomSection:
    def _capture_json(self, d: Display) -> dict:
        """Extract the payload that would be written to vf-display.json."""
        placed_geom = {
            fid: g for fid, g in d._geom.items()
            if not fid.startswith("__pending_")
        }
        return {
            "screen": list(d._screen_ops),
            "frames": {k: list(v) for k, v in d._frame_ops.items()},
            "geom":   placed_geom,
        }

    def test_geom_key_present(self) -> None:
        d, fid = _display_with_placed_frame()
        d.draw_box(center=[0, 0, 0], color="red")
        payload = self._capture_json(d)
        assert "geom" in payload
        assert fid in payload["geom"]

    def test_geom_mesh_serialisable(self) -> None:
        d, fid = _display_with_placed_frame()
        d.draw_box(center=[0, 0, 0], scale=[1, 2, 3], color="red")
        d.add_camera(pos=[4, 3, 5], target=[0, 0, 0], fov=45)
        d.add_light(pos=[6, 8, 6], model="blinn_phong", color="white")
        payload = self._capture_json(d)
        txt = json.dumps(payload)  # must not raise
        obj = json.loads(txt)
        g = obj["geom"][fid]
        assert g["meshes"][0]["type"] == "box"
        assert g["camera"]["fov"]      == pytest.approx(45.0)
        assert g["lights"][0]["model"] == "blinn_phong"

    def test_geom_not_in_json_for_2d_only(self) -> None:
        d, fid = _display_with_placed_frame()
        d.draw_rect((0.1, 0.1, 0.3, 0.3), color="blue")
        # geom dict is empty → no geom section for this frame
        payload = self._capture_json(d)
        assert fid not in payload.get("geom", {})


# ---------------------------------------------------------------------------
# lit_box.vkf example
# ---------------------------------------------------------------------------

class TestLitBoxVkf:
    def test_lit_box_runs(self) -> None:
        from vektorflow.interpreter import Interpreter
        from vektorflow.parser import parse_module

        vkf = REPO / "examples" / "lit_box.vkf"
        assert vkf.is_file(), f"lit_box.vkf not found at {vkf}"
        src = vkf.read_text(encoding="utf-8")
        mod = parse_module(src, str(vkf))
        ip = Interpreter(vkf)
        ip.run_module(mod)  # must not raise
        d = ip.globals.get("d")
        assert d is not None, "lit_box.vkf must assign display to 'd'"

    def test_lit_box_produces_geom(self) -> None:
        from vektorflow.interpreter import Interpreter
        from vektorflow.parser import parse_module

        vkf = REPO / "examples" / "lit_box.vkf"
        src = vkf.read_text(encoding="utf-8")
        mod = parse_module(src, str(vkf))
        ip = Interpreter(vkf)
        ip.run_module(mod)
        d = ip.globals["d"]
        placed = {fid: g for fid, g in d._geom.items() if not fid.startswith("__pending_")}
        assert placed, "Expected at least one placed frame with geom data"
        # Pick the first (and only) frame
        g = next(iter(placed.values()))
        assert len(g["meshes"]) == 1
        assert g["meshes"][0]["type"]   == "box"
        assert g["meshes"][0]["scale"]  == [1.0, 2.0, 3.0]
        assert g["meshes"][0]["color"]  == "red"
        assert g["camera"] is not None
        assert g["camera"]["pos"]       == [4.0, 3.0, 5.0]
        assert g["camera"]["fov"]       == pytest.approx(45.0)
        assert len(g["lights"]) == 1
        assert g["lights"][0]["model"]  == "blinn_phong"
        assert g["lights"][0]["color"]  == "white"
