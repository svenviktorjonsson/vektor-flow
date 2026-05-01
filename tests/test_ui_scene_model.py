from __future__ import annotations

from vektorflow.ui_display_ir import UiPaintOp
from vektorflow.ui_scene_graph_math import IDENTITY_AFFINE_2D
from vektorflow.ui_scene_model import DisplaySceneState, collect_screen_paint_ops
from vektorflow.stdlib.events import MouseEvent
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


def test_mouse_events_expose_vector_positions_and_translation() -> None:
    e = MouseEvent.from_dict({"event": "drag", "x": 12, "y": 34, "dx": 0.2, "dy": -0.1})
    assert e.pos == [12.0, 34.0]
    assert e.pixel == [12.0, 34.0]
    assert e.trans == [0.2, -0.1]
