"""Stdlib ``screen`` — frames and scene commands."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib import STDLIB_MODULES, resolve_stdlib
from vektorflow.stdlib.screen import PendingFrame, Screen, build_screen_namespace
from vektorflow.stdlib.ui import Display, build_ui_namespace

_REPO = Path(__file__).resolve().parents[1]


def test_screen_and_bridge_not_registered_stdlib() -> None:
    assert "screen" not in STDLIB_MODULES
    assert "bridge" not in STDLIB_MODULES
    with pytest.raises(KeyError):
        resolve_stdlib("screen")
    with pytest.raises(KeyError):
        resolve_stdlib("bridge")


def test_screen_frame_and_add_frame() -> None:
    s = build_screen_namespace()["screen"]()
    f = s.frame(
        draggable=True,
        alpha=0.7,
        closable=True,
        dockable=True,
    )
    assert isinstance(f, PendingFrame)
    assert f.alpha == 0.7
    s.add_frame(f, (0.2, 0.2, 0.4, 0.4))
    raw = json.loads(s.dumps())
    assert len(raw) == 1
    assert raw[0]["kind"] == "frame_upsert"
    assert raw[0]["payload"]["spec"]["rect"]["w"] == 0.4
    assert raw[0]["payload"]["spec"]["flags"]["draggable"] is True
    assert raw[0]["payload"]["spec"]["master"] is False


def test_frame_title_align_keys() -> None:
    s = build_screen_namespace()["screen"]()
    c = s.frame(title="C")
    assert c.title == "C"
    assert c.title_align == "center"
    r = s.frame(__title="R")
    assert r.title == "R"
    assert r.title_align == "right"
    l = s.frame(title__="L")
    assert l.title == "L"
    assert l.title_align == "left"
    mid = s.frame(title="single_underscores_ok")
    assert mid.title == "single_underscores_ok"
    assert mid.title_align == "center"


def test_frame_title_and_name_alias() -> None:
    s = build_screen_namespace()["screen"]()
    f1 = s.frame(title="My first frame", closable=False, dockable=False)
    assert f1.title == "My first frame"
    s.add_frame(f1, (0.1, 0.1, 0.3, 0.3))
    f2 = s.frame(name="Via name", dockable=False, closable=True)
    assert f2.title == "Via name"
    s.add_frame(f2, (0.2, 0.2, 0.2, 0.2))
    raw = json.loads(s.dumps())
    assert raw[0]["payload"]["spec"]["title"] == "My first frame"
    assert raw[0]["payload"]["spec"]["flags"]["closable"] is False
    assert raw[0]["payload"]["spec"]["flags"]["dockable"] is False
    assert raw[1]["payload"]["spec"]["title"] == "Via name"
    assert raw[1]["payload"]["spec"]["flags"]["dockable"] is False


def test_screen_master_frame() -> None:
    s = build_screen_namespace()["screen"]()
    f = s.frame(master=True, alpha=1.0)
    assert f.master is True
    s.add_frame(f, (0.0, 0.0, 0.5, 0.5))
    raw = json.loads(s.dumps())
    assert raw[0]["payload"]["spec"]["master"] is True


def test_add_frame_under_relative_layout_bl_stacks_up() -> None:
    """``bl``: ``under`` grows toward the bottom edge (new frame above the ref)."""
    s = build_screen_namespace()["screen"]()
    f = s.frame(title="A", dock_location="bl")
    f2 = s.frame(title="B", dock_location="bl")
    s.add_frame(f, (0.1, 0.55, 0.2, 0.2))
    s.add_frame(f2, under=f)
    data = json.loads(s.dumps())
    r0 = data[0]["payload"]["spec"]["rect"]
    r1 = data[1]["payload"]["spec"]["rect"]
    assert r0["w"] == r1["w"] and r0["h"] == r1["h"] == 0.2
    assert r1["y"] == r0["y"] - r0["h"] - 0.01
    assert r0["x"] == r1["x"]


def test_add_frame_under_relative_layout_tr_stacks_down() -> None:
    """``tr``: ``under`` is below the reference (+y)."""
    s = build_screen_namespace()["screen"]()
    f = s.frame(title="A", dock_location="tr")
    f2 = s.frame(title="B", dock_location="tr")
    s.add_frame(f, (0.55, 0.1, 0.2, 0.15))
    s.add_frame(f2, under=f)
    data = json.loads(s.dumps())
    r0 = data[0]["payload"]["spec"]["rect"]
    r1 = data[1]["payload"]["spec"]["rect"]
    assert r0["h"] == r1["h"]
    assert r1["y"] == r0["y"] + r0["h"] + 0.01
    assert r0["x"] == r1["x"]


def test_add_frame_cr_under_stacks_left() -> None:
    s = build_screen_namespace()["screen"]()
    f = s.frame(dock_location="cr")
    f2 = s.frame(dock_location="cr")
    s.add_frame(f, (0.72, 0.3, 0.12, 0.2))
    s.add_frame(f2, under=f)
    d = json.loads(s.dumps())
    r0 = d[0]["payload"]["spec"]["rect"]
    r1 = d[1]["payload"]["spec"]["rect"]
    assert r1["x"] < r0["x"]
    assert r1["y"] == 0.5 * (1.0 - r1["h"])


def test_add_frame_bc_under_centers_x() -> None:
    s = build_screen_namespace()["screen"]()
    f = s.frame(dock_location="bc")
    f2 = s.frame(dock_location="bc")
    s.add_frame(f, (0.1, 0.72, 0.2, 0.1))
    s.add_frame(f2, under=f)
    d = json.loads(s.dumps())
    r1 = d[1]["payload"]["spec"]["rect"]
    assert r1["x"] == 0.5 * (1.0 - r1["w"])


def test_vkf_add_frame_under() -> None:
    src = """
:.ui
d: ui.display
f: d.frame(title: "A", draggable: true, dockable: true, dock_loc: "tr")
f2: d.frame(title: "B", closable: true, dockable: false, resizable: false, dock_loc: "tr")
d.add_frame(f, (0.2, 0.1, 0.3, 0.15))
d.add_frame(f2, under: f)
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)
    d = ip.globals["d"]
    data = json.loads(d.dumps())
    assert len(data) == 2
    assert data[1]["payload"]["spec"]["rect"]["y"] > data[0]["payload"]["spec"]["rect"]["y"]


def test_add_frame_with_body() -> None:
    d = build_ui_namespace()["ui"].display
    w = d.widget
    f = d.frame(title="W")
    d.add_frame(
        f,
        (0.1, 0.1, 0.3, 0.2),
        body=[w.label("L", text="hi"), w.button("B", label="ok")],
    )
    data = json.loads(d.dumps())
    b = data[0]["payload"]["spec"].get("body")
    assert isinstance(b, list)
    assert b[0]["id"] == "L" and b[0]["type"] == "label"
    assert b[1]["id"] == "B" and b[1]["type"] == "button"
    assert f.id == data[0]["payload"]["spec"]["id"]


def test_add_frame_with_gridlayout_and_widget_grid_slots() -> None:
    d = build_ui_namespace()["ui"].display
    w = d.widget
    f = d.frame(title="Grid", gridlayout=(3, 4))
    d.add_frame(
        f,
        (0.1, 0.1, 0.4, 0.3),
        body=[
            w.label("L", text="hi", grid=(0, 0, 1, 2)),
            w.button("B", label="ok", grid=(1, 2, 2, 2)),
        ],
    )
    data = json.loads(d.dumps())
    spec = data[0]["payload"]["spec"]
    assert spec["body_layout"] == {"type": "grid", "rows": 3, "cols": 4}
    assert spec["body"][0]["grid"] == [0, 0, 1, 2]
    assert spec["body"][1]["grid"] == [1, 2, 2, 2]


def test_display_draw_and_frame_draw_match_draw_rect() -> None:
    d = build_ui_namespace()["ui"].display
    d.draw((0.0, 0.0, 0.2, 0.2), color="#010101")
    d.draw_rect((0.3, 0.3, 0.1, 0.1), color="#020202")
    f = d.frame(title="F")
    d.add_frame(f, (0.4, 0.4, 0.2, 0.2))
    f.draw((0.0, 0.0, 0.5, 0.5), color="#030303")
    f.draw_rect((0.5, 0.5, 0.2, 0.2), color="#040404")
    out = _REPO / "web" / "vf-ui" / "vf-display.json"
    if not out.is_file():
        pytest.skip("vf-display.json not written (repo root resolution)")
    data = json.loads(out.read_text(encoding="utf-8"))
    assert len(data.get("screen", [])) == 2
    fid = f.id
    assert len((data.get("frames") or {}).get(fid, [])) == 2


def test_ui_display_two_frames_draw_rect_produces_vf_display_payload() -> None:
    d = build_ui_namespace()["ui"].display
    f = d.frame(title="A", dock_loc="bl")
    f2 = d.frame(title="B", dock_loc="bl")
    d.add_frame(f, (0.1, 0.5, 0.3, 0.2))
    d.add_frame(f2, under=f)
    f.draw_rect((0.0, 0.0, 0.5, 0.5), color="#ff0000")
    f2.draw_rect((0.1, 0.1, 0.8, 0.3), color="#00aa00")
    out = _REPO / "web" / "vf-ui" / "vf-display.json"
    if not out.is_file():
        pytest.skip("vf-display.json not written (repo root resolution)")
    data = json.loads(out.read_text(encoding="utf-8"))
    frames = data.get("frames") or {}
    id1 = f.id
    id2 = f2.id
    assert id1 and id2 and id1 != id2
    assert id1 in frames and id2 in frames
    assert len(frames[id1]) >= 1 and frames[id1][0].get("op") == "rect"
    assert len(frames[id2]) >= 1 and frames[id2][0].get("op") == "rect"


def test_vkf_screen_spill_and_add_frame() -> None:
    src = """
:.ui
d: ui.display
f: d.frame(draggable: true, alpha: 0.7, closable: true, dockable: true)
d.add_frame(f, (0.2, 0.2, 0.4, 0.4))
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)
    d = ip.globals["d"]
    assert isinstance(d, Display)
    data = json.loads(d.dumps())
    assert data[0]["kind"] == "frame_upsert"
    assert data[0]["payload"]["spec"]["alpha"] == 0.7
