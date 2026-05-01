"""Pure runtime state and snapshot helpers for ``ui.display``."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from vektorflow.ui_display_ir import (
    UiDisplaySyncPlan,
    UiPaintOp,
    append_frame_paint_op,
    append_pending_frame_paint_op,
    append_screen_paint_op,
    build_display_sync_plan,
    ensure_runtime_frame_scene,
    place_frame_ref,
    resolve_active_frame_target,
    resolve_frame_ref,
    resolve_scene_object_for_pick,
)
from vektorflow.ui_scene_graph_math import Affine2D, IDENTITY_AFFINE_2D


def collect_screen_paint_ops(
    screen_ops: list[UiPaintOp],
    screen_shape_roots: list[Any],
    *,
    identity_transform: Affine2D = IDENTITY_AFFINE_2D,
) -> list[UiPaintOp]:
    combined_ops = list(screen_ops)
    for shape in screen_shape_roots:
        shape._collect_paint_ops(identity_transform, combined_ops)
    return combined_ops


def collect_frame_paint_ops(
    frame_ops: dict[str, list[UiPaintOp]],
    frame_refs: list[Any],
) -> dict[str, list[UiPaintOp]]:
    combined_ops = {
        frame_id: list(ops)
        for frame_id, ops in frame_ops.items()
    }
    for frame_ref in frame_refs:
        if not getattr(frame_ref, "_placed", False):
            continue
        frame_id = getattr(frame_ref, "_frame_id", "")
        if not frame_id:
            continue
        shape_ops = frame_ref._collect_shape_ops()
        if shape_ops:
            combined_ops.setdefault(frame_id, []).extend(shape_ops)
    return combined_ops


@dataclass(slots=True)
class DisplayRuntimeState:
    screen_ops: list[UiPaintOp] = field(default_factory=list)
    frame_ops: dict[str, list[UiPaintOp]] = field(default_factory=dict)
    pending_ops: dict[int, list[UiPaintOp]] = field(default_factory=dict)
    runtime_geom: dict[str, dict[str, Any]] = field(default_factory=dict)
    scene_objects: dict[tuple[str, int], Any] = field(default_factory=dict)
    frame_refs: list[Any] = field(default_factory=list)
    screen_shape_roots: list[Any] = field(default_factory=list)
    cursor_mode: str = "default"
    last_scene_cmd_count: int = -1
    last_frame: Any | None = None

    def add_screen_shape_root(self, root: Any) -> None:
        self.screen_shape_roots.append(root)

    def append_screen_op(self, op: UiPaintOp) -> None:
        append_screen_paint_op(self.screen_ops, op)

    def append_frame_op(self, frame_id: str, op: UiPaintOp) -> None:
        append_frame_paint_op(self.frame_ops, frame_id, op)

    def append_pending_frame_op(self, key: int, op: UiPaintOp) -> None:
        append_pending_frame_paint_op(self.pending_ops, key, op)

    def ensure_runtime_scene(self, frame_id: str) -> dict[str, Any]:
        return ensure_runtime_frame_scene(self.runtime_geom, frame_id)

    def mark_frame_ref_placed(self, frame_ref: Any) -> None:
        place_frame_ref(
            frame_ref,
            frame_ops=self.frame_ops,
            pending_ops=self.pending_ops,
            runtime_geom=self.runtime_geom,
            frame_refs=self.frame_refs,
        )
        self.last_frame = frame_ref

    def resolve_active_frame(self, op: str) -> str:
        return resolve_active_frame_target(self.last_frame, op)

    def resolve_frame(self, frame_id: str) -> Any:
        return resolve_frame_ref(self.frame_refs, frame_id)

    def resolve_scene_object(self, object_id: int) -> Any:
        return resolve_scene_object_for_pick(self.runtime_geom, self.scene_objects, object_id)

    def build_sync_snapshot(
        self,
        *,
        command_count: int,
        has_scene_commands: bool,
        identity_transform: Affine2D = IDENTITY_AFFINE_2D,
    ) -> UiDisplaySyncPlan:
        return build_display_sync_plan(
            screen_ops=collect_screen_paint_ops(
                self.screen_ops,
                self.screen_shape_roots,
                identity_transform=identity_transform,
            ),
            frame_ops=collect_frame_paint_ops(self.frame_ops, self.frame_refs),
            runtime_geom=self.runtime_geom,
            command_count=command_count,
            last_scene_cmd_count=self.last_scene_cmd_count,
            has_scene_commands=has_scene_commands,
            cursor=self.cursor_mode,
        )

    def build_sync_plan(
        self,
        *,
        command_count: int,
        has_scene_commands: bool,
        identity_transform: Affine2D = IDENTITY_AFFINE_2D,
    ) -> UiDisplaySyncPlan:
        return self.build_sync_snapshot(
            command_count=command_count,
            has_scene_commands=has_scene_commands,
            identity_transform=identity_transform,
        )

    def record_scene_command_sync(self, next_scene_cmd_count: int) -> None:
        self.last_scene_cmd_count = next_scene_cmd_count


DisplaySceneState = DisplayRuntimeState


__all__ = [
    "Affine2D",
    "DisplayRuntimeState",
    "DisplaySceneState",
    "IDENTITY_AFFINE_2D",
    "collect_frame_paint_ops",
    "collect_screen_paint_ops",
]
