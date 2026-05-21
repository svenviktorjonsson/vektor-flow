from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


NativeOverlaySceneContractKind = Literal["native_scene", "scene_probe"]


@dataclass(frozen=True)
class NativeOverlaySceneContract:
    session_stem: str
    kind: NativeOverlaySceneContractKind
    payload: dict[str, Any]


__all__ = [
    "NativeOverlaySceneContract",
    "NativeOverlaySceneContractKind",
]
