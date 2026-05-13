"""Stdlib ``screen`` — frames and scene commands."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from vektorflow.errors import EvalError
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime.vfvector import VFVector
from vektorflow.stdlib import STDLIB_MODULES, resolve_stdlib
from vektorflow.stdlib import ui as ui_stdlib
from vektorflow.stdlib.screen import PendingFrame, Screen, build_screen_namespace
from vektorflow.stdlib.ui import (
    Display,
    SceneRepresentation,
    _decode_pick_id,
    _pick_hit,
    _pick_index_from_event,
    _pick_kind_from_event,
    _match_pick_id,
    _pack_pick_id,
    build_ui_namespace,
)
from vektorflow.ui.launch import reset_launch_state
from vektorflow.ui.payloads import get_ui_payload_snapshot, reset_ui_payload_snapshot
from vektorflow.ui.display_runtime import (
    build_display_payload,
    has_visible_display_content,
)
from vektorflow.ui.scene_runtime import (
    append_frame_upsert,
    dump_scene_commands,
)
from vektorflow.ui.ir import FrameFlags, FrameSpec, NormRect

_REPO = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _reset_ui_payload_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_launch_state()
    reset_ui_payload_snapshot()
    monkeypatch.setattr("vektorflow.ui.launch.maybe_launch_ui", lambda: None)


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
d: display
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


def test_text_area_widget_supports_rows_and_readonly() -> None:
    d = build_ui_namespace()["ui"].display
    w = d.widget
    f = d.frame(title="Log")
    d.add_frame(
        f,
        (0.1, 0.1, 0.3, 0.2),
        body=[w.text_area("log", text="hello", rows=12, readonly=True)],
    )
    data = json.loads(d.dumps())
    spec = data[0]["payload"]["spec"]["body"][0]
    assert spec["type"] == "textarea"
    assert spec["rows"] == 12
    assert spec["readonly"] is True


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
    data = get_ui_payload_snapshot().display
    assert len(data.get("screen", [])) == 2
    fid = f.id
    assert len((data.get("frames") or {}).get(fid, [])) == 2


def test_display_manual_render_defers_sync_until_render(monkeypatch: pytest.MonkeyPatch) -> None:
    writes: list[dict[str, object]] = []

    monkeypatch.setattr(ui_stdlib, "_write_vkf_scene_to_vf_ui", lambda commands: writes.append({"scene": len(commands)}))
    monkeypatch.setattr(ui_stdlib, "_write_vf_display_json", lambda payload: writes.append({"display": payload}))
    monkeypatch.setattr("vektorflow.ui.launch.maybe_launch_ui", lambda: writes.append({"launch": True}))

    d = Display()
    d.set_auto_render(False)
    f = d.Frame()
    d.add_frame(f, (0.1, 0.1, 0.3, 0.2))
    f.draw_rect((0.0, 0.0, 0.5, 0.5), color="#ff0000")

    assert not any("scene" in item for item in writes)
    assert not any("display" in item for item in writes)
    assert d._dirty is True

    d.render()

    assert any("scene" in item for item in writes)
    assert any("display" in item for item in writes)
    assert d._dirty is False


def test_add_frame_respects_manual_render(monkeypatch: pytest.MonkeyPatch) -> None:
    writes: list[dict[str, object]] = []

    monkeypatch.setattr(ui_stdlib, "_write_vf_display_json", lambda payload: writes.append({"display": payload}))
    monkeypatch.setattr(ui_stdlib, "_write_vkf_scene_to_vf_ui", lambda commands: writes.append({"scene": len(commands)}))
    monkeypatch.setattr("vektorflow.stdlib.screen._write_vkf_scene_to_vf_ui", lambda commands: writes.append({"screen_scene": len(commands)}))
    monkeypatch.setattr("vektorflow.stdlib.screen._write_vf_ui_state_to_vf_ui", lambda state: writes.append({"state": state}))
    monkeypatch.setattr("vektorflow.ui.launch.maybe_launch_ui", lambda: writes.append({"launch": True}))

    d = Display()
    d.set_auto_render(False)
    f = d.Frame()
    d.add_frame(f, (0.1, 0.1, 0.3, 0.2))

    assert not any("screen_scene" in item for item in writes)
    assert not any("scene" in item for item in writes)
    assert not any("display" in item for item in writes)
    assert d._dirty is True

    d.render()

    assert any("scene" in item for item in writes)
    assert any("display" in item for item in writes)


def test_display_sync_all_rewrites_scene_only_when_command_count_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scene_writes: list[int] = []
    display_writes: list[dict[str, object]] = []

    monkeypatch.setattr(ui_stdlib, "_write_vkf_scene_to_vf_ui", lambda commands: scene_writes.append(len(commands)))
    monkeypatch.setattr(ui_stdlib, "_write_vf_display_json", lambda payload: display_writes.append(payload))
    monkeypatch.setattr("vektorflow.ui.launch.maybe_launch_ui", lambda: None)

    d = Display()
    f = d.Frame()
    d.add_frame(f, (0.1, 0.1, 0.3, 0.2))
    f.draw_rect((0.0, 0.0, 0.5, 0.5), color="#ff0000")
    f.draw_rect((0.5, 0.5, 0.2, 0.2), color="#00ff00")

    assert scene_writes == [1]
    assert len(display_writes) == 3
    assert display_writes[-1]["frames"][f.id][1]["color"] == "#00ff00"


def test_display_runtime_payload_builders_filter_pending_and_merge_representation_ops() -> None:
    payload = build_display_payload(
        screen_ops=[{"op": "rect", "color": "#111111"}],
        screen_repr_ops={"rep_1": [{"op": "oval", "color": "#222222"}]},
        frame_ops={
            "f1": [{"op": "rect", "color": "#333333"}],
            "__pending_1": [{"op": "rect", "color": "#deadbe"}],
        },
        frame_repr_ops={
            "f1": {"rep_2": [{"op": "line", "color": "#444444"}]},
            "__pending_1": {"rep_3": [{"op": "oval", "color": "#badbad"}]},
        },
        geom={
            "f1": {"meshes": [{"type": "box"}], "camera": None, "lights": []},
            "__pending_1": {"meshes": [{"type": "ghost"}], "camera": None, "lights": []},
        },
    )

    assert payload["screen"] == [
        {"op": "rect", "color": "#111111"},
        {"op": "oval", "color": "#222222"},
    ]
    assert payload["frames"] == {
        "f1": [
            {"op": "rect", "color": "#333333"},
            {"op": "line", "color": "#444444"},
        ]
    }
    assert payload["geom"] == {"f1": {"meshes": [{"type": "box"}], "camera": None, "lights": []}}


def test_display_runtime_visibility_helper_tracks_real_content_only() -> None:
    empty_payload = {"screen": [], "frames": {}, "geom": {}}
    assert has_visible_display_content(commands=[], payload=empty_payload) is False
    assert has_visible_display_content(commands=[{"kind": "frame_upsert"}], payload=empty_payload) is True
    assert has_visible_display_content(commands=[], payload={"screen": [{"op": "rect"}], "frames": {}, "geom": {}}) is True
    assert has_visible_display_content(commands=[], payload={"screen": [], "frames": {"f1": []}, "geom": {}}) is True
    assert has_visible_display_content(commands=[], payload={"screen": [], "frames": {}, "geom": {"f1": {}}}) is True


def test_scene_runtime_append_frame_upsert_owns_command_shape() -> None:
    commands = []
    spec = FrameSpec(
        id="f1",
        title="Probe",
        title_align="left",
        rect=NormRect(0.1, 0.2, 0.3, 0.4),
        flags=FrameFlags(),
        alpha=1.0,
        master=False,
        dock_location="bl",
        anchor="tl",
    )

    cmd = append_frame_upsert(commands, frame_id="f1", spec=spec)

    assert cmd.kind == "frame_upsert"
    assert len(commands) == 1
    assert commands[0].payload["spec"]["id"] == "f1"
    dumped = json.loads(dump_scene_commands(commands))
    assert dumped[0]["kind"] == "frame_upsert"
    assert dumped[0]["payload"]["spec"]["title"] == "Probe"


def test_representation_refresh_stays_on_display_hot_path_without_scene_rewrite(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scene_writes: list[int] = []
    display_writes: list[dict[str, object]] = []

    monkeypatch.setattr(ui_stdlib, "_write_vkf_scene_to_vf_ui", lambda commands: scene_writes.append(len(commands)))
    monkeypatch.setattr(ui_stdlib, "_write_vf_display_json", lambda payload: display_writes.append(payload))
    monkeypatch.setattr("vektorflow.ui.launch.maybe_launch_ui", lambda: None)

    d = Display()
    f = d.Frame()
    d.add_frame(f, (0.1, 0.1, 0.3, 0.2))

    def emb(_value: object, view: dict[str, object]) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]),
            "edge_indices": VFVector([[0, 1], [1, 2], [2, 3], [3, 0]]),
            "face_indices": VFVector([[0, 1, 2, 3]]),
            "face_color": view["face_color"],
            "edge_color": view["edge_color"],
        }

    rep = f.add({"ignored": True}, emb, {"face_color": "#ff0000", "edge_color": "#0000ff"})
    assert isinstance(rep, SceneRepresentation)
    initial_scene_writes = list(scene_writes)
    initial_display_count = len(display_writes)

    rep.set_view({"face_color": "#00ff00", "edge_color": "#ff00ff"})

    assert scene_writes == initial_scene_writes
    assert len(display_writes) == initial_display_count + 1
    assert display_writes[-1]["frames"][f.id][0]["color"] == "#00ff00"
    assert display_writes[-1]["frames"][f.id][1]["color"] == "#ff00ff"

def test_screen_draw_ops_stay_on_display_hot_path_without_scene_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scene_writes: list[int] = []
    display_writes: list[dict[str, object]] = []

    monkeypatch.setattr(ui_stdlib, "_write_vkf_scene_to_vf_ui", lambda commands: scene_writes.append(len(commands)))
    monkeypatch.setattr(ui_stdlib, "_write_vf_display_json", lambda payload: display_writes.append(payload))
    monkeypatch.setattr("vektorflow.ui.launch.maybe_launch_ui", lambda: None)

    d = Display()

    d.draw_rect((0.0, 0.0, 0.5, 0.5), color="#ff0000")
    initial_scene_writes = list(scene_writes)
    d.draw_rect((0.5, 0.5, 0.25, 0.25), color="#00ff00")

    assert initial_scene_writes == [0]
    assert scene_writes == initial_scene_writes
    assert len(display_writes) == 2
    assert display_writes[-1]["screen"][0]["color"] == "#ff0000"
    assert display_writes[-1]["screen"][1]["color"] == "#00ff00"


def test_ui_display_two_frames_draw_rect_produces_vf_display_payload() -> None:
    d = build_ui_namespace()["ui"].display
    f = d.frame(title="A", dock_loc="bl")
    f2 = d.frame(title="B", dock_loc="bl")
    d.add_frame(f, (0.1, 0.5, 0.3, 0.2))
    d.add_frame(f2, under=f)
    f.draw_rect((0.0, 0.0, 0.5, 0.5), color="#ff0000")
    f2.draw_rect((0.1, 0.1, 0.8, 0.3), color="#00aa00")
    data = get_ui_payload_snapshot().display
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
d: display
f: Frame()
d.add_frame(f, (0.2, 0.2, 0.4, 0.4))
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)
    d = ip.globals["d"]
    assert isinstance(d, Display)
    data = json.loads(d.dumps())
    assert data[0]["kind"] == "frame_upsert"
    assert data[0]["payload"]["spec"]["alpha"] == 1.0


def test_vkf_ui_spill_does_not_bind_ui_namespace_name() -> None:
    src = """
:.ui
d: ui.display
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    with pytest.raises(EvalError, match="undefined name: 'ui'"):
        ip.run_module(mod)


def test_vkf_ui_alias_keeps_namespace_access() -> None:
    src = """
ui:.ui
d: ui.display
f: ui.Frame((0.2, 0.2, 0.4, 0.4))
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)
    d = ip.globals["d"]
    assert isinstance(d, Display)
    data = json.loads(d.dumps())
    assert data[0]["kind"] == "frame_upsert"
    assert data[0]["payload"]["spec"]["rect"] == {"x": 0.2, "y": 0.2, "w": 0.4, "h": 0.4}


def test_vkf_ui_alias_does_not_spill_display_into_scope() -> None:
    src = """
ui:.ui
d: display
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    with pytest.raises(EvalError, match="undefined name: 'display'"):
        ip.run_module(mod)


def test_vkf_frame_add_with_embedding_returns_representation_and_draw_ops() -> None:
    src = """
ui:.ui

RectEmbedding(r):
    vertices: [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.7],
        [0.1, 0.7]
    ]

    edge_indices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0]
    ]

    face_indices: [
        [0, 1, 2, 3]
    ]

    edge_color(x):
        r.border_color

    edge_scale(x):
        r.border_scale

    face_color(p):
        r.fill_color

    :

screen: ui.display
frame: ui.Frame((0.1, 0.1, 0.5, 0.4))
rect: (
    fill_color: [0.2, 0.4, 1.0, 1.0],
    border_color: [1.0, 0.1, 0.1, 1.0],
    border_scale: 0.01
)
rep: frame.add(rect, RectEmbedding)
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)

    rep = ip.globals["rep"]
    assert isinstance(rep, SceneRepresentation)

    data = get_ui_payload_snapshot().display
    frame_id = ip.globals["frame"].id
    ops = (data.get("frames") or {}).get(frame_id, [])
    assert [op.get("op") for op in ops] == ["polygon", "polyline", "polyline", "polyline", "polyline"]


def test_vkf_display_add_with_embedding_draws_on_root_surface() -> None:
    src = """
ui:.ui

DotEmbedding(d):
    vertices: [
        [0.25, 0.25]
    ]

    vertex_color: d.color
    vertex_scale: 0.03

    :

screen: ui.display
dot: (color: [0.0, 0.8, 0.2, 1.0],)
rep: screen.add(dot, DotEmbedding)
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)

    rep = ip.globals["rep"]
    assert isinstance(rep, SceneRepresentation)

    data = get_ui_payload_snapshot().display
    ops = data.get("screen") or []
    assert len(ops) == 1
    assert ops[0]["op"] == "point"


def test_frame_graphics_defaults_override_display_defaults() -> None:
    d = build_ui_namespace()["ui"].display
    d.set_graphics_defaults(face={"color": "#112233"}, edge={"color": "#445566", "scale": 0.02})
    f = d.Frame()
    d.add_frame(f, (0.1, 0.1, 0.4, 0.3))
    f.set_graphics_defaults(edge={"color": "#abcdef"})

    value = {"fill_color": "#ff0000"}

    def emb(v: dict[str, str]) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]),
            "edge_indices": VFVector([[0, 1], [1, 2], [2, 0]]),
            "face_indices": VFVector([[0, 1, 2]]),
            "face_color": v["fill_color"],
        }

    rep = f.add(value, emb)
    assert isinstance(rep, SceneRepresentation)

    data = get_ui_payload_snapshot().display
    ops = (data.get("frames") or {}).get(f.id, [])
    assert ops[0]["op"] == "polygon"
    assert ops[0]["color"] == "#ff0000"
    assert ops[1]["color"] == "#abcdef"
    assert ops[1]["width"] == 0.02


def test_pending_frame_representation_migrates_on_placement() -> None:
    d = build_ui_namespace()["ui"].display
    f = d.Frame()

    def emb(_v: object) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.1, 0.1], [0.9, 0.1], [0.5, 0.8]]),
            "face_indices": VFVector([[0, 1, 2]]),
            "face_color": "#3366ff",
        }

    rep = f.add({"ignored": True}, emb)
    assert isinstance(rep, SceneRepresentation)
    assert rep._frame_id.startswith("__pending_")

    before = get_ui_payload_snapshot().display
    assert not before.get("frames")

    d.add_frame(f, (0.1, 0.1, 0.4, 0.3))

    assert rep._frame_id == f.id
    after = get_ui_payload_snapshot().display
    ops = (after.get("frames") or {}).get(f.id, [])
    assert ops
    assert any(op.get("op") == "polygon" and op.get("color") == "#3366ff" for op in ops)


def test_display_defaults_refresh_existing_representation() -> None:
    d = build_ui_namespace()["ui"].display

    def emb(_v: object) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.25, 0.25]]),
        }

    rep = d.add({"ignored": True}, emb)
    assert isinstance(rep, SceneRepresentation)

    data = get_ui_payload_snapshot().display
    assert data["screen"][0]["color"] == "#222222"

    d.set_graphics_defaults(vertex={"color": "#00ff00", "scale": 0.04})
    data = get_ui_payload_snapshot().display
    assert data["screen"][0]["color"] == "#00ff00"
    assert data["screen"][0]["radius"] == 0.04


def test_representation_set_view_refreshes_output() -> None:
    d = build_ui_namespace()["ui"].display
    f = d.Frame()
    d.add_frame(f, (0.1, 0.1, 0.4, 0.3))

    value = {"fill_color": "#ff0000"}
    view = {"border_color": "#0000ff", "border_scale": 0.01}

    def emb(v: dict[str, str], view_state: dict[str, object]) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]),
            "edge_indices": VFVector([[0, 1], [1, 2], [2, 3], [3, 0]]),
            "face_indices": VFVector([[0, 1, 2, 3]]),
            "face_color": v["fill_color"],
            "edge_color": view_state["border_color"],
            "edge_scale": view_state["border_scale"],
        }

    rep = f.add(value, emb, view)
    assert isinstance(rep, SceneRepresentation)

    data = get_ui_payload_snapshot().display
    ops = (data.get("frames") or {}).get(f.id, [])
    assert ops[1]["color"] == "#0000ff"
    assert ops[1]["width"] == 0.01

    rep.set_view({"border_color": "#00ffff", "border_scale": 0.03})
    data = get_ui_payload_snapshot().display
    ops = (data.get("frames") or {}).get(f.id, [])
    assert ops[1]["color"] == "#00ffff"
    assert ops[1]["width"] == 0.03


def test_styles_affect_emitted_ops() -> None:
    ui = build_ui_namespace()["ui"]
    d = ui.display
    g = ui.graphics

    def emb(_value: object) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.2, 0.2], [0.8, 0.2], [0.8, 0.8]]),
            "edge_indices": VFVector([[0, 1], [1, 2]]),
            "vertex_style": [
                g.VertexStyle(marker="square"),
                g.VertexStyle(marker="diamond"),
                g.VertexStyle(marker="circle"),
            ],
            "edge_style": g.EdgeStyle(pattern="dashed", cap="square"),
            "vertex_scale": [0.02, 0.03, 0.04],
        }

    rep = d.add({"ignored": True}, emb)
    assert isinstance(rep, SceneRepresentation)

    data = get_ui_payload_snapshot().display
    ops = data.get("screen") or []
    point_ops = [op for op in ops if op["op"] == "point"]
    edge_ops = [op for op in ops if op["op"] == "polyline"]
    assert [op["shape"] for op in point_ops] == ["square", "diamond", "circle"]
    assert all(op["pattern"] == "dashed" for op in edge_ops)
    assert all(op["cap"] == "square" for op in edge_ops)


def test_vertex_style_content_inherits_defaults_and_hosts_embedding() -> None:
    ui = build_ui_namespace()["ui"]
    d = ui.display
    g = ui.graphics
    d.set_graphics_defaults(face={"color": "#123456"})

    def marker_embedding(_value: object) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.0, -0.5], [0.5, 0.5], [-0.5, 0.5]]),
            "face_indices": VFVector([[0, 1, 2]]),
        }

    def emb(_value: object) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.4, 0.4]]),
            "vertex_scale": 0.05,
            "vertex_style": g.VertexStyle(marker="none", content=marker_embedding),
        }

    rep = d.add({"ignored": True}, emb)
    assert isinstance(rep, SceneRepresentation)

    data = get_ui_payload_snapshot().display
    ops = data.get("screen") or []
    assert len(ops) == 1
    assert ops[0]["op"] == "polygon"
    assert ops[0]["color"] == "#123456"


def test_face_style_content_is_transformed_into_face_space() -> None:
    ui = build_ui_namespace()["ui"]
    d = ui.display
    g = ui.graphics

    def child_embedding(_value: object) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.25, 0.75]]),
            "vertex_color": "#ff00ff",
            "vertex_scale": 0.02,
        }

    def emb(_value: object) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.1, 0.1], [0.9, 0.1], [0.9, 0.7], [0.1, 0.7]]),
            "face_indices": VFVector([[0, 1, 2, 3]]),
            "face_style": g.FaceStyle(filled=False, content=child_embedding),
        }

    rep = d.add({"ignored": True}, emb)
    assert isinstance(rep, SceneRepresentation)

    data = get_ui_payload_snapshot().display
    ops = data.get("screen") or []
    assert len(ops) == 1
    assert ops[0]["op"] == "point"
    assert ops[0]["point"] == pytest.approx([0.3, 0.55])


def test_pick_id_pack_decode_and_match() -> None:
    pick_id = _pack_pick_id(7, 3, 42, content_path=13, sub_index=5)
    decoded = _decode_pick_id(pick_id)
    assert decoded["representation"] == 7
    assert decoded["carrier_kind"] == "face"
    assert decoded["carrier_index"] == 42
    assert decoded["content_path"] == 13
    assert decoded["sub_index"] == 5
    assert _match_pick_id(pick_id, pick_id, (1 << 64) - 1)
    semantic_target = _pack_pick_id(7, 3, 42)
    assert _match_pick_id(pick_id, semantic_target, pick_id & ~((1 << 24) - 1))


def test_pick_helpers_match_representation_and_decode_carrier_kind() -> None:
    rep = _pack_pick_id(9, 0, 0)
    face = _pack_pick_id(9, 3, 4, content_path=12, sub_index=1)
    target = {
        "pick_id": rep,
        "pick_mask_representation": (1 << 64) - (1 << 56),
        "pick_mask_carrier": (1 << 64) - (1 << 24),
        "pick_mask_content": (1 << 64) - (1 << 8),
        "pick_mask_exact": (1 << 64) - 1,
    }
    event = {"pick_id": face, "object_id": 1}
    assert _pick_hit(event, target, "representation") is True
    assert _pick_kind_from_event(event) == "face"
    assert _pick_index_from_event(event) == 4
    assert _pick_index_from_event({"pick_id": 0}) == -1


def test_build_ui_namespace_exposes_pick_helpers() -> None:
    ns = build_ui_namespace()
    assert ns["hit"] is _pick_hit
    assert ns["pick_kind"] is _pick_kind_from_event
    assert ns["pick_index"] is _pick_index_from_event


def test_emitted_ops_include_semantic_pick_ids_for_hosted_content() -> None:
    ui = build_ui_namespace()["ui"]
    d = ui.display
    g = ui.graphics

    def marker_embedding(_value: object) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.0, -0.5], [0.45, 0.5], [-0.45, 0.5]]),
            "face_indices": VFVector([[0, 1, 2]]),
            "face_color": "#ff0044",
        }

    def emb(_value: object) -> dict[str, object]:
        return {
            "vertices": VFVector([[0.2, 0.2], [0.8, 0.2], [0.8, 0.8]]),
            "edge_indices": VFVector([[0, 1], [1, 2]]),
            "vertex_scale": [0.03, 0.03, 0.03],
            "vertex_style": [
                g.VertexStyle(marker="none", content=marker_embedding),
                g.VertexStyle(marker="square"),
                g.VertexStyle(marker="diamond"),
            ],
            "edge_color": "#224",
            "edge_scale": 0.012,
            "edge_style": g.EdgeStyle(pattern="dashed", cap="square"),
        }

    rep = d.add({"ignored": True}, emb)
    assert isinstance(rep, SceneRepresentation)

    data = get_ui_payload_snapshot().display
    ops = data.get("screen") or []
    assert ops
    for op in ops:
        assert "pick_id" in op
        assert "pick_mask_representation" in op
        assert "pick_mask_carrier" in op
        assert "pick_mask_content" in op
        assert "pick_mask_exact" in op

    decoded = [_decode_pick_id(op["pick_id"]) for op in ops]
    assert any(item["carrier_kind"] == "edge" for item in decoded)
    assert any(item["carrier_kind"] == "vertex" for item in decoded)
    assert any(item["carrier_kind"] == "face" for item in decoded)
    assert all(item["representation"] == rep.rep_ordinal for item in decoded)
    hosted_faces = [item for item in decoded if item["carrier_kind"] == "face" and item["content_path"] != 0]
    assert hosted_faces


def test_frame_add_accepts_vkf_scope_returning_embedding_constructor() -> None:
    src = """
ui:.ui
g: ui.graphics

quad(v):
    vertices: [
        [0.2, 0.2],
        [0.8, 0.2],
        [0.5, 0.8]
    ]
    face_indices: [
        [0, 1, 2]
    ]
    face_color: "#ff3344"
    :

frame: ui.Frame()
rep: frame.add((), quad)
screen: ui.display
screen.add_frame(frame, (0.1, 0.1, 0.4, 0.4))
screen.render()
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    rep = ip.globals["rep"]
    frame = ip.globals["frame"]
    assert isinstance(rep, SceneRepresentation)
    ops = (get_ui_payload_snapshot().display.get("frames") or {}).get(frame.id, [])
    assert len(ops) == 1
    assert ops[0]["op"] == "polygon"
    assert ops[0]["color"] == "#ff3344"
