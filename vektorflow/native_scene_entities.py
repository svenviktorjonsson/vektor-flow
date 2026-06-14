from __future__ import annotations

from typing import Any

from .runtime.axis_tagged import axis_tagged_data, axis_tagged_idx, axis_tagged_wrap, is_axis_tagged_value


_NATIVE_AXIS_SUFFIX_CHARS = frozenset("tijkuvwh")
_AXIS_TAGGED_KEY = "__vf_axis_tagged__"


def _optional_struct_value(scope: dict[str, Any], name: str) -> dict[str, Any] | None:
    value = scope.get(name)
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be a struct")
    return value


def normalize_native_named_parameters(
    scope: dict[str, Any],
    *,
    default_embedding: dict[str, str],
    path: str,
    reserved: set[str] | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    reserved_names = {"properties", "embedding"}
    if reserved:
        reserved_names.update(str(name) for name in reserved)
    raw_props: dict[str, Any] = {}
    props_scope = _optional_struct_value(scope, "properties")
    if props_scope is not None:
        for key, value in props_scope.items():
            raw_props[str(key)] = value
    for key, value in scope.items():
        if key in reserved_names:
            continue
        if key in raw_props:
            raise ValueError(f"{path}.{key} declared in both properties and top level")
        raw_props[str(key)] = value
    props: dict[str, Any] = {}
    seen_axis_props: dict[str, str] = {}
    for key, value in raw_props.items():
        if "_" in key:
            base_name, axis_name = key.rsplit("_", 1)
            if base_name and axis_name and axis_name != "_" and all(ch in _NATIVE_AXIS_SUFFIX_CHARS for ch in axis_name):
                if base_name in props:
                    raise ValueError(f"{path}.{base_name} mixes direct and suffixed property forms")
                if base_name in seen_axis_props:
                    raise ValueError(f"{path}.{base_name} property axis form is ambiguous")
                props[base_name] = axis_tagged_wrap(value, "i" if axis_name == "_" else axis_name)
                seen_axis_props[base_name] = axis_name
                continue
        if key in seen_axis_props:
            raise ValueError(f"{path}.{key} mixes direct and suffixed property forms")
        props[key] = value
    embedding = dict(default_embedding)
    embedding_scope = _optional_struct_value(scope, "embedding")
    if embedding_scope is not None:
        for canonical, prop_name in embedding_scope.items():
            if not isinstance(prop_name, str) or not prop_name.strip():
                raise ValueError(f"{path}.embedding.{canonical} must be non-empty string")
            embedding[str(canonical)] = str(prop_name)
    return props, embedding


def normalize_native_named_tracks(
    scope: dict[str, Any],
    props: dict[str, Any],
    embedding: dict[str, str],
    *,
    legacy_canonical_names: tuple[str, ...],
    path: str,
) -> dict[str, Any]:
    tracks: dict[str, Any] = {}
    track_scope = _optional_struct_value(scope, "tracks")
    if track_scope is not None:
        for key, value in track_scope.items():
            tracks[str(key)] = value
    for prop_name, value in list(props.items()):
        if not is_axis_tagged_value(value):
            continue
        axis_name = axis_tagged_idx(value)
        if not axis_name or not str(axis_name).endswith("t"):
            continue
        if prop_name in tracks:
            raise ValueError(f"{path}.tracks.{prop_name} conflicts with tracked property value")
        tracks[prop_name] = axis_tagged_data(value) if axis_name == "t" else value
        props.pop(prop_name, None)
    for canonical_name in legacy_canonical_names:
        legacy_key = f"{canonical_name}_t"
        if legacy_key not in props:
            continue
        prop_name = str(embedding.get(canonical_name, canonical_name))
        if prop_name in tracks:
            raise ValueError(f"{path}.{legacy_key} conflicts with tracks.{prop_name}")
        tracks[prop_name] = props.pop(legacy_key)
    return tracks


def embedded_named_property(
    props: dict[str, Any],
    embedding: dict[str, str],
    canonical_name: str,
    default: Any,
) -> Any:
    prop_name = str(embedding.get(canonical_name, canonical_name))
    return props.get(prop_name, default)


def native_json_safe_value(value: Any) -> Any:
    if is_axis_tagged_value(value):
        idx = axis_tagged_idx(value) or ""
        data = native_json_safe_value(axis_tagged_data(value))
        if len(idx) <= 1:
            return data
        return {
            _AXIS_TAGGED_KEY: True,
            "idx": idx,
            "data": data,
        }
    if isinstance(value, dict):
        return {str(k): native_json_safe_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [native_json_safe_value(v) for v in value]
    if isinstance(value, tuple):
        return [native_json_safe_value(v) for v in value]
    if isinstance(value, complex):
        if value.imag != 0:
            raise ValueError("native scene JSON values must be real numbers; got non-real num")
        return value.real
    return value


def scene_ir_mesh_entity(
    *,
    mesh_id: str,
    kind: str,
    properties: dict[str, Any],
    embedding: dict[str, str],
    tracks: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "id": str(mesh_id),
        "kind": str(kind),
        "properties": native_json_safe_value(dict(properties)),
        "embedding": dict(embedding),
    }
    if tracks:
        payload["tracks"] = native_json_safe_value(dict(tracks))
    return payload


def scene_ir_shadow_receiver_entity(
    *,
    receiver_mesh: str,
    occluders: list[str],
    lights: list[str],
    policy_kind: str,
    policy_softness: str,
) -> dict[str, Any]:
    return {
        "properties": {
            "receiver_mesh": str(receiver_mesh),
            "occluders": [str(item) for item in occluders],
            "lights": [str(item) for item in lights],
            "policy_kind": str(policy_kind),
            "policy_softness": str(policy_softness),
        },
        "embedding": {
            "receiver_mesh": "receiver_mesh",
            "occluders": "occluders",
            "lights": "lights",
            "policy_kind": "policy_kind",
            "policy_softness": "policy_softness",
        },
    }


__all__ = [
    "embedded_named_property",
    "native_json_safe_value",
    "normalize_native_named_parameters",
    "normalize_native_named_tracks",
    "scene_ir_mesh_entity",
    "scene_ir_shadow_receiver_entity",
]
