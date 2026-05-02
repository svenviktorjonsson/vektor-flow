"""Declarative host-boundary payloads for ``vf-display.json``."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal, Mapping
import json
import math

UiPaintOpKind = Literal["rect", "oval", "polygon"]
UiMeshKind = Literal["box", "ellipsoid", "torus"]
UiFrameAddRoute = Literal["pending_existing", "rect_short_form"]


@dataclass(frozen=True, slots=True)
class UiPaintOp:
    op: UiPaintOpKind
    rect: tuple[float, float, float, float]
    color: Any
    transform: tuple[float, float, float, float, float, float] | None = None
    points: tuple[tuple[float, float], ...] | None = None
    interaction: dict[str, Any] | None = None

    def to_json_obj(self) -> dict[str, Any]:
        payload = {
            "op": self.op,
            "rect": [self.rect[0], self.rect[1], self.rect[2], self.rect[3]],
            "color": list(self.color) if isinstance(self.color, tuple) else self.color,
        }
        if self.transform is not None:
            payload["transform"] = [
                self.transform[0],
                self.transform[1],
                self.transform[2],
                self.transform[3],
                self.transform[4],
                self.transform[5],
            ]
        if self.points is not None:
            payload["points"] = [[float(x), float(y)] for x, y in self.points]
        if self.interaction is not None:
            payload["interaction"] = dict(self.interaction)
        return payload


@dataclass(frozen=True, slots=True)
class UiSceneMesh:
    type: UiMeshKind
    center: tuple[float, float, float]
    scale: tuple[float, float, float]
    color: str | None
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)
    model_matrix: tuple[float, ...] | None = None
    major_radius: float | None = None
    minor_radius: float | None = None

    def to_json_obj(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "type": self.type,
            "center": [self.center[0], self.center[1], self.center[2]],
            "scale": [self.scale[0], self.scale[1], self.scale[2]],
            "color": self.color,
            "rotation": [self.rotation[0], self.rotation[1], self.rotation[2]],
        }
        if self.model_matrix is not None:
            payload["model_matrix"] = list(self.model_matrix)
        if self.major_radius is not None:
            payload["major_radius"] = self.major_radius
        if self.minor_radius is not None:
            payload["minor_radius"] = self.minor_radius
        return payload


@dataclass(frozen=True, slots=True)
class UiSceneCamera:
    pos: tuple[float, float, float]
    target: tuple[float, float, float]
    fov: float
    up: tuple[float, float, float]
    controls: Mapping[str, Any] | None = None

    def to_json_obj(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "pos": [self.pos[0], self.pos[1], self.pos[2]],
            "target": [self.target[0], self.target[1], self.target[2]],
            "fov": self.fov,
            "up": [self.up[0], self.up[1], self.up[2]],
        }
        if self.controls is not None:
            payload["controls"] = dict(self.controls)
        return payload


@dataclass(frozen=True, slots=True)
class UiSceneLight:
    pos: tuple[float, float, float]
    model: str
    color: str

    def to_json_obj(self) -> dict[str, Any]:
        return {
            "pos": [self.pos[0], self.pos[1], self.pos[2]],
            "model": self.model,
            "color": self.color,
        }


@dataclass(frozen=True, slots=True)
class UiFieldMesh:
    id: str
    vertices: tuple[float, ...]
    indices: tuple[int, ...]
    topology: str
    interpolation: bool
    alpha: float
    manifold_dim_count: int
    solid_volume: bool
    vertex_size: float
    edge_width: float
    center: tuple[float, float, float]
    scale: tuple[float, float, float]
    rotation: tuple[float, float, float]
    color: Any
    time_count: int
    time_index: int
    model_matrix: tuple[float, ...] | None = None
    type: Literal["field_mesh"] = "field_mesh"

    def to_json_obj(self) -> dict[str, Any]:
        payload = {
            "type": self.type,
            "id": self.id,
            "vertices": list(self.vertices),
            "indices": list(self.indices),
            "topology": self.topology,
            "interpolation": self.interpolation,
            "alpha": self.alpha,
            "manifold_dim_count": self.manifold_dim_count,
            "solid_volume": self.solid_volume,
            "vertex_size": self.vertex_size,
            "edge_width": self.edge_width,
            "center": [self.center[0], self.center[1], self.center[2]],
            "scale": [self.scale[0], self.scale[1], self.scale[2]],
            "rotation": [self.rotation[0], self.rotation[1], self.rotation[2]],
            "color": self.color,
            "time_count": self.time_count,
            "time_index": self.time_index,
        }
        if self.model_matrix is not None:
            payload["model_matrix"] = list(self.model_matrix)
        return payload


@dataclass(frozen=True, slots=True)
class UiFrameScene:
    meshes: tuple[UiSceneMesh | UiFieldMesh, ...] = ()
    camera: UiSceneCamera | None = None
    lights: tuple[UiSceneLight, ...] = ()

    def to_json_obj(self) -> dict[str, Any]:
        return {
            "meshes": [mesh.to_json_obj() for mesh in self.meshes],
            "camera": None if self.camera is None else self.camera.to_json_obj(),
            "lights": [light.to_json_obj() for light in self.lights],
        }


@dataclass(frozen=True, slots=True)
class UiDisplayPayload:
    screen: tuple[UiPaintOp, ...] = ()
    frames: dict[str, tuple[UiPaintOp, ...]] = field(default_factory=dict)
    geom: dict[str, UiFrameScene] = field(default_factory=dict)
    cursor: str = "default"

    def to_json_obj(self) -> dict[str, Any]:
        return {
            "screen": [op.to_json_obj() for op in self.screen],
            "frames": {
                frame_id: [op.to_json_obj() for op in ops]
                for frame_id, ops in self.frames.items()
            },
            "geom": {
                frame_id: scene.to_json_obj()
                for frame_id, scene in self.geom.items()
            },
            "cursor": self.cursor,
        }


@dataclass(frozen=True, slots=True)
class UiDisplaySyncPlan:
    payload: UiDisplayPayload
    should_write_scene_commands: bool
    next_scene_cmd_count: int
    should_launch: bool


@dataclass(frozen=True, slots=True)
class UiDisplayWritePlan:
    display_output_path: Path
    sync_filename: str
    display_text: str
    should_sync_assets: bool
    ui_asset_files: tuple[str, ...]
    geom_asset_copy_plans: tuple["UiStaticAssetCopyPlan", ...]


@dataclass(frozen=True, slots=True)
class UiStaticAssetCopyPlan:
    filename: str
    source_path: Path
    destination_paths: tuple[Path, ...]


@dataclass(frozen=True, slots=True)
class UiFrameAddPlan:
    route: UiFrameAddRoute
    rect: tuple[float, float, float, float] | Any | None
    screen_kwargs: dict[str, Any]
    should_create_pending_frame: bool


def dumps_vf_display(payload: UiDisplayPayload) -> str:
    return json.dumps(payload.to_json_obj(), indent=2)


def build_display_write_plan(
    payload: UiDisplayPayload,
    *,
    root: Path,
    assets_synced_once: bool,
) -> UiDisplayWritePlan:
    geom_asset_copy_plans = tuple(
        plan
        for filename in (
            "vf-geom-core.js",
            "vf-geom-wgpu.js",
            "vf-geom-math.js",
            "vf-geom-mount.js",
        )
        for plan in [build_static_geom_asset_copy_plan(root, filename)]
        if plan is not None
    )
    return UiDisplayWritePlan(
        display_output_path=root / "web" / "vf-ui" / "vf-display.json",
        sync_filename="vf-display.json",
        display_text=dumps_vf_display(payload) + "\n",
        should_sync_assets=not assets_synced_once,
        ui_asset_files=(
            "vf-display.js",
            "vkf-scene.html",
            "vf-frame.js",
            "vf-frame.css",
            "vf-widgets.js",
        ),
        geom_asset_copy_plans=geom_asset_copy_plans,
    )


def build_static_geom_asset_copy_plan(root: Path, filename: str) -> UiStaticAssetCopyPlan | None:
    source_path = root / "web" / "vf-ui" / "geom" / filename
    if not source_path.is_file():
        return None
    destination_paths = tuple(
        built / "geom" / filename
        for built in (root / "native" / "VfOverlay").rglob("vf-ui")
    )
    return UiStaticAssetCopyPlan(
        filename=filename,
        source_path=source_path,
        destination_paths=destination_paths,
    )


def default_display_frame_kwargs() -> dict[str, Any]:
    return {
        "title": "",
        "draggable": True,
        "dockable": True,
        "resizable": True,
        "closable": True,
        "alpha": 1.0,
        "dock_loc": "bl",
    }


def build_frame_add_plan(
    *,
    has_pending_ref: bool,
    second: Any | None,
    screen_kwargs: dict[str, Any],
    rect: tuple[float, float, float, float] | None,
    has_last_frame: bool,
    last_frame_placed: bool,
) -> UiFrameAddPlan:
    if has_pending_ref:
        if second is None and not screen_kwargs:
            raise TypeError(
                "add_frame: pass a rect or a layout option, "
                "or use d.add_frame((x,y,w,h)) for the short form"
            )
        return UiFrameAddPlan(
            route="pending_existing",
            rect=second,
            screen_kwargs=screen_kwargs,
            should_create_pending_frame=False,
        )

    if rect is None:
        raise TypeError("rect short form requires a normalized rect tuple")

    return UiFrameAddPlan(
        route="rect_short_form",
        rect=rect,
        screen_kwargs=screen_kwargs,
        should_create_pending_frame=(not has_last_frame) or last_frame_placed,
    )


def normalize_runtime_geom_map(runtime_geom: dict[str, dict[str, Any]]) -> dict[str, UiFrameScene]:
    return {
        frame_id: frame_scene_from_runtime_geom(scene)
        for frame_id, scene in runtime_geom.items()
        if not frame_id.startswith("__pending_")
    }


def build_display_payload(
    *,
    screen_ops: list[UiPaintOp] | tuple[UiPaintOp, ...],
    frame_ops: dict[str, list[UiPaintOp] | tuple[UiPaintOp, ...]],
    runtime_geom: dict[str, dict[str, Any]],
    cursor: str = "default",
) -> UiDisplayPayload:
    return UiDisplayPayload(
        screen=tuple(screen_ops),
        frames={frame_id: tuple(ops) for frame_id, ops in frame_ops.items()},
        geom=normalize_runtime_geom_map(runtime_geom),
        cursor=str(cursor or "default"),
    )


def has_visible_display_content(
    payload: UiDisplayPayload,
    *,
    has_scene_commands: bool,
) -> bool:
    return bool(
        has_scene_commands
        or payload.screen
        or payload.frames
        or payload.geom
    )


def build_display_sync_plan(
    *,
    screen_ops: list[UiPaintOp] | tuple[UiPaintOp, ...],
    frame_ops: dict[str, list[UiPaintOp] | tuple[UiPaintOp, ...]],
    runtime_geom: dict[str, dict[str, Any]],
    command_count: int,
    last_scene_cmd_count: int,
    has_scene_commands: bool,
    cursor: str = "default",
) -> UiDisplaySyncPlan:
    payload = build_display_payload(
        screen_ops=screen_ops,
        frame_ops=frame_ops,
        runtime_geom=runtime_geom,
        cursor=cursor,
    )
    return UiDisplaySyncPlan(
        payload=payload,
        should_write_scene_commands=command_count != last_scene_cmd_count,
        next_scene_cmd_count=command_count,
        should_launch=has_visible_display_content(
            payload,
            has_scene_commands=has_scene_commands,
        ),
    )


@dataclass(frozen=True, slots=True)
class UiHostEvent:
    payload: dict[str, Any]
    base: int


@dataclass(frozen=True, slots=True)
class UiHostTransportEvent:
    type: str
    event: str
    frame_id: str
    widget_id: str
    data: dict[str, Any]
    payload: dict[str, Any]

    @property
    def is_vf_event(self) -> bool:
        return self.type == "vf_event"


UiDispatchRoute = Literal["host", "mouse", "keyboard", "ignored"]


@dataclass(frozen=True, slots=True)
class UiDispatchEvent:
    payload: dict[str, Any]
    base: int
    route: UiDispatchRoute
    should_queue: bool
    next_kind_count: int = 0


@dataclass(frozen=True, slots=True)
class UiDispatchEffects:
    should_observe_modifiers: bool
    should_push_cursor: bool
    should_push_keyboard: bool
    suppress_queue: bool


@dataclass(frozen=True, slots=True)
class UiBrowserWidgetDispatchPolicy:
    family: str
    route: UiDispatchRoute
    should_queue: bool


_BROWSER_WIDGET_DISPATCH_POLICIES: tuple[UiBrowserWidgetDispatchPolicy, ...] = (
    UiBrowserWidgetDispatchPolicy(family="button.", route="host", should_queue=True),
    UiBrowserWidgetDispatchPolicy(family="checkbox.", route="host", should_queue=True),
    UiBrowserWidgetDispatchPolicy(family="input_field.", route="host", should_queue=True),
    UiBrowserWidgetDispatchPolicy(family="slider.", route="host", should_queue=True),
    UiBrowserWidgetDispatchPolicy(family="dropdown.", route="host", should_queue=True),
)


def decode_browser_enqueue_body(
    body: Mapping[str, Any] | str | bytes,
) -> dict[str, Any]:
    """Decode a browser `/api/enqueue` request body into a host-transport event mapping."""
    payload: Any = body
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, Mapping):
        raise TypeError("browser enqueue body must decode to a mapping")
    line = payload.get("line")
    if isinstance(line, bytes):
        line = line.decode("utf-8")
    if isinstance(line, str):
        decoded = json.loads(line)
        if not isinstance(decoded, Mapping):
            raise TypeError("browser enqueue line must decode to a mapping")
        payload = dict(decoded)
    else:
        payload = dict(payload)
    if "type" not in payload and payload.get("event") is not None:
        payload["type"] = "vf_event"
    return payload


def classify_browser_widget_dispatch(
    evt: Mapping[str, Any] | UiHostTransportEvent,
) -> UiBrowserWidgetDispatchPolicy | None:
    transport = _coerce_transport_event(evt)
    if not transport.is_vf_event or not transport.widget_id:
        return None
    for policy in _BROWSER_WIDGET_DISPATCH_POLICIES:
        if transport.event.startswith(policy.family):
            return policy
    return None


def _coerce_transport_event(evt: Mapping[str, Any] | UiHostTransportEvent) -> UiHostTransportEvent:
    if isinstance(evt, UiHostTransportEvent):
        return evt
    return normalize_host_transport_event(evt)


def normalize_host_transport_event(evt: Mapping[str, Any]) -> UiHostTransportEvent:
    def _first_str(*keys: str) -> str:
        for key in keys:
            if key in evt:
                value = evt.get(key)
                if value is None:
                    continue
                text = str(value)
                if text:
                    return text
        return ""

    raw_type = _first_str("type")
    event_name = _first_str("event")
    frame_id = _first_str("frame_id", "frameId")
    widget_id = _first_str("widget_id", "widgetId")
    raw_data = evt.get("data", {})
    data = dict(raw_data) if isinstance(raw_data, Mapping) else {}
    payload = dict(evt)
    payload["type"] = raw_type
    payload["event"] = event_name
    payload["frame_id"] = frame_id
    payload["widget_id"] = widget_id
    payload["data"] = data
    return UiHostTransportEvent(
        type=raw_type,
        event=event_name,
        frame_id=frame_id,
        widget_id=widget_id,
        data=data,
        payload=payload,
    )


def normalize_host_event(
    evt: Mapping[str, Any] | UiHostTransportEvent,
    *,
    next_index: int = 0,
) -> UiHostEvent:
    # Import lazily to avoid stdlib package initialization cycling back into ui.py.
    from vektorflow.stdlib.events import (
        EVENT_NAME_TO_BASE,
        encode_event_code,
        encode_frame_pattern,
        encode_ui_pattern,
        encode_widget_pattern,
    )

    transport = _coerce_transport_event(evt)
    ev_name = transport.event
    frame_id = transport.frame_id
    widget_id = transport.widget_id
    base = int(EVENT_NAME_TO_BASE.get(ev_name, 0))
    payload = dict(transport.payload)
    payload["code"] = encode_event_code(ev_name, frame_id=frame_id, widget_id=widget_id)
    payload["ui_code"] = encode_ui_pattern(ev_name) if base else 0
    payload["frame_code"] = encode_frame_pattern(ev_name, frame_id) if (base and frame_id) else 0
    payload["widget_code"] = encode_widget_pattern(ev_name, widget_id) if (base and widget_id) else 0
    payload["index"] = int(next_index) if base else 0
    if ev_name in ("move", "hover", "down", "up", "wheel", "drag"):
        x = float(payload.get("x", 0) or 0)
        y = float(payload.get("y", 0) or 0)
        dx = float(payload.get("dx", 0) or 0)
        dy = float(payload.get("dy", 0) or 0)
        payload.setdefault("pos", [x, y])
        payload.setdefault("pixel", [x, y])
        payload.setdefault("trans", [dx, dy])
    return UiHostEvent(payload=payload, base=base)


def build_host_event_dispatch(
    evt: Mapping[str, Any] | UiHostTransportEvent,
    *,
    next_index: int = 0,
) -> UiDispatchEvent:
    transport = _coerce_transport_event(evt)
    normalized = normalize_host_event(evt, next_index=next_index)
    ev_name = transport.event
    route: UiDispatchRoute = "ignored"
    should_queue = False
    widget_policy = classify_browser_widget_dispatch(transport)
    if not transport.is_vf_event:
        route = "host"
        should_queue = True
    elif widget_policy is not None:
        route = widget_policy.route
        should_queue = widget_policy.should_queue
    elif ev_name in ("move", "hover", "down", "up", "wheel", "drag"):
        route = "mouse"
        should_queue = True
    elif ev_name in ("key_down", "key_up"):
        route = "keyboard"
        should_queue = True
    return UiDispatchEvent(
        payload=normalized.payload,
        base=normalized.base,
        route=route,
        should_queue=should_queue,
        next_kind_count=int(normalized.payload.get("index", 0)) if normalized.base else 0,
    )


def build_host_event_dispatch_from_state(
    evt: Mapping[str, Any] | UiHostTransportEvent,
    *,
    event_kind_count: dict[int, int],
) -> UiDispatchEvent:
    from vektorflow.stdlib.events import EVENT_NAME_TO_BASE

    transport = _coerce_transport_event(evt)
    ev_name = transport.event
    base_hint = int(EVENT_NAME_TO_BASE.get(ev_name, 0))
    next_index = int(event_kind_count.get(base_hint, 0)) + 1 if base_hint else 0
    return build_host_event_dispatch(evt, next_index=next_index)


def apply_host_event_dispatch_state(
    event_queue: Any,
    event_kind_count: dict[int, int],
    dispatch: UiDispatchEvent,
    *,
    suppress_queue: bool = False,
) -> bool:
    if dispatch.base:
        event_kind_count[dispatch.base] = int(dispatch.next_kind_count)
    if dispatch.should_queue and not suppress_queue:
        if coalesce_host_event_queue(event_queue, dispatch.payload):
            return True
        event_queue.append(dispatch.payload)
        return True
    return False


def _hover_key(payload: Mapping[str, Any]) -> tuple[Any, ...]:
    hover = payload.get("hover")
    if not isinstance(hover, Mapping):
        hover = {}
    return (
        payload.get("event", ""),
        payload.get("frame_id", hover.get("frame_id", "")),
        hover.get("object_id", payload.get("object_id", payload.get("shape_id", ""))),
        hover.get("kind", ""),
        hover.get("vertex_id", -1),
        hover.get("edge_id", -1),
        hover.get("face_id", -1),
    )


def coalesce_host_event_queue(event_queue: Any, payload: Mapping[str, Any]) -> bool:
    """Merge high-rate pointer samples so VKF consumes intent, not backlog."""
    ev = str(payload.get("event", ""))
    if ev not in {"move", "hover", "drag"}:
        return False
    if not hasattr(event_queue, "__len__") or not hasattr(event_queue, "__getitem__"):
        return False
    key = _hover_key(payload)
    for i in range(len(event_queue) - 1, -1, -1):
        queued = event_queue[i]
        if not isinstance(queued, Mapping):
            continue
        if _hover_key(queued) != key:
            continue
        merged = dict(queued)
        merged.update(payload)
        if ev == "drag":
            merged["dx"] = float(queued.get("dx", 0.0) or 0.0) + float(payload.get("dx", 0.0) or 0.0)
            merged["dy"] = float(queued.get("dy", 0.0) or 0.0) + float(payload.get("dy", 0.0) or 0.0)
            merged["trans"] = [merged["dx"], merged["dy"]]
            if "client_dx" in queued or "client_dx" in payload:
                merged["client_dx"] = float(queued.get("client_dx", 0.0) or 0.0) + float(payload.get("client_dx", 0.0) or 0.0)
            if "client_dy" in queued or "client_dy" in payload:
                merged["client_dy"] = float(queued.get("client_dy", 0.0) or 0.0) + float(payload.get("client_dy", 0.0) or 0.0)
        event_queue[i] = merged
        return True
    return False


def build_host_event_effects(
    dispatch: UiDispatchEvent,
    *,
    is_modifier_key: bool = False,
) -> UiDispatchEffects:
    return UiDispatchEffects(
        should_observe_modifiers=dispatch.route == "mouse",
        should_push_cursor=dispatch.route == "mouse",
        should_push_keyboard=dispatch.route == "keyboard",
        suppress_queue=bool(dispatch.route == "keyboard" and is_modifier_key),
    )


def dispatch_host_event(
    evt: Mapping[str, Any] | UiHostTransportEvent,
    *,
    cursor: Any,
    keyboard: Any,
    event_queue: Any,
    event_kind_count: dict[int, int],
) -> UiDispatchEvent:
    transport = _coerce_transport_event(evt)
    dispatch = build_host_event_dispatch_from_state(
        transport,
        event_kind_count=event_kind_count,
    )
    if dispatch.route == "host":
        apply_host_event_dispatch_state(
            event_queue,
            event_kind_count,
            dispatch,
        )
        return dispatch

    is_modifier = False
    if dispatch.route == "keyboard":
        from vektorflow.stdlib.events import KeyEvent

        ke = KeyEvent.from_dict(transport.payload)
        is_modifier = keyboard._modifier_name(ke) is not None

    effects = build_host_event_effects(
        dispatch,
        is_modifier_key=is_modifier,
    )

    if effects.should_observe_modifiers:
        keyboard._observe_modifiers(transport.payload)
    if effects.should_push_cursor:
        cursor._push(transport.payload)
    if effects.should_push_keyboard:
        keyboard._push(transport.payload)
    apply_host_event_dispatch_state(
        event_queue,
        event_kind_count,
        dispatch,
        suppress_queue=effects.suppress_queue,
    )
    return dispatch


def build_browser_host_event_dispatch(
    body: Mapping[str, Any] | str | bytes,
    *,
    event_kind_count: dict[int, int],
) -> UiDispatchEvent:
    """Build canonical dispatch directly from a browser `/api/enqueue` request body."""
    return build_host_event_dispatch_from_state(
        decode_browser_enqueue_body(body),
        event_kind_count=event_kind_count,
    )


def dispatch_browser_host_event(
    body: Mapping[str, Any] | str | bytes,
    *,
    cursor: Any,
    keyboard: Any,
    event_queue: Any,
    event_kind_count: dict[int, int],
) -> UiDispatchEvent:
    """Dispatch a browser `/api/enqueue` request body through the canonical host path."""
    return dispatch_host_event(
        decode_browser_enqueue_body(body),
        cursor=cursor,
        keyboard=keyboard,
        event_queue=event_queue,
        event_kind_count=event_kind_count,
    )


def ensure_host_event_poller_started(
    poller_started: bool,
    *,
    start_poller: Callable[[], None],
) -> bool:
    if not poller_started:
        start_poller()
        return True
    return False


def has_queued_host_events(event_queue: Any) -> bool:
    return bool(event_queue)


def pop_queued_host_event(event_queue: Any) -> Any | None:
    if event_queue:
        return event_queue.popleft()
    return None


def frame_scene_from_runtime_geom(data: dict[str, Any]) -> UiFrameScene:
    meshes: list[UiSceneMesh | UiFieldMesh] = []
    for mesh in data.get("meshes", []):
        if mesh.get("type") == "field_mesh":
            meshes.append(
                UiFieldMesh(
                    id=str(mesh["id"]),
                    vertices=tuple(mesh["vertices"]),
                    indices=tuple(mesh["indices"]),
                    topology=str(mesh["topology"]),
                    interpolation=bool(mesh["interpolation"]),
                    alpha=float(mesh["alpha"]),
                    manifold_dim_count=int(mesh.get("manifold_dim_count", 0)),
                    solid_volume=bool(mesh.get("solid_volume", False)),
                    vertex_size=float(mesh.get("vertex_size", 0.0)),
                    edge_width=float(mesh.get("edge_width", 0.0)),
                    center=tuple(mesh["center"]),
                    scale=tuple(mesh["scale"]),
                    rotation=tuple(mesh["rotation"]),
                    color=mesh.get("color"),
                    time_count=int(mesh["time_count"]),
                    time_index=int(mesh["time_index"]),
                )
            )
            continue
        meshes.append(
            UiSceneMesh(
                type=str(mesh["type"]),  # type: ignore[arg-type]
                center=tuple(mesh["center"]),
                scale=tuple(mesh["scale"]),
                color=mesh.get("color"),
                rotation=tuple(mesh.get("rotation", [0.0, 0.0, 0.0])),
                model_matrix=(
                    tuple(mesh["model_matrix"])
                    if mesh.get("model_matrix") is not None
                    else None
                ),
                major_radius=mesh.get("major_radius"),
                minor_radius=mesh.get("minor_radius"),
            )
        )
    raw_camera = data.get("camera")
    camera = None
    if raw_camera is not None:
        camera = UiSceneCamera(
            pos=tuple(raw_camera["pos"]),
            target=tuple(raw_camera["target"]),
            fov=float(raw_camera["fov"]),
            up=tuple(raw_camera["up"]),
            controls=raw_camera.get("controls"),
        )
    lights = tuple(
        UiSceneLight(
            pos=tuple(light["pos"]),
            model=str(light["model"]),
            color=str(light["color"]),
        )
        for light in data.get("lights", [])
    )
    return UiFrameScene(meshes=tuple(meshes), camera=camera, lights=lights)


def field_mesh_payload_from_geometry(
    *,
    geom: dict[str, Any],
    mesh_id: str,
    center: tuple[float, float, float],
    scale: tuple[float, float, float],
    rotation: tuple[float, float, float],
    color: Any,
) -> dict[str, Any]:
    return UiFieldMesh(
        id=mesh_id,
        vertices=tuple(geom["vertices"]),
        indices=tuple(geom["indices"]),
        topology=str(geom["topology"]),
        interpolation=bool(geom["interpolation"]),
        alpha=float(geom["alpha"]),
        manifold_dim_count=int(geom["manifold_dim_count"]),
        solid_volume=bool(geom["solid_volume"]),
        vertex_size=float(geom["vertex_size"]),
        edge_width=float(geom["edge_width"]),
        center=center,
        scale=scale,
        rotation=rotation,
        color=color,
        time_count=int(geom["time_count"]),
        time_index=int(geom["time_index"]),
        model_matrix=(
            tuple(geom["model_matrix"])
            if geom.get("model_matrix") is not None
            else None
        ),
    ).to_json_obj()


def apply_field_mesh_geometry_update(
    payload: dict[str, Any],
    geom: dict[str, Any],
) -> None:
    payload["vertices"] = geom["vertices"]
    payload["indices"] = geom["indices"]
    payload["topology"] = geom["topology"]
    payload["interpolation"] = geom["interpolation"]
    payload["alpha"] = geom["alpha"]
    payload["time_count"] = geom["time_count"]
    payload["time_index"] = geom["time_index"]
    payload["manifold_dim_count"] = geom["manifold_dim_count"]
    payload["solid_volume"] = geom["solid_volume"]
    payload["vertex_size"] = geom["vertex_size"]
    payload["edge_width"] = geom["edge_width"]


def build_scene_mesh_payload(
    kind: str,
    *,
    center: tuple[float, float, float],
    scale: tuple[float, float, float],
    color: str | None,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    major_radius: float | None = None,
    minor_radius: float | None = None,
) -> dict[str, Any]:
    return UiSceneMesh(
        type=kind,  # type: ignore[arg-type]
        center=center,
        scale=scale,
        color=color,
        rotation=rotation,
        major_radius=major_radius,
        minor_radius=minor_radius,
    ).to_json_obj()


def build_scene_camera_payload(
    *,
    pos: tuple[float, float, float],
    target: tuple[float, float, float],
    fov: float,
    up: tuple[float, float, float],
) -> dict[str, Any]:
    return UiSceneCamera(
        pos=pos,
        target=target,
        fov=fov,
        up=up,
    ).to_json_obj()


def build_scene_light_payload(
    *,
    pos: tuple[float, float, float],
    model: str,
    color: str,
) -> dict[str, Any]:
    return UiSceneLight(
        pos=pos,
        model=model,
        color=color,
    ).to_json_obj()


def normalize_scene_light_model(model: str, *, allowed_models: set[str]) -> str:
    normalized = str(model).lower().replace("-", "_")
    if normalized not in allowed_models:
        raise ValueError(f"model {model!r} unknown; use one of: {sorted(allowed_models)}")
    return normalized


def ensure_runtime_frame_scene(
    runtime_geom: dict[str, dict[str, Any]],
    frame_id: str,
) -> dict[str, Any]:
    if frame_id not in runtime_geom:
        runtime_geom[frame_id] = {"meshes": [], "camera": None, "lights": []}
    return runtime_geom[frame_id]


def append_frame_paint_op(
    frame_ops: dict[str, list[UiPaintOp]],
    frame_id: str,
    op: UiPaintOp,
) -> None:
    frame_ops.setdefault(frame_id, []).append(op)


def append_screen_paint_op(
    screen_ops: list[UiPaintOp],
    op: UiPaintOp,
) -> None:
    screen_ops.append(op)


def append_pending_frame_paint_op(
    pending_ops: dict[int, list[UiPaintOp]],
    pending_key: int,
    op: UiPaintOp,
) -> None:
    pending_ops.setdefault(pending_key, []).append(op)


def route_frame_paint_op(
    *,
    frame_ops: dict[str, list[UiPaintOp]],
    pending_ops: dict[int, list[UiPaintOp]],
    frame_id: str,
    placed: bool,
    pending_key: int,
    op: UiPaintOp,
) -> None:
    if placed and frame_id:
        append_frame_paint_op(frame_ops, frame_id, op)
    else:
        append_pending_frame_paint_op(pending_ops, pending_key, op)


def register_scene_object(
    scene_objects: dict[tuple[str, int], Any],
    *,
    frame_id: str,
    mesh_index: int,
    obj: Any,
) -> None:
    scene_objects[(frame_id, mesh_index)] = obj


def resolve_scene_object_for_pick(
    runtime_geom: dict[str, dict[str, Any]],
    scene_objects: dict[tuple[str, int], Any],
    object_id: int,
) -> Any:
    if object_id <= 0:
        return None
    idx = object_id - 1
    for frame_id, entries in runtime_geom.items():
        if frame_id.startswith("__pending_"):
            continue
        meshes = entries.get("meshes", [])
        if idx < len(meshes):
            return scene_objects.get((frame_id, idx))
    return None


def register_frame_ref(frame_refs: list[Any], frame_ref: Any) -> None:
    if frame_ref not in frame_refs:
        frame_refs.append(frame_ref)


def resolve_frame_ref(frame_refs: list[Any], frame_id: str) -> Any:
    for frame_ref in frame_refs:
        if getattr(frame_ref, "_frame_id", "") == frame_id:
            return frame_ref
    return None


def resolve_active_frame_target(last_frame: Any, op: str) -> str:
    if last_frame is not None and getattr(last_frame, "_placed", False):
        return getattr(last_frame, "_frame_id", "")
    if last_frame is not None:
        return f"__pending_{getattr(last_frame, '_pending_key')}"
    raise RuntimeError(
        f"d.{op}(): no frame has been placed yet — call d.add_frame(…) first"
    )


def place_frame_ref(
    frame_ref: Any,
    *,
    frame_ops: dict[str, list[UiPaintOp]],
    pending_ops: dict[int, list[UiPaintOp]],
    runtime_geom: dict[str, dict[str, Any]],
    frame_refs: list[Any],
) -> str:
    old_key = getattr(frame_ref, "_pending_key")
    frame_ref._placed = True
    frame_ref._frame_id = str(frame_ref._pending.id)
    migrate_pending_display_state(
        frame_ops=frame_ops,
        pending_ops=pending_ops,
        runtime_geom=runtime_geom,
        pending_key=old_key,
        frame_id=frame_ref._frame_id,
    )
    register_frame_ref(frame_refs, frame_ref)
    return frame_ref._frame_id


def append_runtime_scene_mesh(
    runtime_geom: dict[str, dict[str, Any]],
    frame_id: str,
    mesh_payload: dict[str, Any],
) -> int:
    scene = ensure_runtime_frame_scene(runtime_geom, frame_id)
    scene["meshes"].append(mesh_payload)
    return len(scene["meshes"]) - 1


def set_runtime_scene_camera(
    runtime_geom: dict[str, dict[str, Any]],
    frame_id: str,
    camera_payload: dict[str, Any],
) -> None:
    ensure_runtime_frame_scene(runtime_geom, frame_id)["camera"] = camera_payload


def append_runtime_scene_light(
    runtime_geom: dict[str, dict[str, Any]],
    frame_id: str,
    light_payload: dict[str, Any],
) -> int:
    scene = ensure_runtime_frame_scene(runtime_geom, frame_id)
    scene["lights"].append(light_payload)
    return len(scene["lights"]) - 1


def install_scene_mesh_object(
    runtime_geom: dict[str, dict[str, Any]],
    scene_objects: dict[tuple[str, int], Any],
    *,
    frame_id: str,
    mesh_payload: dict[str, Any],
    obj: Any,
) -> int:
    mesh_index = append_runtime_scene_mesh(runtime_geom, frame_id, mesh_payload)
    register_scene_object(scene_objects, frame_id=frame_id, mesh_index=mesh_index, obj=obj)
    return mesh_index


def install_scene_camera_payload(
    runtime_geom: dict[str, dict[str, Any]],
    *,
    frame_id: str,
    camera_payload: dict[str, Any],
) -> dict[str, Any]:
    set_runtime_scene_camera(runtime_geom, frame_id, camera_payload)
    return camera_payload


def install_scene_light_payload(
    runtime_geom: dict[str, dict[str, Any]],
    *,
    frame_id: str,
    light_payload: dict[str, Any],
) -> int:
    return append_runtime_scene_light(runtime_geom, frame_id, light_payload)


def migrate_pending_display_state(
    *,
    frame_ops: dict[str, list[UiPaintOp]],
    pending_ops: dict[int, list[UiPaintOp]],
    runtime_geom: dict[str, dict[str, Any]],
    pending_key: int,
    frame_id: str,
) -> None:
    if pending_key in pending_ops:
        frame_ops[frame_id] = frame_ops.get(frame_id, []) + pending_ops.pop(pending_key)
    pending_geom_key = f"__pending_{pending_key}"
    if pending_geom_key in runtime_geom:
        geom_data = runtime_geom.pop(pending_geom_key)
        existing = ensure_runtime_frame_scene(runtime_geom, frame_id)
        existing["meshes"].extend(geom_data["meshes"])
        if geom_data["camera"] is not None:
            existing["camera"] = geom_data["camera"]
        existing["lights"].extend(geom_data["lights"])


def translate_scene_payload(data: dict[str, Any], *, key: str, delta: tuple[float, float, float]) -> None:
    base = data[key]
    data[key] = [base[0] + delta[0], base[1] + delta[1], base[2] + delta[2]]


def set_scene_vec3(data: dict[str, Any], *, key: str, value: tuple[float, float, float]) -> None:
    data[key] = [value[0], value[1], value[2]]


def set_scene_color(data: dict[str, Any], color: Any) -> None:
    data["color"] = str(color)


def set_scene_fov(data: dict[str, Any], degrees: float) -> None:
    data["fov"] = float(degrees)


def rotate_scene_mesh_payload(data: dict[str, Any], *, angle_deg: float, around: str) -> list[float]:
    ax = str(around).lower()
    if ax not in ("x", "y", "z"):
        raise ValueError(f"around must be 'x', 'y', or 'z', got {around!r}")
    current = list(data.get("rotation", [0.0, 0.0, 0.0]))
    idx = {"x": 0, "y": 1, "z": 2}[ax]
    current[idx] = (float(current[idx]) + float(angle_deg)) % 360.0
    data["rotation"] = current
    return current


def rotate_vec3_around_axis(v: list[float] | tuple[float, float, float], axis: str, angle_deg: float) -> list[float]:
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    x, y, z = float(v[0]), float(v[1]), float(v[2])
    if axis == "z":
        return [x * c - y * s, x * s + y * c, z]
    if axis == "x":
        return [x, y * c - z * s, y * s + z * c]
    if axis == "y":
        return [x * c + z * s, y, -x * s + z * c]
    raise ValueError(f"axis must be 'x', 'y', or 'z', got {axis!r}")


def orbit_camera_payload(data: dict[str, Any], *, angle_deg: float, around: str) -> None:
    ax = str(around).lower()
    if ax not in ("x", "y", "z"):
        raise ValueError(f"around must be 'x', 'y', or 'z', got {around!r}")
    p = data["pos"]
    t = data["target"]
    offset = [p[0] - t[0], p[1] - t[1], p[2] - t[2]]
    rotated = rotate_vec3_around_axis(offset, ax, angle_deg)
    data["pos"] = [t[0] + rotated[0], t[1] + rotated[1], t[2] + rotated[2]]


def zoom_camera_payload(
    data: dict[str, Any],
    *,
    step: float,
    speed: float = 0.16,
    min_dist: float = 0.2,
    max_dist: float = 1e6,
) -> None:
    s = float(step)
    if s == 0.0:
        return
    spd = max(0.0001, float(speed))
    mn = max(0.0001, float(min_dist))
    mx = max(mn, float(max_dist))

    p = data["pos"]
    t = data["target"]
    dx = p[0] - t[0]
    dy = p[1] - t[1]
    dz = p[2] - t[2]
    dist = math.sqrt(dx * dx + dy * dy + dz * dz)
    if dist <= 1e-12:
        return
    nx, ny, nz = dx / dist, dy / dist, dz / dist
    new_dist = dist * math.exp(s * spd)
    if new_dist < mn:
        new_dist = mn
    elif new_dist > mx:
        new_dist = mx
    data["pos"] = [t[0] + nx * new_dist, t[1] + ny * new_dist, t[2] + nz * new_dist]


def set_light_model(data: dict[str, Any], model: str, *, allowed_models: set[str]) -> None:
    normalized = str(model).lower().replace("-", "_")
    if normalized not in allowed_models:
        raise ValueError(f"model {model!r} unknown; use one of: {sorted(allowed_models)}")
    data["model"] = normalized


def orbit_light_payload(data: dict[str, Any], *, angle_deg: float, around: str) -> None:
    ax = str(around).lower()
    if ax not in ("x", "y", "z"):
        raise ValueError("around must be 'x', 'y', or 'z'")
    data["pos"] = rotate_vec3_around_axis(data["pos"], ax, angle_deg)
