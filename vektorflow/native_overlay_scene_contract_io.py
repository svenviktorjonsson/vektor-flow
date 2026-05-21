from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

from .native_overlay_scene_contract import (
    NativeOverlaySceneContract,
    NativeOverlaySceneContractKind,
)
from .runtime.axis_tagged import axis_tagged_data, axis_tagged_idx, axis_tagged_wrap, is_axis_tagged_value


_VALID_KINDS = {"native_scene", "scene_probe"}
_AXIS_TAGGED_KEY = "__vf_axis_tagged__"


def _json_safe_contract_value(value: Any) -> Any:
    if is_axis_tagged_value(value):
        return {
            _AXIS_TAGGED_KEY: True,
            "idx": axis_tagged_idx(value),
            "data": _json_safe_contract_value(axis_tagged_data(value)),
        }
    if isinstance(value, dict):
        return {str(key): _json_safe_contract_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe_contract_value(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe_contract_value(item) for item in value]
    return value


def _contract_value_from_json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        if value.get(_AXIS_TAGGED_KEY) is True:
            idx = value.get("idx")
            if not isinstance(idx, str) or not idx:
                raise ValueError("native overlay scene contract axis-tagged value idx must be a non-empty string")
            return axis_tagged_wrap(_contract_value_from_json_safe(value.get("data")), idx)
        return {str(key): _contract_value_from_json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_contract_value_from_json_safe(item) for item in value]
    return value


def native_overlay_scene_contract_to_data(
    contract: NativeOverlaySceneContract,
) -> dict[str, Any]:
    return {
        "session_stem": str(contract.session_stem),
        "kind": str(contract.kind),
        "payload": _json_safe_contract_value(contract.payload),
    }


def native_overlay_scene_contract_from_data(
    data: dict[str, Any],
) -> NativeOverlaySceneContract:
    session_stem = data.get("session_stem")
    kind = data.get("kind")
    payload = data.get("payload")
    if not isinstance(session_stem, str) or not session_stem.strip():
        raise ValueError("native overlay scene contract session_stem must be a non-empty string")
    if not isinstance(kind, str) or kind not in _VALID_KINDS:
        raise ValueError("native overlay scene contract kind must be 'native_scene' or 'scene_probe'")
    if not isinstance(payload, dict):
        raise ValueError("native overlay scene contract payload must be an object")
    return NativeOverlaySceneContract(
        session_stem=session_stem,
        kind=cast(NativeOverlaySceneContractKind, kind),
        payload=cast(dict[str, Any], _contract_value_from_json_safe(payload)),
    )


def read_native_overlay_scene_contract(path: Path) -> NativeOverlaySceneContract:
    resolved = Path(path).resolve()
    data = json.loads(resolved.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("native overlay scene contract file must contain a JSON object")
    return native_overlay_scene_contract_from_data(data)


def write_native_overlay_scene_contract(
    path: Path,
    contract: NativeOverlaySceneContract,
) -> Path:
    resolved = Path(path).resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    resolved.write_text(
        json.dumps(
            native_overlay_scene_contract_to_data(contract),
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return resolved


__all__ = [
    "native_overlay_scene_contract_from_data",
    "native_overlay_scene_contract_to_data",
    "read_native_overlay_scene_contract",
    "write_native_overlay_scene_contract",
]
