"""Pure widget/frame command semantics for UI hosts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from vektorflow.runtime.vflist import VFLinkedList
from vektorflow.ui.ir import FrameFlags, FrameSpec, NormRect, UiCommand


@dataclass(frozen=True, slots=True)
class UiFrameCommandPlan:
    spec: FrameSpec
    command: UiCommand


def as_widget_node(x: Any) -> dict[str, Any]:
    if not isinstance(x, dict):
        raise TypeError("each body node must be a map/dict of widget properties")
    if "id" not in x or "type" not in x:
        raise ValueError("each widget must have 'id' and 'type'")
    return dict(x)


def coerce_widget_body(body: Any) -> tuple[dict[str, Any], ...] | None:
    """Normalize a frame body to host-neutral widget nodes."""
    if body is None:
        return None
    if isinstance(body, (list, tuple, VFLinkedList)):
        return tuple(as_widget_node(x) for x in body)
    if isinstance(body, dict):
        return (as_widget_node(body),)
    raise TypeError("body must be a list, tuple, collections list, or a single widget dict")


def attach_widget_event_consts(node: dict[str, Any]) -> dict[str, Any]:
    """Attach widget-scoped event constants without introducing host behavior."""
    from vektorflow.stdlib.events import (
        EVENT_CONST_TO_NAME,
        WIDGET_TYPE_EVENT_CONSTS,
        encode_widget_pattern,
    )

    out = dict(node)
    wid = str(out.get("id", ""))
    typ = str(out.get("type", ""))
    for const_name in WIDGET_TYPE_EVENT_CONSTS.get(typ, ()):
        ev_name = EVENT_CONST_TO_NAME.get(const_name)
        if ev_name is None:
            continue
        out[const_name] = encode_widget_pattern(ev_name, wid)
    return out


def coerce_widget_props(x: Any) -> dict[str, Any]:
    if isinstance(x, dict):
        return dict(x)
    from vektorflow.runtime.vmap import VMap

    if isinstance(x, VMap):
        return dict(x._d)
    raise TypeError("widget props must be a map or struct dict")


def normalize_grid_slot(slot: Any) -> list[int]:
    if not isinstance(slot, (list, tuple)) or len(slot) != 4:
        raise TypeError("grid must be a 4-tuple (row, col, row_span, col_span)")
    vals = [int(slot[0]), int(slot[1]), int(slot[2]), int(slot[3])]
    if vals[0] < 0 or vals[1] < 0:
        raise ValueError("grid row and col must be >= 0")
    if vals[2] <= 0 or vals[3] <= 0:
        raise ValueError("grid row_span and col_span must be > 0")
    return vals


def apply_widget_meta(node: dict[str, Any], *, grid: Any = None) -> dict[str, Any]:
    out = dict(node)
    if grid is not None:
        out["grid"] = normalize_grid_slot(grid)
    return out


def normalize_grid_layout(value: Any) -> dict[str, Any]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise TypeError("gridlayout must be a 2-tuple (rows, cols)")
    rows = int(value[0])
    cols = int(value[1])
    if rows <= 0 or cols <= 0:
        raise ValueError("gridlayout rows and cols must be > 0")
    return {"type": "grid", "rows": rows, "cols": cols}


def build_frame_upsert_command(
    frame_id: str,
    *,
    title: str,
    title_align: str,
    rect: NormRect,
    flags: FrameFlags,
    alpha: float,
    master: bool,
    dock_location: str,
    anchor: str,
    body: Any = None,
    body_layout: dict[str, Any] | None = None,
    parent_id: str | None = None,
) -> UiFrameCommandPlan:
    body_tuple = coerce_widget_body(body)
    spec = FrameSpec(
        id=frame_id,
        title=str(title),
        title_align=title_align,  # type: ignore[arg-type]
        rect=rect,
        flags=flags,
        alpha=float(alpha),
        master=bool(master),
        dock_location=dock_location,  # type: ignore[arg-type]
        anchor=anchor,  # type: ignore[arg-type]
        body=body_tuple,
        body_layout=dict(body_layout) if body_layout is not None else None,
        parent_id=parent_id,
    )
    return UiFrameCommandPlan(
        spec=spec,
        command=UiCommand("frame_upsert", frame_id, {"spec": spec.to_json_obj()}),
    )


def merge_widget_state(
    ui_state: dict[str, dict[str, dict[str, Any]]],
    *,
    frame_id: str,
    widget_id: str,
    props: Any,
) -> dict[str, dict[str, dict[str, Any]]]:
    merged_state = {
        fid: {wid: dict(widget_props) for wid, widget_props in widgets.items()}
        for fid, widgets in ui_state.items()
    }
    by_frame = merged_state.setdefault(str(frame_id), {})
    current = dict(by_frame.get(str(widget_id), {}))
    current.update(coerce_widget_props(props))
    by_frame[str(widget_id)] = current
    return merged_state
