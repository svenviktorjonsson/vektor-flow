"""UI / host bridge types (frames, rects, command stream)."""

from __future__ import annotations

from vektorflow.ui.ir import (
    DockLocation,
    FrameFlags,
    FrameSpec,
    NormRect,
    UiCommand,
    UiCommandKind,
    dumps_scene,
    parse_dock_location,
)

__all__ = [
    "DockLocation",
    "FrameFlags",
    "FrameSpec",
    "NormRect",
    "UiCommand",
    "UiCommandKind",
    "dumps_scene",
    "parse_dock_location",
]
