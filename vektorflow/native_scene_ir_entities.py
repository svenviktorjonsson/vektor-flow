from __future__ import annotations

from typing import Any

from . import native_scene_entities as _entities
from .runtime.axis_tagged import axis_tagged_data, axis_tagged_idx, axis_tagged_wrap, is_axis_tagged_value


_NATIVE_AXIS_SUFFIX_CHARS = frozenset("tijkuvwh")


def _coerce_sequence(value: Any, *, path: str) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, (str, bytes, dict)) or value is None:
        raise ValueError(f"{path} must be a list of light structs")
    try:
        return list(value)
    except TypeError as exc:
        raise ValueError(f"{path} must be a list of light structs") from exc


def _optional_axis_value(scope: dict[str, Any], name: str) -> Any:
    direct = scope.get(name, _UNSUPPORTED)
    matches: list[tuple[str, Any]] = []
    prefix = f"{name}_"
    for key, value in scope.items():
        if key.startswith(prefix) and len(key) > len(prefix):
            axis_name = key[len(prefix):]
            if axis_name != "_" and any(ch not in _NATIVE_AXIS_SUFFIX_CHARS for ch in axis_name):
                continue
            matches.append((axis_name, value))
    if direct is not _UNSUPPORTED and matches:
        raise ValueError(f"native_scene.{name} must use either {name!r} or suffixed axis form, not both")
    if direct is not _UNSUPPORTED:
        return direct
    if not matches:
        return None
    if len(matches) != 1:
        raise ValueError(f"native_scene.{name} axis form is ambiguous; found multiple suffixed variants")
    axis_name, value = matches[0]
    return axis_tagged_wrap(value, "i" if axis_name == "_" else axis_name)


def _normalize_native_light_model(model: str) -> str:
    normalized = str(model).lower().replace("-", "_")
    if normalized in {"flat", "lambert", "phong", "blinn_phong"}:
        return "blinn_phong"
    raise ValueError(f"native_scene light model {model!r} unknown; use 'blinn_phong'")


def _normalize_native_light_kind(kind: str) -> str:
    normalized = str(kind).lower().strip()
    if normalized == "spotlight":
        normalized = "spot"
    if normalized not in {"point", "spot", "projected"}:
        raise ValueError(f"native_scene light kind {kind!r} unknown; use 'point', 'spot', or 'projected'")
    return normalized


def normalize_scene_ir_camera_entity(scope: dict[str, Any]) -> dict[str, Any]:
    camera = scope.get("camera")
    if camera is None:
        camera = {}
    if not isinstance(camera, dict):
        raise ValueError("native_scene.camera must be a struct")
    props, embedding = _entities.normalize_native_named_parameters(
        camera,
        default_embedding={
            "pos": "pos",
            "target": "target",
            "fov": "fov",
            "up": "up",
            "min_distance": "min_distance",
            "radius": "radius",
            "height": "height",
            "theta": "theta",
            "turns_per_cycle": "turns_per_cycle",
        },
        path="native_scene.camera",
    )
    if not props:
        props = {
            "pos": [3.9, -5.6, 3.2],
            "target": [0.0, 0.0, 0.9],
            "fov": 34.0,
            "up": [0.0, 0.0, 1.0],
        }
    fit_to_mesh_id = props.pop("fit_to_mesh_id", None)
    if fit_to_mesh_id is not None:
        if not isinstance(fit_to_mesh_id, str):
            raise ValueError("native_scene.camera.fit_to_mesh_id must be a string")
        props["aperture_mirror_mesh_id"] = fit_to_mesh_id
    controls_mode = props.get("controls_mode")
    if controls_mode is not None:
        if controls_mode not in {"look_only", "free", "game"}:
            raise ValueError("native_scene.camera.controls_mode must be look_only, free, or game")
        if controls_mode == "look_only":
            props["look_only_controls"] = True
    mirror_of = props.pop("mirror_of", None)
    if mirror_of is not None:
        if not isinstance(mirror_of, dict):
            raise ValueError("native_scene.camera.mirror_of must be a struct")
        frame_id = mirror_of.get("frame_id")
        mesh_id = mirror_of.get("mesh_id")
        if not isinstance(frame_id, str) or not isinstance(mesh_id, str):
            raise ValueError("native_scene.camera.mirror_of requires frame_id and mesh_id")
        props.setdefault("flip_x", True)
        props["aperture_mirror_mesh_id"] = mesh_id
        props["reflect_of_frame_id"] = frame_id
        props["reflect_mirror_mesh_id"] = mesh_id
        props["reflect_eye_only"] = bool(mirror_of.get("reflect_eye_only", True))
        props["lock_aperture_camera"] = bool(mirror_of.get("lock_aperture_camera", True))
        props["controls_enabled"] = bool(mirror_of.get("controls_enabled", False))
    tracks = _entities.normalize_native_named_tracks(
        camera,
        props,
        embedding,
        legacy_canonical_names=("pos", "target", "fov", "up", "min_distance", "radius", "height", "theta", "turns_per_cycle"),
        path="native_scene.camera",
    )
    result = {"properties": _entities.native_json_safe_value(props), "embedding": embedding}
    if tracks:
        result["tracks"] = _entities.native_json_safe_value(tracks)
    return result


def normalize_scene_ir_light_entity(light: dict[str, Any]) -> dict[str, Any]:
    props, embedding = _entities.normalize_native_named_parameters(
        light,
        default_embedding={
            "id": "id",
            "pos": "pos",
            "target": "target",
            "motion": "motion",
            "radius": "radius",
            "height": "height",
            "theta": "theta",
            "theta_amplitude": "theta_amplitude",
            "turns_per_cycle": "turns_per_cycle",
            "angular_velocity": "angular_velocity",
            "kind": "kind",
            "direction": "direction",
            "intensity": "intensity",
            "power": "power",
            "inner_cone_deg": "inner_cone_deg",
            "outer_cone_deg": "outer_cone_deg",
            "range": "range",
            "model": "model",
            "color": "color",
            "casts_shadow": "casts_shadow",
            "source_radius": "source_radius",
            "spread": "spread",
            "aperture_face_id": "aperture_face_id",
            "aperture_mesh_id": "aperture_mesh_id",
            "reflect_of_light_id": "reflect_of_light_id",
            "reflect_mirror_mesh_id": "reflect_mirror_mesh_id",
            "clip_epsilon_ratio": "clip_epsilon_ratio",
        },
        path="native_scene.light",
    )
    if "clip_epsilon" in props:
        raise ValueError("native_scene light clip_epsilon is absolute; use clip_epsilon_ratio")
    tracks = _entities.normalize_native_named_tracks(
        light,
        props,
        embedding,
        legacy_canonical_names=(
            "pos",
            "target",
            "direction",
            "intensity",
            "power",
            "inner_cone_deg",
            "outer_cone_deg",
            "range",
            "color",
            "source_radius",
            "spread",
            "clip_epsilon_ratio",
        ),
        path="native_scene.light",
    )
    if "dir" in props and "direction" not in props:
        props["direction"] = props.pop("dir")
    props.setdefault("motion", "fixed" if "pos" in props else "orbit")
    props.setdefault("kind", "point")
    props["kind"] = _normalize_native_light_kind(str(props["kind"]))
    props.setdefault("model", "blinn_phong")
    props["model"] = _normalize_native_light_model(str(props["model"]))
    props.setdefault("casts_shadow", True)
    props.setdefault("target", [0.0, 0.0, 0.0])
    props.setdefault("color", [1.0, 0.93, 0.78, 1.0])
    props.setdefault("intensity", 24.0)
    props.setdefault("power", 0.0)
    props.setdefault("inner_cone_deg", 14.0)
    props.setdefault("outer_cone_deg", 22.0)
    props.setdefault("range", 0.0)
    props.setdefault("source_radius", 0.0)
    props.setdefault("spread", 1.0)
    props.setdefault("clip_epsilon_ratio", 1e-5)
    props.setdefault("reflect_of_light_id", None)
    props.setdefault("reflect_mirror_mesh_id", None)
    aperture_face_id = props.pop("aperture_face_id", None)
    if aperture_face_id is not None and "aperture_mesh_id" not in props:
        props["aperture_mesh_id"] = aperture_face_id
    if props["motion"] not in {"fixed", "orbit", "oscillate"}:
        raise ValueError("native_scene lights motion must be fixed, orbit, or oscillate")
    result = {"properties": _entities.native_json_safe_value(props), "embedding": embedding}
    if tracks:
        result["tracks"] = _entities.native_json_safe_value(tracks)
    return result


def normalize_scene_ir_light_entity_set(scope: dict[str, Any]) -> list[dict[str, Any]]:
    light_value = _optional_axis_value(scope, "light")
    lights_value = _optional_axis_value(scope, "lights")
    has_light = light_value is not None
    has_lights = lights_value is not None
    mode_count = sum(1 for flag in (has_light, has_lights) if flag)
    if mode_count > 1:
        raise ValueError("native_scene light declarations must use only one of light or lights")
    lights_axis = axis_tagged_idx(lights_value) if is_axis_tagged_value(lights_value) else None
    lights_data = axis_tagged_data(lights_value) if is_axis_tagged_value(lights_value) else lights_value
    if has_lights and lights_axis is not None:
        if lights_axis == "i":
            lights = [normalize_scene_ir_light_entity(light) for light in _coerce_sequence(lights_data, path="native_scene.lights")]
        elif lights_axis == "ij":
            lights = [normalize_scene_ir_light_entity(light) for row in _coerce_sequence(lights_data, path="native_scene.lights") for light in _coerce_sequence(row, path="native_scene.lights[]")]
        else:
            raise ValueError("native_scene.lights axis tag must be i or ij")
    elif has_lights:
        lights = [normalize_scene_ir_light_entity(light) for light in _coerce_sequence(lights_data, path="native_scene.lights")]
    else:
        lights = [normalize_scene_ir_light_entity(light_value if isinstance(light_value, dict) else {})]
    if len(lights) > 64:
        raise ValueError("native_scene lights supports at most 64 lights in compiler IR")
    for index, light in enumerate(lights):
        props = light.setdefault("properties", {})
        embedding = light.setdefault("embedding", {"id": "id"})
        prop_name = str(embedding.get("id", "id"))
        props[prop_name] = str(props.get(prop_name) or f"light_{index}")
    return lights


_UNSUPPORTED = object()


__all__ = [
    "normalize_scene_ir_camera_entity",
    "normalize_scene_ir_light_entity",
    "normalize_scene_ir_light_entity_set",
]
