from __future__ import annotations

from typing import Any

from . import native_scene_entities as _entities


def _scene_light_id(entity: dict[str, Any], fallback_index: int) -> str:
    props = entity.get("properties") if isinstance(entity, dict) else None
    if isinstance(props, dict):
        raw = props.get("id")
        if isinstance(raw, str) and raw.strip():
            return raw
    return f"light_{fallback_index}"


def build_scene_3d_state(
    *,
    frame_spec: dict[str, Any],
    plane_spec: dict[str, Any],
    plane_props: dict[str, Any],
    plane_embedding: dict[str, str],
    object_meshes: list[dict[str, Any]],
    object_mesh_entities: list[dict[str, Any]],
    camera_entity: dict[str, Any],
    lights: list[dict[str, Any]],
    light_entities: list[dict[str, Any]],
    timing: dict[str, Any] | None,
    shadow_spec: dict[str, Any],
    show_light_markers: bool,
    light_flares: bool,
    light_marker_size: float,
    surface_worlds: dict[str, Any] | None = None,
    surface_cameras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meshes: list[dict[str, Any]] = [
        {
            "id": "plane_0",
            "kind": "quad",
            "center": plane_spec["center"],
            "size": plane_spec["size"],
            "z": plane_spec["z"],
            "color": plane_spec["color"],
            "visible": plane_spec["visible"],
            "surface_system": plane_spec.get("surface_system"),
        },
        *object_meshes,
    ]
    mesh_entities: list[dict[str, Any]] = [
        _entities.scene_ir_mesh_entity(
            mesh_id="plane_0",
            kind="quad",
            properties=plane_props,
            embedding=plane_embedding,
        ),
        *object_mesh_entities,
    ]
    shadow_light_ids = [
        _scene_light_id(light_entities[index], index)
        for index, light in enumerate(lights)
        if light.get("casts_shadow", True)
    ]
    shadow_receivers: list[dict[str, Any]] = [
        _entities.scene_ir_shadow_receiver_entity(
            receiver_mesh="plane_0",
            occluders=[str(mesh["id"]) for mesh in object_meshes],
            lights=shadow_light_ids,
            policy_kind="light_camera_depth_map",
            policy_softness="shadow_map_bias",
        )
    ]
    scene_ir = {
        "frame": frame_spec,
        "camera": camera_entity,
        "lights": light_entities,
        "timing": timing,
        "meshes": mesh_entities,
        "shadow_receivers": shadow_receivers,
        "shadow": shadow_spec,
        "surface_worlds": dict(surface_worlds or {}),
        "surface_cameras": dict(surface_cameras or {}),
        "render_options": {
            "show_light_markers": bool(show_light_markers),
            "light_flares": bool(light_flares),
            "light_marker_size": float(light_marker_size),
        },
    }
    return {
        "meshes": meshes,
        "mesh_entities": mesh_entities,
        "shadow_receivers": shadow_receivers,
        "scene_ir": scene_ir,
    }
__all__ = ["build_scene_3d_state"]
