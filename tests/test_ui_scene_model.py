from __future__ import annotations

from pathlib import Path

from vektorflow.ui_display_ir import UiPaintOp
from vektorflow.ui_scene_graph_math import IDENTITY_AFFINE_2D
from vektorflow.ui_scene_model import DisplaySceneState, collect_screen_paint_ops
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib.events import HIT_FACE, HIT_OBJECT, HIT_VERTEX, HitContext, MouseEvent
from vektorflow.stdlib.ui import build_ui_namespace


class _FakeShapeRoot:
    def __init__(self, op: UiPaintOp) -> None:
        self._op = op
        self.transforms: list[tuple[float, float, float, float, float, float]] = []

    def _collect_paint_ops(self, transform, ops) -> None:
        self.transforms.append(transform)
        ops.append(self._op)


class _FakeFrameRef:
    def __init__(self, frame_id: str, ops: list[UiPaintOp], *, placed: bool = True) -> None:
        self._frame_id = frame_id
        self._ops = ops
        self._placed = placed

    def _collect_shape_ops(self) -> list[UiPaintOp]:
        return list(self._ops)


def test_display_scene_state_build_sync_plan_merges_screen_and_frame_shapes() -> None:
    state = DisplaySceneState()
    state.append_screen_op(UiPaintOp(op="rect", rect=(0.0, 0.0, 0.2, 0.2), color="#111"))
    state.add_screen_shape_root(_FakeShapeRoot(UiPaintOp(op="oval", rect=(0.1, 0.1, 0.2, 0.2), color="#222")))
    state.frame_ops["frame-1"] = [UiPaintOp(op="rect", rect=(0.0, 0.0, 0.3, 0.3), color="#333")]
    state.frame_refs.append(_FakeFrameRef("frame-1", [UiPaintOp(op="oval", rect=(0.2, 0.2, 0.1, 0.1), color="#444")]))

    plan = state.build_sync_plan(
        command_count=0,
        has_scene_commands=False,
        identity_transform=IDENTITY_AFFINE_2D,
    )

    assert len(plan.payload.screen) == 2
    assert len(plan.payload.frames["frame-1"]) == 2


def test_display_scene_state_resolves_active_frame_from_last_frame() -> None:
    state = DisplaySceneState()

    class _PlacedFrame:
        _placed = True
        _frame_id = "frame-9"

    state.last_frame = _PlacedFrame()
    assert state.resolve_active_frame("add_box") == "frame-9"


def test_collect_screen_paint_ops_uses_shared_identity_transform_by_default() -> None:
    root = _FakeShapeRoot(UiPaintOp(op="rect", rect=(0.0, 0.0, 1.0, 1.0), color="#abc"))

    ops = collect_screen_paint_ops([], [root])

    assert len(ops) == 1
    assert root.transforms == [IDENTITY_AFFINE_2D]


def test_polygon_hover_context_resolves_vertex_and_edge_refs() -> None:
    d = build_ui_namespace()["ui"].display
    frame = d.frame(title="refs", draggable=True, closable=True, resizable=True, dockable=True, dock_loc="bl")
    d.add_frame(frame, [0.1, 0.1, 0.8, 0.8])
    poly = frame.add_polygon([[0.0, 0.0], [0.4, 0.0], [0.4, 0.4], [0.0, 0.4]], color=[1, 0, 0, 1])

    frame.get_vertex({"object_id": poly.id, "vertex_id": 1}).translate([0.1, 0.2])
    assert poly._points[1] == (0.5, 0.2)

    frame.get_edge({"object_id": poly.id, "edge_id": 1}).translate([-0.1, 0.1])
    assert poly._points[1] == (0.4, 0.30000000000000004)
    assert poly._points[2] == (0.30000000000000004, 0.5)


def test_hit_context_is_inherited_and_resolves_symmetrically() -> None:
    d = build_ui_namespace()["ui"].display
    frame = d.frame(title="hit", draggable=True, closable=True, resizable=True, dockable=True, dock_loc="bl")
    d.add_frame(frame, [0.1, 0.1, 0.8, 0.8])
    poly = frame.add_polygon([[0.0, 0.0], [0.4, 0.0], [0.4, 0.4], [0.0, 0.4]], color=[1, 0, 0, 1])

    hit = HitContext.from_dict({"frame_id": frame.id, "object_id": poly.id, "vertex_id": 2})

    assert hit.has(HIT_OBJECT | HIT_FACE | HIT_VERTEX)
    assert frame.get_rect(hit) is poly
    assert frame.get(hit).id == 2


def test_geometry_refs_support_vector_update_protocol() -> None:
    d = build_ui_namespace()["ui"].display
    frame = d.frame(title="updates", draggable=True, closable=True, resizable=True, dockable=True, dock_loc="bl")
    d.add_frame(frame, [0.1, 0.1, 0.8, 0.8])
    poly = frame.add_polygon([[0.0, 0.0], [0.4, 0.0], [0.4, 0.4], [0.0, 0.4]], color=[1, 0, 0, 1])

    frame.get_vertex({"object_id": poly.id, "vertex_id": 0}).__vf_update__("PLUS", [0.2, 0.3])
    assert poly._points[0] == (0.2, 0.3)

    frame.get_edge({"object_id": poly.id, "edge_id": 1}).__vf_update__("MINUS", [0.1, 0.1])
    assert poly._points[1] == (0.30000000000000004, -0.1)
    assert poly._points[2] == (0.30000000000000004, 0.30000000000000004)

    poly.__vf_update__("PLUS", [0.1, -0.1])
    assert poly._tx == 0.1
    assert poly._ty == -0.1


def test_vkf_update_operator_mutates_geometry_refs() -> None:
    src = """
ui: .ui
d: ui.display
frame: d.frame(title:"updates", draggable:true, closable:true, resizable:true, dockable:true, dock_loc:"bl")
d.add_frame(frame, [0.1, 0.1, 0.8, 0.8])
poly: frame.add_polygon([[0.0,0.0], [0.4,0.0], [0.4,0.4]], color:[1,0,0,1])
vertex: frame.get_vertex((object_id:poly.id, vertex_id:1))
vertex +: [0.1, 0.2]
poly +: [0.3, 0.4]
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<ui-update>"))

    poly = ip.globals["poly"]
    assert poly._points[1] == (0.5, 0.2)
    assert poly._tx == 0.3
    assert poly._ty == 0.4


def test_vkf_drag_demo_function_translates_coordinate_frame_for_faces() -> None:
    src = """
ui: .ui
d: ui.display
frame: d.frame(title:"drag", draggable:true, closable:true, resizable:true, dockable:true, dock_loc:"bl")
d.add_frame(frame, [0.1, 0.1, 0.8, 0.8])
poly: frame.add_polygon([[0.0,0.0], [0.4,0.0], [0.4,0.4]], color:[1,0,0,1])
edit_polygon(e):
  target: frame.get(e.hover)
  target?
    e.hover.kind = "vertex"?
      @: target.translate(trans:e.trans)
    e.hover.kind = "edge"?
      @: target.translate(trans:e.trans)
    target.translate(trans:e.trans)
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<ui-drag-demo>"))
    frame = ip.globals["frame"]
    poly = ip.globals["poly"]
    e = MouseEvent.from_dict({
        "event": "drag",
        "trans": [0.25, -0.125],
        "hover": {"frame_id": frame.id, "object_id": poly.id, "face_id": 0, "kind": "face"},
    })

    fn = ip.globals["edit_polygon"]
    if type(fn).__name__ == "IRFunctionValue":
        ip._call_ir_function_value(fn, [e])
    else:
        ip._call(fn, [e], ip.globals)

    assert poly._tx == 0.25
    assert poly._ty == -0.125


def test_vkf_minimal_rect_drag_translates_coordinate_frame() -> None:
    src = """
ui: .ui
d: ui.display
panel: d.frame(title:"rect", draggable:true, closable:true, resizable:true, dockable:true, dock_loc:"bl")
d.add_frame(panel, [0.16, 0.16, 0.58, 0.58])
box: panel.add_rect([0.24, 0.24, 0.28, 0.22], color:[0.10, 0.72, 0.95, 0.92])
box.set_interaction(cursor:"open_hand", pressed_cursor:"closed_hand", border:0.03)
drag(e):
  target: panel.get(e.hover)
  target?
    target.translate(trans:e.trans)
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<ui-rect-drag-demo>"))
    panel = ip.globals["panel"]
    box = ip.globals["box"]
    e = MouseEvent.from_dict({
        "event": "drag",
        "trans": [0.12, 0.08],
        "hover": {"frame_id": panel.id, "object_id": box.id, "face_id": 0, "kind": "face"},
    })

    fn = ip.globals["drag"]
    if type(fn).__name__ == "IRFunctionValue":
        ip._call_ir_function_value(fn, [e])
    else:
        ip._call(fn, [e], ip.globals)

    assert box._tx == 0.12
    assert box._ty == 0.08


def test_mouse_events_expose_vector_positions_and_translation() -> None:
    e = MouseEvent.from_dict({"event": "drag", "x": 12, "y": 34, "dx": 0.2, "dy": -0.1})
    assert e.pos == [12.0, 34.0]
    assert e.pixel == [12.0, 34.0]
    assert e.trans == [0.2, -0.1]


def test_mouse_events_preserve_transport_translation_vector() -> None:
    e = MouseEvent.from_dict({"event": "drag", "x": 12, "y": 34, "trans": [0.2, -0.1]})
    assert e.trans == [0.2, -0.1]


def test_drag_event_hover_context_updates_picked_geometry_ref() -> None:
    d = build_ui_namespace()["ui"].display
    frame = d.frame(title="drag", draggable=True, closable=True, resizable=True, dockable=True, dock_loc="bl")
    d.add_frame(frame, [0.1, 0.1, 0.8, 0.8])
    poly = frame.add_polygon([[0.0, 0.0], [0.4, 0.0], [0.4, 0.4]], color=[1, 0, 0, 1])
    e = MouseEvent.from_dict({
        "event": "drag",
        "trans": [0.25, -0.125],
        "hover": {"frame_id": frame.id, "object_id": poly.id, "face_id": 0},
    })

    target = frame.get(e.hover)
    target.__vf_update__("PLUS", e.trans)

    assert poly._tx == 0.25
    assert poly._ty == -0.125


def test_mouse_events_expose_first_class_hit_context() -> None:
    e = MouseEvent.from_dict({
        "event": "drag",
        "x": 12,
        "y": 34,
        "hover": {"frame_id": "f1", "object_id": "poly7", "edge_id": 1},
    })
    assert e.hover.kind == "edge"
    assert e.hover.has(HIT_OBJECT | HIT_FACE)
    assert e.object_id == "poly7"
    assert e.face_id == 0
    assert e.edge_id == 1
