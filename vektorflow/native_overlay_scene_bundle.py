from __future__ import annotations

import copy
from dataclasses import dataclass
import json
from pathlib import Path
import re
import time
from typing import Any, Callable

from . import ast
from .native_overlay_scene_contract import NativeOverlaySceneContract
from . import native_scene_entities as _entities
from . import native_scene_ir_builder as _ir_builder
from . import native_scene_ir_entities as _ir_entities
from . import native_scene_topology as _topology
from .runtime.axis_tagged import axis_tagged_data, axis_tagged_idx, axis_tagged_wrap, is_axis_tagged_value


_DEFAULT_INPUT_TITLE = "Input Surface"
_DEFAULT_LOG_TITLE = "Native Log"
_DEFAULT_RUN_TAG = "native-scene-probe ready"
_DEFAULT_PROMPT = "focus left pane, then move / click / type"
_DEFAULT_INPUT_RECT = (0.06, 0.08, 0.38, 0.78)
_DEFAULT_LOG_RECT = (0.48, 0.05, 0.46, 0.86)
_UNSUPPORTED = object()
_NATIVE_AXIS_SUFFIX_CHARS = frozenset("tijkuvwh")


def _dot3(a: list[float], b: list[float]) -> float:
    return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2])


def _normalize3(v: list[float]) -> list[float]:
    length = (_dot3(v, v)) ** 0.5
    if length <= 1e-9:
        return [0.0, 0.0, 1.0]
    inv = 1.0 / length
    return [v[0] * inv, v[1] * inv, v[2] * inv]


def _rotate_vec3_zyx_deg(v: list[float], rotation_deg: list[float]) -> list[float]:
    import math

    rx = math.radians(float(rotation_deg[0] if len(rotation_deg) > 0 else 0.0))
    ry = math.radians(float(rotation_deg[1] if len(rotation_deg) > 1 else 0.0))
    rz = math.radians(float(rotation_deg[2] if len(rotation_deg) > 2 else 0.0))

    x, y, z = float(v[0]), float(v[1]), float(v[2])

    cy = math.cos(rz)
    sy = math.sin(rz)
    x, y = (x * cy) - (y * sy), (x * sy) + (y * cy)

    cy = math.cos(ry)
    sy = math.sin(ry)
    x, z = (x * cy) + (z * sy), (-x * sy) + (z * cy)

    cx = math.cos(rx)
    sx = math.sin(rx)
    y, z = (y * cx) - (z * sx), (y * sx) + (z * cx)

    return [x, y, z]


def _surface_plane_point_normal(surface: dict[str, Any]) -> tuple[list[float], list[float]] | None:
    center_value = surface.get("center")
    if not isinstance(center_value, list):
        return None
    if len(center_value) == 3:
        center = [float(center_value[0]), float(center_value[1]), float(center_value[2])]
    elif len(center_value) == 2:
        center = [float(center_value[0]), float(center_value[1]), 0.0]
        if "z" in surface:
            center[2] = float(surface.get("z") or 0.0)
    else:
        return None
    rotation_value = surface.get("rotation")
    rotation = (
        [float(rotation_value[0]), float(rotation_value[1]), float(rotation_value[2])]
        if isinstance(rotation_value, list) and len(rotation_value) == 3
        else [0.0, 0.0, 0.0]
    )
    normal = _normalize3(_rotate_vec3_zyx_deg([0.0, 0.0, 1.0], rotation))
    return center, normal


def _reflect_point_across_plane(point: list[float], plane_point: list[float], plane_normal: list[float]) -> list[float]:
    offset = [
        float(point[0]) - float(plane_point[0]),
        float(point[1]) - float(plane_point[1]),
        float(point[2]) - float(plane_point[2]),
    ]
    dist = _dot3(offset, plane_normal)
    return [
        float(point[0]) - (2.0 * dist * plane_normal[0]),
        float(point[1]) - (2.0 * dist * plane_normal[1]),
        float(point[2]) - (2.0 * dist * plane_normal[2]),
    ]


def _lower_scene_3d_surface_camera_mirrors_to_views(declared: dict[str, Any]) -> dict[str, Any] | None:
    surfaces = declared.get("surfaces")
    if not isinstance(surfaces, list) or not surfaces:
        return None
    visible_decl = copy.deepcopy(declared)
    hidden_decls: list[dict[str, Any]] = []
    changed = False
    visible_surfaces = visible_decl.get("surfaces")
    if not isinstance(visible_surfaces, list):
        return None
    visible_frame_id = str(declared.get("frame_id") or "")
    visible_rect = list(declared.get("rect") or [0.0, 0.0, 1.0, 1.0])
    visible_aspect = declared.get("aspect")
    for index, surface in enumerate(surfaces):
        if not isinstance(surface, dict):
            continue
        system = surface.get("surface_system")
        if not isinstance(system, dict):
            continue
        camera = system.get("camera")
        if not isinstance(camera, dict):
            continue
        mirror_of = camera.get("mirror_of")
        reflect_mesh_id = camera.get("reflect_mirror_mesh_id")
        if not isinstance(mirror_of, dict) and not isinstance(reflect_mesh_id, str):
            continue
        source_frame_id = f"{visible_frame_id}__surface_source_{index}"
        visible_surface = visible_surfaces[index]
        if not isinstance(visible_surface, dict):
            continue
        visible_system = visible_surface.get("surface_system")
        if not isinstance(visible_system, dict):
            continue
        visible_system.pop("camera", None)
        visible_system["frame_ref"] = source_frame_id
        if str(visible_system.get("kind", "")).lower().strip() == "mirror":
            visible_system["kind"] = "screen"
            visible_system["reverse_facing"] = True
        hidden_decl = copy.deepcopy(declared)
        hidden_decl["kind"] = "scene_3d"
        hidden_decl["frame_id"] = source_frame_id
        hidden_decl["title"] = ""
        hidden_decl["rect"] = list(visible_rect)
        hidden_decl["visible"] = False
        hidden_decl["show_light_markers"] = False
        if visible_aspect is not None:
            hidden_decl["aspect"] = visible_aspect
        hidden_camera = copy.deepcopy(camera)
        visible_camera = visible_decl.get("camera")
        if isinstance(visible_camera, dict):
            for field in ("pos", "target", "up", "fov"):
                if field not in hidden_camera and field in visible_camera:
                    hidden_camera[field] = copy.deepcopy(visible_camera[field])
        hidden_decl["camera"] = hidden_camera
        plane = _surface_plane_point_normal(surface)
        if plane is not None and isinstance(hidden_camera, dict):
            plane_point, plane_normal = plane
            hidden_pos = hidden_camera.get("pos")
            if isinstance(hidden_pos, list) and len(hidden_pos) == 3:
                hidden_camera["pos"] = _reflect_point_across_plane(
                    [float(hidden_pos[0]), float(hidden_pos[1]), float(hidden_pos[2])],
                    plane_point,
                    plane_normal,
                )
            hidden_camera["target"] = plane_point
        hidden_surfaces = hidden_decl.get("surfaces")
        if isinstance(hidden_surfaces, list) and index < len(hidden_surfaces) and isinstance(hidden_surfaces[index], dict):
            hidden_surfaces[index]["surface_system"] = None
            hidden_surfaces[index]["visible"] = False
        hidden_decls.append(hidden_decl)
        changed = True
    if not changed:
        return None
    normalized_visible = _normalize_scene_3d_spec(visible_decl)
    visible_camera_props = (
        normalized_visible.get("camera", {}).get("properties", {})
        if isinstance(normalized_visible, dict)
        else {}
    )
    normalized_hidden_views: list[dict[str, Any]] = []
    for hidden in hidden_decls:
        normalized_hidden = _normalize_scene_3d_spec(hidden)
        hidden_camera = normalized_hidden.get("camera")
        if isinstance(hidden_camera, dict):
            hidden_props = hidden_camera.get("properties")
            if isinstance(hidden_props, dict):
                for field in ("pos", "target", "up", "fov"):
                    if field not in hidden_props and field in visible_camera_props:
                        hidden_props[field] = copy.deepcopy(visible_camera_props[field])
        normalized_hidden_views.append(normalized_hidden)
    return {
        "kind": "scene_3d_views",
        "views": [
            *normalized_hidden_views,
            normalized_visible,
        ],
    }


def _normalize_native_light_model(model: str) -> str:
    normalized = str(model).lower().replace("-", "_")
    if normalized in {"flat", "lambert", "phong", "blinn_phong"}:
        return "blinn_phong"
    raise ValueError(f"native_scene light model {model!r} unknown; use 'blinn_phong'")


def _runtime_asset_version() -> str:
    return str(int(time.time() * 1000))


@dataclass(frozen=True)
class NativeOverlaySceneProgram:
    session_name: str
    page_rel: str
    html_text: str
    runtime_packets_text: str
    geom_transport_text: str = ""
    geom_state_text: str = ""


@dataclass(frozen=True)
class _NativeSceneCompiler:
    default_session_name: str
    normalize_spec: Callable[[dict[str, Any]], dict[str, Any]]
    render_html: Callable[[dict[str, Any]], str]
    render_runtime_packets: Callable[[dict[str, Any]], str]
    render_geom_transport: Callable[[dict[str, Any]], str] | None = None
    render_geom_state: Callable[[dict[str, Any]], str] | None = None


def build_native_overlay_scene_program_from_module(
    module: ast.Module,
    *,
    session_stem: str,
) -> NativeOverlaySceneProgram | None:
    from .native_overlay_scene_frontend import try_extract_native_overlay_scene_contract_from_module

    contract = try_extract_native_overlay_scene_contract_from_module(
        module,
        session_stem=session_stem,
    )
    if contract is None:
        return None
    return build_native_overlay_scene_program_from_contract(contract)


def try_build_native_overlay_scene_program(source_path: Path) -> NativeOverlaySceneProgram | None:
    from .native_overlay_scene_frontend import try_build_native_overlay_scene_program as _frontend_try_build_native_overlay_scene_program

    return _frontend_try_build_native_overlay_scene_program(source_path)


def build_native_overlay_scene_program_from_contract(
    contract: NativeOverlaySceneContract,
) -> NativeOverlaySceneProgram:
    session_name = _slugify(contract.session_stem or "native-scene-probe")
    if contract.kind == "native_scene":
        return _compile_native_scene_program(session_name, contract.payload)
    if contract.kind == "scene_probe":
        spec = contract.payload
        return NativeOverlaySceneProgram(
            session_name=session_name,
            page_rel=f"sessions/{session_name}/vkf-scene.html",
            html_text=_render_scene_probe_html(spec),
            runtime_packets_text=_render_scene_probe_packets(spec),
        )
    raise ValueError(f"unsupported native overlay scene contract kind {contract.kind!r}")


def _compile_native_scene_program(session_stem: str, declared: dict[str, Any]) -> NativeOverlaySceneProgram:
    kind = _require_string_value(declared, "kind")
    compiler = _NATIVE_SCENE_COMPILERS.get(kind)
    if compiler is None:
        supported = ", ".join(sorted(_NATIVE_SCENE_COMPILERS))
        raise ValueError(f"unsupported native_scene.kind {kind!r}; expected one of: {supported}")
    spec = compiler.normalize_spec(declared)
    session_name = _slugify(session_stem or compiler.default_session_name)
    return NativeOverlaySceneProgram(
        session_name=session_name,
        page_rel=f"sessions/{session_name}/vkf-scene.html",
        html_text=compiler.render_html(spec),
        runtime_packets_text=compiler.render_runtime_packets(spec),
        geom_transport_text="" if compiler.render_geom_transport is None else compiler.render_geom_transport(spec),
        geom_state_text="" if compiler.render_geom_state is None else compiler.render_geom_state(spec),
    )


def _normalize_face_edge_vertex_drag_spec(declared: dict[str, Any]) -> dict[str, Any]:
    styles = _require_struct_value(declared, "styles")
    face_style = _require_struct_value(styles, "face")
    edge_style = _require_struct_value(styles, "edge")
    vertex_style = _require_struct_value(styles, "vertex")
    drag = _require_struct_value(declared, "drag")
    return {
        "frame_id": _require_string_value(declared, "frame_id"),
        "title": _require_string_value(declared, "title"),
        "rect": tuple(_require_number_list(declared, "rect", length=4)),
        "aspect": _require_string_value(declared, "aspect"),
        "points": _require_point_list(declared, "points"),
        "edge_pairs": _require_index_pairs(declared, "edge_pairs"),
        "styles": {
            "face": {
                "base_color": _require_rgba(face_style, "base_color"),
                "overlay_colors": _require_overlay_colors(face_style, "overlay_colors"),
            },
            "edge": {
                "base_color": _require_rgba(edge_style, "base_color"),
                "overlay_colors": _require_overlay_colors(edge_style, "overlay_colors"),
                "base_scale": _require_number_value(edge_style, "base_scale"),
                "overlay_scales": _require_overlay_scales(edge_style, "overlay_scales"),
            },
            "vertex": {
                "base_color": _require_rgba(vertex_style, "base_color"),
                "overlay_colors": _require_overlay_colors(vertex_style, "overlay_colors"),
                "base_scale": _require_number_value(vertex_style, "base_scale"),
                "overlay_scales": _require_overlay_scales(vertex_style, "overlay_scales"),
            },
        },
        "drag": {
            "face_vertices": _require_int_list(drag, "face_vertices"),
            "edge_vertices": _require_index_pairs(drag, "edge_vertices"),
            "vertex_vertices": _require_nested_int_list(drag, "vertex_vertices"),
            "preserve_selected_on_plain_down": _require_bool_value(drag, "preserve_selected_on_plain_down"),
        },
    }


def _normalize_cube_hover_spec(declared: dict[str, Any]) -> dict[str, Any]:
    kind = _require_string_value(declared, "kind")
    styles = _require_struct_value(declared, "styles")
    camera = _optional_camera_value(declared)
    light = _optional_light_value(declared)
    return {
        "kind": str(kind),
        "frame_id": _require_string_value(declared, "frame_id"),
        "title": _require_string_value(declared, "title"),
        "rect": tuple(_require_number_list(declared, "rect", length=4)),
        "debug_frame_id": _require_string_value(declared, "debug_frame_id"),
        "debug_title": _require_string_value(declared, "debug_title"),
        "debug_rect": tuple(_require_number_list(declared, "debug_rect", length=4)),
        "edge_radius": _require_number_value(declared, "edge_radius"),
        "vertex_radius": _require_number_value(declared, "vertex_radius"),
        "styles": {
            "face_base": _require_rgba(styles, "face_base"),
            "face_hover": _require_rgba(styles, "face_hover"),
            "edge_base": _require_rgba(styles, "edge_base"),
            "edge_hover": _require_rgba(styles, "edge_hover"),
            "vertex_base": _require_rgba(styles, "vertex_base"),
            "vertex_hover": _require_rgba(styles, "vertex_hover"),
        },
        "camera": camera,
        "light": light,
    }


def _scene_ir_mesh_entity(
    *,
    mesh_id: str,
    kind: str,
    properties: dict[str, Any],
    embedding: dict[str, str],
    tracks: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return _entities.scene_ir_mesh_entity(
        mesh_id=mesh_id,
        kind=kind,
        properties=properties,
        embedding=embedding,
        tracks=tracks,
    )


def _scene_ir_shadow_receiver_entity(
    *,
    receiver_mesh: str,
    occluders: list[str],
    lights: list[str],
    policy_kind: str,
    policy_softness: str,
) -> dict[str, Any]:
    return _entities.scene_ir_shadow_receiver_entity(
        receiver_mesh=receiver_mesh,
        occluders=occluders,
        lights=lights,
        policy_kind=policy_kind,
        policy_softness=policy_softness,
    )


def _normalize_add_simplices_spec(value: Any, *, path: str) -> dict[str, list[list[int]]]:
    return _topology.normalize_add_simplices_spec(value, path=path)


def _normalize_scene_3d_spec(declared: dict[str, Any]) -> dict[str, Any]:
    lowered_views = _lower_scene_3d_surface_camera_mirrors_to_views(declared)
    if lowered_views is not None:
        return lowered_views
    cube = _optional_struct_value(declared, "cube")
    obj = _optional_struct_value(declared, "object")
    plane = _require_struct_value(declared, "plane")
    shadow = _require_struct_value(declared, "shadow")
    cubes_value = _optional_axis_value(declared, "cubes")
    surfaces_value = _optional_axis_value(declared, "surfaces")
    quads_value = _optional_axis_value(declared, "quads")
    if quads_value is not None:
        raise ValueError("native_scene.scene_3d uses surfaces, not quads")
    has_cube = cube is not None
    has_cubes = cubes_value is not None
    has_surfaces = surfaces_value is not None
    if not has_cube and not has_cubes and obj is None and not has_surfaces:
        raise ValueError("native_scene.scene_3d requires cube, cubes, object, or surfaces")
    if sum(1 for flag in (has_cube, has_cubes, obj is not None) if flag) > 1:
        raise ValueError("native_scene.scene_3d accepts only one of cube, cubes, or object")
    cube_spec = None
    object_mesh = None
    object_mesh_entity = None
    if obj is not None:
        object_kind_declared = _optional_string_value(obj, "kind", "")
        if object_kind_declared and object_kind_declared not in {"random_hull", "convex_hull", "simplices"}:
            raise ValueError("native_scene.object.kind must be random_hull, convex_hull, or simplices")
        obj_props, obj_embedding = _normalize_native_named_parameters(
            obj,
            default_embedding={
                "center": "center",
                "radius": "radius",
                "count": "count",
                "seed": "seed",
                "stretch": "stretch",
                "jitter": "jitter",
                "points": "points",
                "add_simplices": "add_simplices",
                "face_color": "face_color",
                "edge_color": "edge_color",
                "edge_width": "edge_width",
                "edge_caps": "edge_caps",
                "edge_lift": "edge_lift",
                "show_edges": "show_edges",
                "vertex_color": "vertex_color",
                "vertex_size": "vertex_size",
                "vertex_lift": "vertex_lift",
                "show_vertices": "show_vertices",
                "color": "color",
                "center": "center",
                "size": "size",
                "rotation": "rotation",
                "transform": "transform",
                "surface_system": "surface_system",
                "texture": "texture",
            },
            reserved={"kind"},
            path="native_scene.object",
        )
        embedded_points = _embedded_named_property(obj_props, obj_embedding, "points", None)
        embedded_points_axis = axis_tagged_idx(embedded_points) if is_axis_tagged_value(embedded_points) else None
        embedded_simplices = _embedded_named_property(obj_props, obj_embedding, "add_simplices", None)
        if embedded_points_axis not in {None, "h", "hi", "d"}:
            raise ValueError("native_scene.object points supports -> h, -> hi, or -> d only right now")
        object_kind = object_kind_declared or ("simplices" if embedded_simplices is not None or embedded_points_axis == "d" else ("convex_hull" if embedded_points_axis in {"h", "hi"} else "random_hull"))
        if object_kind not in {"random_hull", "convex_hull", "simplices", "quad"}:
            raise ValueError("native_scene.object.kind must be random_hull, convex_hull, simplices, or quad")
        if embedded_points_axis in {"h", "hi"} and object_kind != "convex_hull":
            raise ValueError("native_scene.object points -> h/hi requires convex_hull lowering")
        if embedded_points_axis == "d" and object_kind != "simplices":
            raise ValueError("native_scene.object points -> d requires simplices lowering")
        if object_kind == "simplices" and embedded_simplices is None and embedded_points_axis != "d":
            raise ValueError("native_scene.object.kind simplices requires add_simplices")
        if object_kind == "simplices" and embedded_points is None:
            raise ValueError("native_scene.object.kind simplices requires points")
        object_meshes: list[dict[str, Any]] = []
        object_mesh_entities: list[dict[str, Any]] = []
        if object_kind == "quad":
            quad_props = dict(obj_props)
            object_meshes.append({
                "id": "object_0",
                "kind": "quad",
                "center": _embedded_named_property(obj_props, obj_embedding, "center", [0.0, 0.0, 0.0]),
                "size": _embedded_named_property(obj_props, obj_embedding, "size", [1.0, 1.0]),
                "rotation": _embedded_named_property(obj_props, obj_embedding, "rotation", [0.0, 0.0, 0.0]),
                "transform": _embedded_named_property(obj_props, obj_embedding, "transform", None),
                "color": _embedded_named_property(obj_props, obj_embedding, "color", [0.84, 0.86, 0.90, 1.0]),
                "surface_system": _embedded_named_property(obj_props, obj_embedding, "surface_system", None),
                "texture": _embedded_named_property(obj_props, obj_embedding, "texture", None),
                "no_backface_specular": _embedded_named_property(obj_props, obj_embedding, "no_backface_specular", False),
            })
            object_mesh_entities.append(
                _scene_ir_mesh_entity(
                    mesh_id="object_0",
                    kind="quad",
                    properties=quad_props,
                    embedding=obj_embedding,
                    tracks=_normalize_native_named_tracks(
                        declared["object"],
                        obj_props,
                        obj_embedding,
                        legacy_canonical_names=("center", "size", "rotation", "transform", "color", "surface_system", "texture", "no_backface_specular"),
                        path="native_scene.object",
                    ),
                )
            )
        elif object_kind == "convex_hull":
            point_sets, point_mode = _require_hull_point_sets(
                _embedded_named_property(obj_props, obj_embedding, "points", []) or [],
                path="native_scene.object.points",
            )
            face_color_value = _embedded_named_property(
                obj_props, obj_embedding, "face_color",
                _embedded_named_property(obj_props, obj_embedding, "color", [0.96, 0.22, 0.16, 1.0])
            )
            for object_index, point_set in enumerate(point_sets):
                if len(point_set) < 4:
                    raise ValueError("native_scene.object.points must contain at least 4 [x, y, z] points")
                face_color = _slice_axis_i_property(face_color_value, object_index, path="native_scene.object.face_color") if point_mode == "hi" else face_color_value
                mesh_id = f"object_{object_index}"
                object_meshes.append({
                    "id": mesh_id,
                    "kind": "convex_hull",
                    "points": point_set,
                    "face_color": face_color,
                    "edge_color": _embedded_named_property(obj_props, obj_embedding, "edge_color", [0.12, 0.16, 0.22, 1.0]),
                    "edge_width": _embedded_named_property(obj_props, obj_embedding, "edge_width", 0.03),
                    "edge_caps": _embedded_named_property(obj_props, obj_embedding, "edge_caps", True),
                    "edge_lift": _embedded_named_property(obj_props, obj_embedding, "edge_lift", 0.003),
                    "show_edges": _embedded_named_property(obj_props, obj_embedding, "show_edges", True),
                    "vertex_color": _embedded_named_property(
                        obj_props,
                        obj_embedding,
                        "vertex_color",
                        face_color,
                    ),
                    "vertex_size": _embedded_named_property(obj_props, obj_embedding, "vertex_size", 0.06),
                    "vertex_lift": _embedded_named_property(obj_props, obj_embedding, "vertex_lift", 0.006),
                    "show_vertices": _embedded_named_property(obj_props, obj_embedding, "show_vertices", True),
                })
                mesh_props = {
                    key: (_slice_axis_i_property(value, object_index, path=f"native_scene.object.{key}") if point_mode == "hi" and key != obj_embedding.get("points", "points") else value)
                    for key, value in obj_props.items()
                }
                point_prop_name = str(obj_embedding.get("points", "points"))
                mesh_props[point_prop_name] = point_set
                object_mesh_entities.append(
                    _scene_ir_mesh_entity(
                        mesh_id=mesh_id,
                        kind="convex_hull",
                        properties=mesh_props,
                        embedding=obj_embedding,
                    )
                )
        elif object_kind == "simplices":
            point_matrix = _require_number_matrix_value(
                _embedded_named_property(obj_props, obj_embedding, "points", []) or [],
                path="native_scene.object.points",
                row_length=3,
            )
            simplices_spec = (
                _delaunay_simplices(point_matrix, path="native_scene.object.points")
                if embedded_points_axis == "d"
                else _normalize_add_simplices_spec(embedded_simplices, path="native_scene.object.add_simplices")
            )
            object_meshes.append({
                "id": "object_0",
                "kind": "simplices",
                "points": point_matrix,
                "add_simplices": simplices_spec,
                "face_color": _embedded_named_property(
                    obj_props, obj_embedding, "face_color",
                    _embedded_named_property(obj_props, obj_embedding, "color", [0.96, 0.22, 0.16, 1.0])
                ),
                "edge_color": _embedded_named_property(obj_props, obj_embedding, "edge_color", [0.12, 0.16, 0.22, 1.0]),
                "edge_width": _embedded_named_property(obj_props, obj_embedding, "edge_width", 0.03),
                "edge_caps": _embedded_named_property(obj_props, obj_embedding, "edge_caps", True),
                "edge_lift": _embedded_named_property(obj_props, obj_embedding, "edge_lift", 0.003),
                "show_edges": _embedded_named_property(obj_props, obj_embedding, "show_edges", True),
                "vertex_color": _embedded_named_property(
                    obj_props,
                    obj_embedding,
                    "vertex_color",
                    _embedded_named_property(
                        obj_props,
                        obj_embedding,
                        "face_color",
                        _embedded_named_property(obj_props, obj_embedding, "color", [0.96, 0.22, 0.16, 1.0]),
                    ),
                ),
                "vertex_size": _embedded_named_property(obj_props, obj_embedding, "vertex_size", 0.06),
                "vertex_lift": _embedded_named_property(obj_props, obj_embedding, "vertex_lift", 0.006),
                "show_vertices": _embedded_named_property(obj_props, obj_embedding, "show_vertices", True),
            })
            simplices_prop_name = str(obj_embedding.get("add_simplices", "add_simplices"))
            simplices_props = dict(obj_props)
            simplices_props[simplices_prop_name] = simplices_spec
            point_prop_name = str(obj_embedding.get("points", "points"))
            simplices_props[point_prop_name] = point_matrix
            object_mesh_entities.append(
                _scene_ir_mesh_entity(
                    mesh_id="object_0",
                    kind="simplices",
                    properties=simplices_props,
                    embedding=obj_embedding,
                )
            )
        else:
            object_spec = {
                "center": _embedded_named_property(obj_props, obj_embedding, "center", [0.0, 0.0, 1.2]),
                "radius": _embedded_named_property(obj_props, obj_embedding, "radius", 1.1),
                "count": _embedded_named_property(obj_props, obj_embedding, "count", 100),
                "seed": _embedded_named_property(obj_props, obj_embedding, "seed", 7),
                "stretch": _embedded_named_property(obj_props, obj_embedding, "stretch", [1.0, 0.84, 1.28]),
                "jitter": _embedded_named_property(obj_props, obj_embedding, "jitter", 0.28),
                "face_color": _embedded_named_property(
                    obj_props, obj_embedding, "face_color",
                    _embedded_named_property(obj_props, obj_embedding, "color", [0.96, 0.22, 0.16, 1.0])
                ),
            }
            object_meshes.append({
                "id": "object_0",
                "kind": "random_hull",
                **object_spec,
            })
            object_mesh_entities.append(
                _scene_ir_mesh_entity(
                    mesh_id="object_0",
                    kind="random_hull",
                    properties=obj_props,
                    embedding=obj_embedding,
                )
            )
        object_mesh = object_meshes[0]
        object_mesh_entity = object_mesh_entities[0]
    else:
        cube_specs_raw: list[dict[str, Any]]
        if has_cubes:
            cubes_axis = axis_tagged_idx(cubes_value) if is_axis_tagged_value(cubes_value) else None
            cubes_data = axis_tagged_data(cubes_value) if is_axis_tagged_value(cubes_value) else cubes_value
            if cubes_axis not in {None, "i"}:
                raise ValueError("native_scene.cubes axis tag must be i")
            if not isinstance(cubes_data, list):
                raise ValueError("native_scene.cubes must be a list of cube structs")
            cube_specs_raw = []
            for cube_index, cube_item in enumerate(cubes_data):
                if not isinstance(cube_item, dict):
                    raise ValueError(f"native_scene.cubes[{cube_index}] must be a struct")
                cube_specs_raw.append(cube_item)
        elif has_cube:
            cube_specs_raw = [cube]
        else:
            cube_specs_raw = []
        cube_specs: list[dict[str, Any]] = []
        object_meshes = []
        object_mesh_entities = []
        for cube_index, cube_decl in enumerate(cube_specs_raw):
            cube_path = "native_scene.cube" if len(cube_specs_raw) == 1 else f"native_scene.cubes[{cube_index}]"
            cube_props, cube_embedding = _normalize_native_named_parameters(
                cube_decl,
                default_embedding={
                    "id": "id",
                    "center": "center",
                    "size": "size",
                    "rotation": "rotation",
                    "transform": "transform",
                    "face_color": "face_color",
                    "color": "color",
                    "texture": "texture",
                    "surface_system": "surface_system",
                },
                path=cube_path,
            )
            cube_tracks = _normalize_native_named_tracks(
                cube_decl,
                cube_props,
                cube_embedding,
                legacy_canonical_names=("center", "size", "rotation", "transform", "face_color", "color", "texture", "surface_system", "no_backface_specular"),
                path=cube_path,
            )
            cube_spec = {
                "center": _embedded_named_property(cube_props, cube_embedding, "center", [0.0, 0.0, 1.1]),
                "size": _embedded_named_property(cube_props, cube_embedding, "size", 1.6),
                "rotation": _embedded_named_property(cube_props, cube_embedding, "rotation", [0.0, 0.0, 0.0]),
                "transform": _embedded_named_property(cube_props, cube_embedding, "transform", None),
                "face_color": _embedded_named_property(
                    cube_props, cube_embedding, "face_color",
                    _embedded_named_property(cube_props, cube_embedding, "color", [0.96, 0.22, 0.16, 1.0])
                ),
                "texture": _embedded_named_property(cube_props, cube_embedding, "texture", None),
                "surface_system": _embedded_named_property(cube_props, cube_embedding, "surface_system", None),
                "no_backface_specular": _embedded_named_property(cube_props, cube_embedding, "no_backface_specular", False),
            }
            mesh_id = f"cube_{cube_index}"
            cube_specs.append(cube_spec)
            object_meshes.append({
                "id": mesh_id,
                "kind": "cube",
                "center": cube_spec["center"],
                "size": cube_spec["size"],
                "rotation": cube_spec["rotation"],
                "transform": cube_spec["transform"],
                "face_color": cube_spec["face_color"],
                "texture": cube_spec["texture"],
                "surface_system": cube_spec["surface_system"],
            })
            object_mesh_entities.append(
                _scene_ir_mesh_entity(
                    mesh_id=mesh_id,
                    kind="cube",
                    properties=cube_props,
                    embedding=cube_embedding,
                    tracks=cube_tracks,
                )
            )
        cube_spec = cube_specs[0] if len(cube_specs) == 1 else None
        object_mesh = object_meshes[0] if object_meshes else None
        object_mesh_entity = object_mesh_entities[0] if object_mesh_entities else None
    if surfaces_value is not None:
        surface_axis = axis_tagged_idx(surfaces_value) if is_axis_tagged_value(surfaces_value) else None
        surface_data = axis_tagged_data(surfaces_value) if is_axis_tagged_value(surfaces_value) else surfaces_value
        if surface_axis not in {None, "i"}:
            raise ValueError("native_scene.surfaces axis tag must be i")
        if not isinstance(surface_data, list):
            raise ValueError("native_scene.surfaces must be a list of surface structs")
        for quad_index, quad_decl in enumerate(surface_data):
            if not isinstance(quad_decl, dict):
                raise ValueError(f"native_scene.surfaces[{quad_index}] must be a struct")
            quad_path = f"native_scene.surfaces[{quad_index}]"
            quad_props, quad_embedding = _normalize_native_named_parameters(
                quad_decl,
                default_embedding={
                    "center": "center",
                    "size": "size",
                    "rotation": "rotation",
                    "transform": "transform",
                    "color": "color",
                    "texture": "texture",
                    "surface_system": "surface_system",
                    "visible": "visible",
                },
                path=quad_path,
            )
            quad_tracks = _normalize_native_named_tracks(
                quad_decl,
                quad_props,
                quad_embedding,
                legacy_canonical_names=("center", "size", "rotation", "transform", "color", "texture", "surface_system", "visible", "no_backface_specular"),
                path=quad_path,
            )
            mesh_id = str(_embedded_named_property(quad_props, quad_embedding, "id", f"quad_{quad_index}"))
            object_meshes.append({
                "id": mesh_id,
                "kind": "quad",
                "center": _embedded_named_property(quad_props, quad_embedding, "center", [0.0, 0.0, 0.0]),
                "size": _embedded_named_property(quad_props, quad_embedding, "size", [1.0, 1.0]),
                "rotation": _embedded_named_property(quad_props, quad_embedding, "rotation", [0.0, 0.0, 0.0]),
                "transform": _embedded_named_property(quad_props, quad_embedding, "transform", None),
                "color": _embedded_named_property(quad_props, quad_embedding, "color", [0.84, 0.86, 0.90, 1.0]),
                "texture": _embedded_named_property(quad_props, quad_embedding, "texture", None),
                "surface_system": _embedded_named_property(quad_props, quad_embedding, "surface_system", None),
                "visible": _embedded_named_property(quad_props, quad_embedding, "visible", True),
                "no_backface_specular": _embedded_named_property(quad_props, quad_embedding, "no_backface_specular", False),
            })
            object_mesh_entities.append(
                _scene_ir_mesh_entity(
                    mesh_id=mesh_id,
                    kind="quad",
                    properties=quad_props,
                    embedding=quad_embedding,
                    tracks=quad_tracks,
                )
            )
    plane_props, plane_embedding = _normalize_native_named_parameters(
        plane,
        default_embedding={
            "center": "center",
            "size": "size",
            "z": "z",
            "color": "color",
            "visible": "visible",
            "surface_system": "surface_system",
        },
        path="native_scene.plane",
    )
    plane_spec = {
        "center": _embedded_named_property(plane_props, plane_embedding, "center", [0.0, 0.0]),
        "size": _embedded_named_property(plane_props, plane_embedding, "size", 7.0),
        "z": _embedded_named_property(plane_props, plane_embedding, "z", 0.0),
        "color": _embedded_named_property(plane_props, plane_embedding, "color", [0.20, 0.22, 0.26, 1.0]),
        "visible": _embedded_named_property(plane_props, plane_embedding, "visible", True),
        "surface_system": _embedded_named_property(plane_props, plane_embedding, "surface_system", None),
        "no_backface_specular": _embedded_named_property(plane_props, plane_embedding, "no_backface_specular", False),
    }
    lights = _normalize_native_light_set(declared)
    light_entities = _normalize_scene_ir_light_entity_set(declared)
    if len(lights) > 2:
        raise ValueError("native_scene lights supports at most 2 lights for scene_3d")
    frame_spec = {
        "frame_id": _require_string_value(declared, "frame_id"),
        "title": _require_string_value(declared, "title"),
        "rect": tuple(_require_number_list(declared, "rect", length=4)),
        "aspect": _optional_string_value(declared, "aspect", None),
        "visible": _optional_bool_value(declared, "visible", True),
    }
    shadow_spec = {
        "enabled": _optional_bool_value(shadow, "enabled", True),
        "color": _optional_number_list(shadow, "color", [0.0, 0.0, 0.0, 0.30], length=4),
        "lift": _optional_number_value(shadow, "lift", 0.002),
    }
    scene_state = _ir_builder.build_scene_3d_state(
        frame_spec=frame_spec,
        plane_spec=plane_spec,
        plane_props=plane_props,
        plane_embedding=plane_embedding,
        object_meshes=object_meshes,
        object_mesh_entities=object_mesh_entities,
        camera_entity=_normalize_scene_ir_camera_entity(declared),
        lights=lights,
        light_entities=light_entities,
        timing=_optional_ocean_timing_value(declared),
        shadow_spec=shadow_spec,
        show_light_markers=_optional_bool_value(declared, "show_light_markers", False),
        light_marker_size=_optional_number_value(declared, "light_marker_size", 0.18),
        surface_worlds=_optional_struct_value(declared, "surface_worlds"),
        surface_cameras=_optional_struct_value(declared, "surface_cameras"),
    )
    meshes = scene_state["meshes"]
    shadow_receivers = scene_state["shadow_receivers"]
    scene_ir = scene_state["scene_ir"]
    return {
        "kind": "scene_3d",
        "frame_id": frame_spec["frame_id"],
        "title": frame_spec["title"],
        "rect": frame_spec["rect"],
        "aspect": frame_spec["aspect"],
        "visible": frame_spec["visible"],
        "cube": None if obj is not None else cube_spec,
        "cubes": None if obj is not None or len(object_meshes) <= 1 else cube_specs,
        "object": object_mesh,
        "plane": plane_spec,
        "meshes": meshes,
        "camera": scene_ir["camera"],
        "lights": lights,
        "timing": scene_ir["timing"],
        "surface_worlds": scene_ir.get("surface_worlds", {}),
        "surface_cameras": scene_ir.get("surface_cameras", {}),
        "show_light_markers": scene_ir["render_options"]["show_light_markers"],
        "light_marker_size": scene_ir["render_options"]["light_marker_size"],
        "shadow_receivers": shadow_receivers,
        "shadow": shadow_spec,
        "scene_ir": scene_ir,
    }


def _normalize_scene_3d_views_spec(declared: dict[str, Any]) -> dict[str, Any]:
    views_declared = _require_struct_list(declared, "views")
    if not views_declared:
        raise ValueError("native_scene.scene_3d_views requires at least one view")
    shared_declared = {k: v for k, v in declared.items() if k not in {"kind", "views", "frame_id", "title", "rect", "aspect", "camera"}}
    reserved_view_fields = {"frame_id", "title", "rect", "aspect", "camera", "visible"}
    views: list[dict[str, Any]] = []
    seen_frame_ids: set[str] = set()
    for idx, view in enumerate(views_declared):
        frame_id = _require_string_value(view, "frame_id")
        if frame_id in seen_frame_ids:
            raise ValueError(f'native_scene.scene_3d_views view frame_id "{frame_id}" is duplicated')
        seen_frame_ids.add(frame_id)
        view_declared = dict(shared_declared)
        for key, value in view.items():
            if key in reserved_view_fields:
                continue
            view_declared[key] = value
        view_declared["kind"] = "scene_3d"
        view_declared["frame_id"] = frame_id
        view_declared["title"] = _require_string_value(view, "title")
        view_declared["rect"] = list(_require_number_list(view, "rect", length=4))
        view_declared["visible"] = _optional_bool_value(view, "visible", True)
        if "aspect" in view:
            view_declared["aspect"] = _require_string_value(view, "aspect")
        if "camera" not in view:
            raise ValueError(f"native_scene.scene_3d_views view[{idx}] requires camera")
        view_declared["camera"] = _optional_camera_value({"camera": _require_struct_value(view, "camera")})
        views.append(_normalize_scene_3d_spec(view_declared))
    return {
        "kind": "scene_3d_views",
        "views": views,
    }


def _normalize_ocean_wave_spec(declared: dict[str, Any]) -> dict[str, Any]:
    surface = _require_struct_value(declared, "surface")
    styles = _require_struct_value(declared, "styles")
    timing = _optional_ocean_timing_value(declared)
    return {
        "kind": "ocean_wave",
        "frame_id": _require_string_value(declared, "frame_id"),
        "title": _require_string_value(declared, "title"),
        "rect": tuple(_require_number_list(declared, "rect", length=4)),
        "surface": {
            "u_min": _require_number_value(surface, "u_min"),
            "u_max": _require_number_value(surface, "u_max"),
            "u_steps": _require_positive_int_value(surface, "u_steps", minimum=2),
            "v_min": _require_number_value(surface, "v_min"),
            "v_max": _require_number_value(surface, "v_max"),
            "v_steps": _require_positive_int_value(surface, "v_steps", minimum=2),
            "face_subdivisions": _optional_positive_int_value(surface, "face_subdivisions", default=4, minimum=1),
        },
        "styles": {
            "face_color": _require_rgba(styles, "face_color"),
            "edge_color": _require_rgba(styles, "edge_color"),
            "vertex_color": _optional_number_list(styles, "vertex_color", [1.0, 0.45, 0.18, 1.0], length=4),
            "edge_width": _optional_number_value(styles, "edge_width", 1.0),
            "vertex_size": _optional_number_value(styles, "vertex_size", 0.12),
            "show_edges": _optional_bool_value(styles, "show_edges", True),
            "show_vertices": _optional_bool_value(styles, "show_vertices", False),
            "edge_caps": _optional_bool_value(styles, "edge_caps", False),
            "face_light_model": _normalize_native_light_model(
                _optional_string_value(styles, "face_light_model", "blinn_phong")
            ),
        },
        "camera": _optional_ocean_camera_value(declared),
        "light": _optional_ocean_light_value(declared),
        "timing": timing,
        "waves": _require_wave_specs(declared, "waves"),
    }


def _require_frame_scene_spec(scope: dict[str, Any], name: str) -> dict[str, Any]:
    frame = _require_struct_value(scope, name)
    return {
        "frame_id": _require_string_value(frame, "frame_id"),
        "title": _require_string_value(frame, "title"),
        "rect": tuple(_require_number_list(frame, "rect", length=4)),
    }


def _normalize_dimension_mix_spec(declared: dict[str, Any]) -> dict[str, Any]:
    frames = _require_struct_value(declared, "frames")
    cloud = _require_struct_value(declared, "cloud")
    helix = _require_struct_value(declared, "helix")
    planes = _require_struct_value(declared, "planes")
    volume = _require_struct_value(declared, "volume")
    return {
        "kind": "dimension_mix",
        "frames": {
            "points": _require_frame_scene_spec(frames, "points"),
            "lines": _require_frame_scene_spec(frames, "lines"),
            "surface": _require_frame_scene_spec(frames, "surface"),
            "volume": _require_frame_scene_spec(frames, "volume"),
        },
        "cloud": {
            "count_i": _optional_positive_int_value(cloud, "count_i", 320, minimum=2),
            "sigma": _optional_number_value(cloud, "sigma", 0.24),
            "seed": _optional_positive_int_value(cloud, "seed", 7, minimum=0),
            "color": _optional_number_list(cloud, "color", [1.0, 0.55, 0.10, 1.0], length=4),
            "vertex_size": _optional_number_value(cloud, "vertex_size", 0.1),
            "camera": _optional_ocean_camera_value(cloud),
            "light": _optional_ocean_light_value(cloud),
        },
        "helix": {
            "u_steps": _optional_positive_int_value(helix, "u_steps", 60, minimum=2),
            "radius": _optional_number_value(helix, "radius", 0.72),
            "pitch": _optional_number_value(helix, "pitch", 0.065),
            "turn_step": _optional_number_value(helix, "turn_step", 0.30),
            "edge_color_j": _optional_rgba_list(helix, "edge_color_j", [[0.10, 0.86, 0.30, 1.0], [0.10, 0.56, 0.96, 1.0]], expected_length=2),
            "vertex_color_j": _optional_rgba_list(helix, "vertex_color_j", [[0.95, 0.62, 0.18, 1.0], [0.96, 0.34, 0.72, 1.0]], expected_length=2),
            "edge_width": _optional_number_value(helix, "edge_width", 0.04),
            "vertex_size": _optional_number_value(helix, "vertex_size", 0.08),
            "camera": _optional_ocean_camera_value(helix),
            "light": _optional_ocean_light_value(helix),
        },
        "planes": {
            "u_steps": _optional_positive_int_value(planes, "u_steps", 25, minimum=2),
            "v_steps": _optional_positive_int_value(planes, "v_steps", 25, minimum=2),
            "layers": _optional_number_list(planes, "layers", [-1.0, 1.0], length=2),
            "u_scale": _optional_number_value(planes, "u_scale", 0.11),
            "v_scale": _optional_number_value(planes, "v_scale", 0.11),
            "x_offset_per_layer": _optional_number_value(planes, "x_offset_per_layer", 0.28),
            "y_offset_per_layer": _optional_number_value(planes, "y_offset_per_layer", 0.14),
            "z_offset_per_layer": _optional_number_value(planes, "z_offset_per_layer", 0.85),
            "face_color_i": _optional_rgba_list(planes, "face_color_i", [[0.08, 0.78, 0.95, 0.95], [0.22, 0.96, 0.54, 0.95]], expected_length=2),
            "height_amp_i": _optional_number_list(planes, "height_amp_i", [0.16, 0.22], length=2),
            "height_phase_i": _optional_number_list(planes, "height_phase_i", [0.0, 1.35], length=2),
            "camera": _optional_ocean_camera_value(planes),
            "light": _optional_ocean_light_value(planes),
        },
        "volume": {
            "u_steps": _optional_positive_int_value(volume, "u_steps", 20, minimum=2),
            "v_steps": _optional_positive_int_value(volume, "v_steps", 20, minimum=2),
            "w_steps": _optional_positive_int_value(volume, "w_steps", 20, minimum=2),
            "scale": _optional_number_value(volume, "scale", 0.12),
            "warp_x_amp": _optional_number_value(volume, "warp_x_amp", 0.12),
            "warp_x_y_freq": _optional_number_value(volume, "warp_x_y_freq", 1.5),
            "warp_x_z_freq": _optional_number_value(volume, "warp_x_z_freq", 1.1),
            "warp_y_amp": _optional_number_value(volume, "warp_y_amp", 0.10),
            "warp_y_x_freq": _optional_number_value(volume, "warp_y_x_freq", 1.3),
            "warp_y_z_freq": _optional_number_value(volume, "warp_y_z_freq", -1.4),
            "warp_z_amp": _optional_number_value(volume, "warp_z_amp", 0.11),
            "warp_z_x_freq": _optional_number_value(volume, "warp_z_x_freq", 1.2),
            "warp_z_y_freq": _optional_number_value(volume, "warp_z_y_freq", 1.6),
            "face_color": _optional_number_list(volume, "face_color", [0.92, 0.18, 0.88, 0.95], length=4),
            "camera": _optional_ocean_camera_value(volume),
            "light": _optional_ocean_light_value(volume),
        },
    }


def _find_top_level_struct_binding(module: ast.Module, name: str) -> dict[str, Any] | None:
    for stmt in module.statements:
        if isinstance(stmt, ast.Bind) and isinstance(stmt.target, ast.Ident) and stmt.target.name == name:
            value = _eval_native_scene_literal(stmt.value, f"{name}")
            if not isinstance(value, dict):
                raise ValueError(f"{name} must be a struct literal")
            return value
    return None


def _eval_native_scene_literal(expr: Any, path: str) -> Any:
    if isinstance(expr, ast.AxisAlign):
        value = _eval_native_scene_literal(expr.value, f"{path}.value")
        if expr.label is not None:
            axis_key = "i" if expr.label == "_" else expr.label
        else:
            evaluated = [_eval_native_scene_literal(item, f"{path}.axis") for item in (expr.indices or [])]
            if len(evaluated) != 1:
                raise ValueError(f"{path} axis access expects exactly one key")
            raw = evaluated[0]
            if isinstance(raw, bool):
                raise ValueError(f"{path} axis key cannot be bool")
            if isinstance(raw, str):
                axis_key = raw
            elif isinstance(raw, (int, float)):
                axis_key = str(int(raw)) if isinstance(raw, float) and raw == int(raw) else str(raw)
            else:
                raise ValueError(f"{path} axis key must be string or number")
        return axis_tagged_wrap(value, axis_key)
    if isinstance(expr, ast.StructLit):
        return {key: _eval_native_scene_literal(value, f"{path}.{key}") for key, value in expr.fields}
    if isinstance(expr, ast.ListLit):
        return [_eval_native_scene_literal(value, f"{path}[]") for value in expr.elements]
    if isinstance(expr, ast.TupleLit):
        return [_eval_native_scene_literal(value, f"{path}[]") for value in expr.elements]
    if isinstance(expr, ast.StringLit):
        return expr.value
    if isinstance(expr, ast.NumberLit):
        return expr.value
    if isinstance(expr, ast.BoolLit):
        return expr.value
    if isinstance(expr, ast.NullLit):
        return None
    if isinstance(expr, ast.UnaryOp):
        operand = _eval_native_scene_literal(expr.operand, f"{path}.operand")
        if not isinstance(operand, (int, float)) or isinstance(operand, bool):
            raise ValueError(f"{path} unary operand must be numeric")
        if expr.op == "MINUS":
            return -float(operand)
        if expr.op == "PLUS":
            return float(operand)
    raise ValueError(f"{path} must be a literal value; got {type(expr).__name__}")


def _require_field(scope: dict[str, Any], name: str) -> Any:
    if name not in scope:
        raise ValueError(f"native_scene missing field {name!r}")
    return scope[name]


def _require_struct_value(scope: dict[str, Any], name: str) -> dict[str, Any]:
    value = _require_field(scope, name)
    if not isinstance(value, dict):
        raise ValueError(f"native_scene.{name} must be a struct")
    return value


def _optional_struct_value(scope: dict[str, Any], name: str) -> dict[str, Any]:
    value = scope.get(name)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"native_scene.{name} must be a struct")
    return value


def _require_string_value(scope: dict[str, Any], name: str) -> str:
    value = _require_field(scope, name)
    if not isinstance(value, str):
        raise ValueError(f"native_scene.{name} must be a string")
    return value


def _require_bool_value(scope: dict[str, Any], name: str) -> bool:
    value = _require_field(scope, name)
    if not isinstance(value, bool):
        raise ValueError(f"native_scene.{name} must be a bool")
    return value


def _require_number_value(scope: dict[str, Any], name: str) -> float:
    value = _require_field(scope, name)
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"native_scene.{name} must be a number")
    return float(value)


def _require_number_list(scope: dict[str, Any], name: str, *, length: int | None = None) -> list[float]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[float] = []
    for item in value:
        if not isinstance(item, (int, float)) or isinstance(item, bool):
            raise ValueError(f"native_scene.{name} must contain only numbers")
        out.append(float(item))
    if length is not None and len(out) != length:
        raise ValueError(f"native_scene.{name} must contain exactly {length} numbers")
    return out


def _require_int_list(scope: dict[str, Any], name: str) -> list[int]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[int] = []
    for item in value:
        if not isinstance(item, (int, float)) or isinstance(item, bool) or int(item) != float(item):
            raise ValueError(f"native_scene.{name} must contain only integers")
        out.append(int(item))
    return out


def _require_nested_int_list(scope: dict[str, Any], name: str) -> list[list[int]]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[list[int]] = []
    for row in value:
        if not isinstance(row, list):
            raise ValueError(f"native_scene.{name} must contain integer lists")
        inner: list[int] = []
        for item in row:
            if not isinstance(item, (int, float)) or isinstance(item, bool) or int(item) != float(item):
                raise ValueError(f"native_scene.{name} must contain only integers")
            inner.append(int(item))
        out.append(inner)
    return out


def _require_point_list(scope: dict[str, Any], name: str) -> list[list[float]]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[list[float]] = []
    for point in value:
        if not isinstance(point, list) or len(point) != 2:
            raise ValueError(f"native_scene.{name} must contain [x, y] points")
        out.append([float(point[0]), float(point[1])])
    return out


def _require_index_pairs(scope: dict[str, Any], name: str) -> list[list[int]]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[list[int]] = []
    for pair in value:
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError(f"native_scene.{name} must contain [a, b] pairs")
        out.append([int(pair[0]), int(pair[1])])
    return out


def _require_rgba(scope: dict[str, Any], name: str) -> list[float]:
    return _require_number_list(scope, name, length=4)


def _require_positive_int_value(scope: dict[str, Any], name: str, *, minimum: int = 0) -> int:
    value = _require_number_value(scope, name)
    if int(value) != value:
        raise ValueError(f"native_scene.{name} must be an integer")
    out = int(value)
    if out < minimum:
        raise ValueError(f"native_scene.{name} must be >= {minimum}")
    return out


def _optional_number_value(scope: dict[str, Any], name: str, default: float) -> float:
    if name not in scope:
        return default
    return _require_number_value(scope, name)


def _optional_positive_int_value(scope: dict[str, Any], name: str, default: int, *, minimum: int = 0) -> int:
    if name not in scope:
        return default
    return _require_positive_int_value(scope, name, minimum=minimum)


def _optional_string_value(scope: dict[str, Any], name: str, default: str) -> str:
    if name not in scope:
        return default
    return _require_string_value(scope, name)


def _optional_bool_value(scope: dict[str, Any], name: str, default: bool) -> bool:
    if name not in scope:
        return default
    return _require_bool_value(scope, name)


def _normalize_native_named_parameters(
    scope: dict[str, Any],
    *,
    default_embedding: dict[str, str],
    reserved: set[str] | None = None,
    path: str,
) -> tuple[dict[str, Any], dict[str, str]]:
    return _entities.normalize_native_named_parameters(
        scope,
        default_embedding=default_embedding,
        reserved=reserved,
        path=path,
    )


def _normalize_native_named_tracks(
    scope: dict[str, Any],
    props: dict[str, Any],
    embedding: dict[str, str],
    *,
    legacy_canonical_names: tuple[str, ...],
    path: str,
) -> dict[str, Any]:
    return _entities.normalize_native_named_tracks(
        scope,
        props,
        embedding,
        legacy_canonical_names=legacy_canonical_names,
        path=path,
    )


def _embedded_named_property(
    props: dict[str, Any],
    embedding: dict[str, str],
    canonical_name: str,
    default: Any,
) -> Any:
    return _entities.embedded_named_property(props, embedding, canonical_name, default)


def _native_json_safe_value(value: Any) -> Any:
    return _entities.native_json_safe_value(value)


def _slice_axis_i_property(value: Any, index: int, *, path: str) -> Any:
    return _topology.slice_axis_i_property(value, index, path=path)


def _require_hull_point_sets(value: Any, *, path: str) -> tuple[list[list[list[float]]], str]:
    return _topology.require_hull_point_sets(value, path=path)


def _delaunay_faces_2d(points: list[list[float]], *, path: str) -> list[list[int]]:
    return _topology._delaunay_faces_2d(points, path=path)


def _volumes_to_edge_pairs(volumes: list[list[int]]) -> list[list[int]]:
    return _topology._volumes_to_edge_pairs(volumes)


def _delaunay_simplices(points: list[list[float]], *, path: str) -> dict[str, list[list[int]]]:
    return _topology.delaunay_simplices(points, path=path)


def _faces_to_edge_pairs(faces: list[list[int]]) -> list[list[int]]:
    return _topology.faces_to_edge_pairs(faces)


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


def _optional_number_list(
    scope: dict[str, Any], name: str, default: list[float], *, length: int | None = None
) -> list[float]:
    if name not in scope:
        return list(default)
    return _require_number_list(scope, name, length=length)


def _optional_number_matrix(
    scope: dict[str, Any], name: str, *, row_length: int
) -> list[list[float]] | None:
    if name not in scope:
        return None
    value = _require_field(scope, name)
    return _require_number_matrix_value(value, path=f"native_scene.{name}", row_length=row_length)


def _require_number_matrix_value(value: Any, *, path: str, row_length: int) -> list[list[float]]:
    value = axis_tagged_data(value)
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a list")
    out: list[list[float]] = []
    for index, row in enumerate(value):
        if not isinstance(row, list):
            raise ValueError(f"{path}[{index}] must be a list")
        out.append(_require_number_list({"row": row}, "row", length=row_length))
    return out


def _require_index_matrix_value(
    value: Any,
    *,
    path: str,
    row_length: int,
    minimum_rows: int = 0,
) -> list[list[int]]:
    value = axis_tagged_data(value)
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a list")
    out: list[list[int]] = []
    for index, row in enumerate(value):
        if not isinstance(row, list):
            raise ValueError(f"{path}[{index}] must be a list")
        if len(row) != row_length:
            raise ValueError(f"{path}[{index}] must contain exactly {row_length} indices")
        out.append([int(v) for v in row])
    if len(out) < minimum_rows:
        raise ValueError(f"{path} must contain at least {minimum_rows} rows")
    return out


def _optional_number_track(scope: dict[str, Any], name: str) -> list[float] | None:
    if name not in scope:
        return None
    return _require_number_list(scope, name)


def _optional_rgba_list(
    scope: dict[str, Any], name: str, default: list[list[float]], *, expected_length: int | None = None
) -> list[list[float]]:
    if name not in scope:
        return [list(row) for row in default]
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[list[float]] = []
    for index, row in enumerate(value):
        if not isinstance(row, list):
            raise ValueError(f"native_scene.{name}[{index}] must be a color list")
        out.append(_require_number_list({name: row}, name, length=4))
    if expected_length is not None and len(out) != expected_length:
        raise ValueError(f"native_scene.{name} must contain exactly {expected_length} colors")
    return out


def _optional_struct_value(scope: dict[str, Any], name: str) -> dict[str, Any] | None:
    if name not in scope:
        return None
    return _require_struct_value(scope, name)


def _require_struct_list(scope: dict[str, Any], name: str) -> list[dict[str, Any]]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError(f"native_scene.{name} must contain struct values")
        out.append(item)
    return out


def _require_struct_matrix(scope: dict[str, Any], name: str) -> list[list[dict[str, Any]]]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[list[dict[str, Any]]] = []
    for row_index, row in enumerate(value):
        if not isinstance(row, list):
            raise ValueError(f"native_scene.{name}[{row_index}] must be a list")
        inner: list[dict[str, Any]] = []
        for col_index, item in enumerate(row):
            if not isinstance(item, dict):
                raise ValueError(f"native_scene.{name}[{row_index}][{col_index}] must be a struct")
            inner.append(dict(item))
        out.append(inner)
    return out


def _optional_camera_value(scope: dict[str, Any]) -> dict[str, Any]:
    camera = _optional_struct_value(scope, "camera")
    if camera is None:
        return {
            "pos": [3.2, 2.4, 4.0],
            "target": [0.0, 0.0, 0.0],
            "fov": 42.0,
            "up": [0.0, 1.0, 0.0],
        }
    result = {
        "pos": _optional_number_list(camera, "pos", [3.2, 2.4, 4.0], length=3),
        "target": _optional_number_list(camera, "target", [0.0, 0.0, 0.0], length=3),
        "fov": _optional_number_value(camera, "fov", 42.0),
        "up": _optional_number_list(camera, "up", [0.0, 1.0, 0.0], length=3),
    }
    if "aperture_mirror_mesh_id" in camera:
        result["aperture_mirror_mesh_id"] = _require_string_value(camera, "aperture_mirror_mesh_id")
    if "fit_to_mesh_id" in camera:
        result["aperture_mirror_mesh_id"] = _require_string_value(camera, "fit_to_mesh_id")
    if "look_only_controls" in camera:
        result["look_only_controls"] = _require_bool_value(camera, "look_only_controls")
    if "controls_mode" in camera:
        controls_mode = _require_string_value(camera, "controls_mode")
        if controls_mode not in {"look_only", "free"}:
            raise ValueError("native_scene.camera.controls_mode must be look_only or free")
        result["controls_mode"] = controls_mode
        if controls_mode == "look_only":
            result["look_only_controls"] = True
    if "mirror_of" in camera:
        mirror_of = _require_struct_value(camera, "mirror_of")
        if "frame_id" not in mirror_of or "mesh_id" not in mirror_of:
            raise ValueError("native_scene.camera.mirror_of requires frame_id and mesh_id")
        result["flip_x"] = _optional_bool_value(camera, "flip_x", True)
        result["aperture_mirror_mesh_id"] = _require_string_value(mirror_of, "mesh_id")
        result["reflect_of_frame_id"] = _require_string_value(mirror_of, "frame_id")
        result["reflect_mirror_mesh_id"] = _require_string_value(mirror_of, "mesh_id")
        result["reflect_eye_only"] = _optional_bool_value(mirror_of, "reflect_eye_only", True)
        result["lock_aperture_camera"] = _optional_bool_value(mirror_of, "lock_aperture_camera", True)
        result["controls_enabled"] = _optional_bool_value(mirror_of, "controls_enabled", False)
    if "min_distance" in camera:
        result["min_distance"] = _optional_number_value(camera, "min_distance", 0.0)
    return result


def _optional_light_value(scope: dict[str, Any]) -> dict[str, Any]:
    light = _optional_struct_value(scope, "light")
    if light is None:
        return {
            "pos": [4.0, 5.0, 6.0],
            "target": [0.0, 0.0, 0.0],
            "orbit": False,
            "orbit_radius": 4.5,
            "height": 3.2,
            "theta": 0.0,
            "angular_velocity": 0.0,
            "kind": "point",
            "intensity": 24.0,
            "inner_cone_deg": 14.0,
            "outer_cone_deg": 22.0,
            "range": 0.0,
            "model": "blinn_phong",
            "color": "white",
        }
    color = light.get("color", "white")
    if not isinstance(color, str) and not isinstance(color, list):
        raise ValueError("native_scene.light.color must be a string or rgba list")
    if isinstance(color, list):
        color = _require_number_list(light, "color", length=4)
    return {
        "pos": _optional_number_list(light, "pos", [4.0, 5.0, 6.0], length=3),
        "target": _optional_number_list(light, "target", [0.0, 0.0, 0.0], length=3),
        "orbit": _optional_bool_value(light, "orbit", False),
        "orbit_radius": _optional_number_value(light, "orbit_radius", 4.5),
        "height": _optional_number_value(light, "height", 3.2),
        "theta": _optional_number_value(light, "theta", 0.0),
        "angular_velocity": _optional_number_value(light, "angular_velocity", 0.0),
        "kind": _normalize_native_light_kind(_optional_string_value(light, "kind", "point")),
        "direction": _optional_number_list(light, "direction", [0.0, 0.0, -1.0], length=3)
        if "direction" in light
        else (_optional_number_list(light, "dir", [0.0, 0.0, -1.0], length=3) if "dir" in light else None),
        "intensity": _optional_number_value(light, "intensity", _optional_number_value(light, "power", 24.0)),
        "inner_cone_deg": _optional_number_value(light, "inner_cone_deg", 14.0),
        "outer_cone_deg": _optional_number_value(light, "outer_cone_deg", 22.0),
        "range": _optional_number_value(light, "range", 0.0),
        "model": _normalize_native_light_model(_optional_string_value(light, "model", "blinn_phong")),
        "color": color,
    }


def _optional_ocean_camera_value(scope: dict[str, Any]) -> dict[str, Any]:
    camera = _optional_struct_value(scope, "camera")
    if camera is None:
        return {
            "target": [0.0, 0.0, 0.0],
            "radius": 9.6,
            "height": 3.2,
            "theta": 0.1,
            "turns_per_cycle": 1.0,
            "fov": 42.0,
            "up": [0.0, 0.0, 1.0],
        }
    if "pos" in camera:
        result = {
            "pos": _optional_number_list(camera, "pos", [3.2, 2.4, 4.0], length=3),
            "target": _optional_number_list(camera, "target", [0.0, 0.0, 0.0], length=3),
            "fov": _optional_number_value(camera, "fov", 42.0),
            "up": _optional_number_list(camera, "up", [0.0, 0.0, 1.0], length=3),
        }
        if "min_distance" in camera:
            result["min_distance"] = _optional_number_value(camera, "min_distance", 0.0)
        return result
    return {
        "target": _optional_number_list(camera, "target", [0.0, 0.0, 0.0], length=3),
        "radius": _optional_number_value(camera, "radius", 9.6),
        "height": _optional_number_value(camera, "height", 3.2),
        "theta": _optional_number_value(camera, "theta", 0.1),
        "turns_per_cycle": _optional_number_value(camera, "turns_per_cycle", 1.0),
        "fov": _optional_number_value(camera, "fov", 42.0),
        "up": _optional_number_list(camera, "up", [0.0, 0.0, 1.0], length=3),
    }


def _optional_ocean_light_value(scope: dict[str, Any]) -> dict[str, Any]:
    light = _optional_struct_value(scope, "light")
    return _normalize_ocean_light_spec(light)


def _normalize_scene_ir_camera_entity(scope: dict[str, Any]) -> dict[str, Any]:
    return _ir_entities.normalize_scene_ir_camera_entity(scope)


def _normalize_scene_ir_light_entity(light: dict[str, Any]) -> dict[str, Any]:
    return _ir_entities.normalize_scene_ir_light_entity(light)


def _normalize_scene_ir_light_entity_set(scope: dict[str, Any]) -> list[dict[str, Any]]:
    return _ir_entities.normalize_scene_ir_light_entity_set(scope)


def _normalize_native_light_set(scope: dict[str, Any]) -> list[dict[str, Any]]:
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
            if not isinstance(lights_data, list):
                raise ValueError("native_scene.lights -> i must wrap a list of light structs")
            lights = [_normalize_ocean_light_spec(light) for light in lights_data]
        elif lights_axis == "ij":
            if not isinstance(lights_data, list):
                raise ValueError("native_scene.lights -> ij must wrap a list of light rows")
            lights = [
                _normalize_ocean_light_spec(light)
                for row in lights_data
                for light in row
            ]
        else:
            raise ValueError("native_scene.lights axis tag must be i or ij")
    elif has_lights:
        if not isinstance(lights_data, list):
            raise ValueError("native_scene.lights must be a list of light structs")
        lights = [_normalize_ocean_light_spec(light) for light in lights_data]
    else:
        lights = [_normalize_ocean_light_spec(light_value if isinstance(light_value, dict) else _optional_struct_value(scope, "light"))]
    if len(lights) > 64:
        raise ValueError("native_scene lights supports at most 64 lights in compiler IR")
    for index, light in enumerate(lights):
        light["id"] = str(light.get("id") or f"light_{index}")
    return lights


def _normalize_native_light_kind(kind: str) -> str:
    normalized = str(kind).lower().strip()
    if normalized == "spotlight":
        normalized = "spot"
    if normalized not in {"point", "spot", "projected"}:
        raise ValueError(f"native_scene light kind {kind!r} unknown; use 'point', 'spot', or 'projected'")
    return normalized


def _normalize_ocean_light_spec(light: dict[str, Any] | None) -> dict[str, Any]:
    if light is None:
        return {
            "target": [0.0, 0.0, 0.0],
            "radius": 7.1,
            "height": 4.6,
            "theta": 0.45,
            "turns_per_cycle": 2.0,
            "angular_velocity": (2.0 * 2.0 * 3.141592653589793) / 12.0,
            "kind": "point",
            "intensity": 24.0,
            "direction": None,
            "inner_cone_deg": 14.0,
            "outer_cone_deg": 22.0,
            "range": 0.0,
            "model": "blinn_phong",
            "color": [1.0, 0.93, 0.78, 1.0],
            "casts_shadow": True,
            "source_radius": 0.0,
            "spread": 1.0,
            "aperture_face_id": None,
            "aperture_mesh_id": None,
            "reflect_of_light_id": None,
            "reflect_mirror_mesh_id": None,
            "clip_epsilon": 1e-3,
        }
    if "pos" in light:
        result = {
            "pos": _optional_number_list(light, "pos", [4.0, 5.0, 6.0], length=3),
            "pos_t": _optional_number_matrix(light, "pos_t", row_length=3),
            "target": _optional_number_list(light, "target", [0.0, 0.0, 0.0], length=3),
            "target_t": _optional_number_matrix(light, "target_t", row_length=3),
            "motion": _optional_string_value(light, "motion", "fixed"),
            "kind": _normalize_native_light_kind(_optional_string_value(light, "kind", "point")),
            "direction": _optional_number_list(light, "direction", [0.0, 0.0, -1.0], length=3)
            if "direction" in light
            else (_optional_number_list(light, "dir", [0.0, 0.0, -1.0], length=3) if "dir" in light else None),
            "direction_t": _optional_number_matrix(light, "direction_t", row_length=3),
            "intensity": _optional_number_value(light, "intensity", 24.0),
            "intensity_t": _optional_number_track(light, "intensity_t"),
            "power": _optional_number_value(light, "power", 0.0),
            "power_t": _optional_number_track(light, "power_t"),
            "inner_cone_deg": _optional_number_value(light, "inner_cone_deg", 14.0),
            "inner_cone_deg_t": _optional_number_track(light, "inner_cone_deg_t"),
            "outer_cone_deg": _optional_number_value(light, "outer_cone_deg", 22.0),
            "outer_cone_deg_t": _optional_number_track(light, "outer_cone_deg_t"),
            "range": _optional_number_value(light, "range", 0.0),
            "range_t": _optional_number_track(light, "range_t"),
            "model": _normalize_native_light_model(_optional_string_value(light, "model", "blinn_phong")),
            "color": _optional_number_list(light, "color", [1.0, 0.93, 0.78, 1.0], length=4),
            "color_t": _optional_rgba_list(light, "color_t", []),
            "source_radius": _optional_number_value(light, "source_radius", 0.0),
            "source_radius_t": _optional_number_track(light, "source_radius_t"),
            "spread": _optional_number_value(light, "spread", 1.0),
            "spread_t": _optional_number_track(light, "spread_t"),
            "aperture_face_id": _optional_string_value(light, "aperture_face_id", None),
            "aperture_mesh_id": _optional_string_value(light, "aperture_mesh_id", None),
            "reflect_of_light_id": _optional_string_value(light, "reflect_of_light_id", None),
            "reflect_mirror_mesh_id": _optional_string_value(light, "reflect_mirror_mesh_id", None),
            "clip_epsilon": _optional_number_value(light, "clip_epsilon", 1e-3),
            "clip_epsilon_t": _optional_number_track(light, "clip_epsilon_t"),
        }
    else:
        turns_per_cycle = _optional_number_value(light, "turns_per_cycle", 2.0)
        result = {
            "target": _optional_number_list(light, "target", [0.0, 0.0, 0.0], length=3),
            "pos_t": _optional_number_matrix(light, "pos_t", row_length=3),
            "target_t": _optional_number_matrix(light, "target_t", row_length=3),
            "motion": _optional_string_value(light, "motion", "orbit"),
            "radius": _optional_number_value(light, "radius", 7.1),
            "height": _optional_number_value(light, "height", 4.6),
            "theta": _optional_number_value(light, "theta", 0.45),
            "theta_amplitude": _optional_number_value(light, "theta_amplitude", 0.0),
            "turns_per_cycle": turns_per_cycle,
            "angular_velocity": _optional_number_value(
                light,
                "angular_velocity",
                (turns_per_cycle * 2.0 * 3.141592653589793) / 12.0,
            ),
            "kind": _normalize_native_light_kind(_optional_string_value(light, "kind", "point")),
            "direction": _optional_number_list(light, "direction", [0.0, 0.0, -1.0], length=3)
            if "direction" in light
            else (_optional_number_list(light, "dir", [0.0, 0.0, -1.0], length=3) if "dir" in light else None),
            "direction_t": _optional_number_matrix(light, "direction_t", row_length=3),
            "intensity": _optional_number_value(light, "intensity", 24.0),
            "intensity_t": _optional_number_track(light, "intensity_t"),
            "power": _optional_number_value(light, "power", 0.0),
            "power_t": _optional_number_track(light, "power_t"),
            "inner_cone_deg": _optional_number_value(light, "inner_cone_deg", 14.0),
            "inner_cone_deg_t": _optional_number_track(light, "inner_cone_deg_t"),
            "outer_cone_deg": _optional_number_value(light, "outer_cone_deg", 22.0),
            "outer_cone_deg_t": _optional_number_track(light, "outer_cone_deg_t"),
            "range": _optional_number_value(light, "range", 0.0),
            "range_t": _optional_number_track(light, "range_t"),
            "model": _normalize_native_light_model(_optional_string_value(light, "model", "blinn_phong")),
            "color": _optional_number_list(light, "color", [1.0, 0.93, 0.78, 1.0], length=4),
            "color_t": _optional_rgba_list(light, "color_t", []),
            "source_radius": _optional_number_value(light, "source_radius", 0.0),
            "source_radius_t": _optional_number_track(light, "source_radius_t"),
            "spread": _optional_number_value(light, "spread", 1.0),
            "spread_t": _optional_number_track(light, "spread_t"),
            "aperture_face_id": _optional_string_value(light, "aperture_face_id", None),
            "aperture_mesh_id": _optional_string_value(light, "aperture_mesh_id", None),
            "reflect_of_light_id": _optional_string_value(light, "reflect_of_light_id", None),
            "reflect_mirror_mesh_id": _optional_string_value(light, "reflect_mirror_mesh_id", None),
            "clip_epsilon": _optional_number_value(light, "clip_epsilon", 1e-3),
            "clip_epsilon_t": _optional_number_track(light, "clip_epsilon_t"),
        }
    track_fields = [
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
        "clip_epsilon",
    ]
    tracks: dict[str, Any] = {}
    for field_name in track_fields:
        track_key = f"{field_name}_t"
        track_value = result.pop(track_key, None)
        if track_value:
            tracks[field_name] = track_value
    if tracks:
        result["tracks"] = tracks
    if result.get("aperture_face_id") and not result.get("aperture_mesh_id"):
        result["aperture_mesh_id"] = result["aperture_face_id"]
    if result["motion"] not in {"fixed", "orbit", "oscillate"}:
        raise ValueError("native_scene lights motion must be fixed, orbit, or oscillate")
    result["casts_shadow"] = _optional_bool_value(light, "casts_shadow", True)
    return result


def _optional_ocean_timing_value(scope: dict[str, Any]) -> dict[str, Any]:
    timing = _optional_struct_value(scope, "timing")
    if timing is None:
        return {
            "fps": 30,
            "duration_seconds": 10.0,
            "boundary": "repeat",
        }
    boundary = _optional_string_value(timing, "boundary", "repeat")
    if boundary not in {"repeat", "mirror", "stop", "reset"}:
        raise ValueError("native_scene.timing.boundary must be repeat, mirror, stop, or reset")
    return {
        "fps": _require_positive_int_value(timing, "fps", minimum=1),
        "duration_seconds": _optional_number_value(timing, "duration_seconds", 10.0),
        "boundary": boundary,
    }


def _require_wave_specs(scope: dict[str, Any], name: str) -> list[dict[str, Any]]:
    waves = _require_struct_list(scope, name)
    if not waves:
        raise ValueError("native_scene.waves must contain at least one wave component")
    out: list[dict[str, Any]] = []
    for index, wave in enumerate(waves):
        kind = _optional_string_value(wave, "kind", "linear")
        fn_name = _optional_string_value(wave, "fn", "sin")
        if kind not in {"linear", "radial2"}:
            raise ValueError(f"native_scene.waves[{index}].kind must be linear or radial2")
        if fn_name not in {"sin", "cos"}:
            raise ValueError(f"native_scene.waves[{index}].fn must be sin or cos")
        out.append(
            {
                "kind": kind,
                "fn": fn_name,
                "amplitude": _optional_number_value(wave, "amplitude", 0.0),
                "ux": _optional_number_value(wave, "ux", 0.0),
                "uy": _optional_number_value(wave, "uy", 0.0),
                "radial2": _optional_number_value(wave, "radial2", 0.0),
                "time_freq": _optional_number_value(wave, "time_freq", 0.0),
            }
        )
    return out


def _require_overlay_colors(scope: dict[str, Any], name: str) -> dict[str, list[float]]:
    value = _require_struct_value(scope, name)
    return {
        "selected": _require_rgba(value, "selected"),
        "hover": _require_rgba(value, "hover"),
        "none": _require_rgba(value, "none"),
    }


def _require_overlay_scales(scope: dict[str, Any], name: str) -> dict[str, float]:
    value = _require_struct_value(scope, name)
    return {
        "selected": _require_number_value(value, "selected"),
        "hover": _require_number_value(value, "hover"),
        "none": _require_number_value(value, "none"),
    }


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug or "native-scene-probe"


def _extract_scene_probe_spec(module: ast.Module) -> dict[str, Any] | None:
    if len(module.statements) != 1:
        return None
    stmt = module.statements[0]
    if not isinstance(stmt, ast.ExprStmt):
        return None
    expr = stmt.expr
    if not isinstance(expr, ast.Call):
        return None
    if not _is_scene_probe_callee(expr.func):
        return None

    spec: dict[str, Any] = {
        "run_tag": _DEFAULT_RUN_TAG,
        "prompt": _DEFAULT_PROMPT,
        "input_title": _DEFAULT_INPUT_TITLE,
        "log_title": _DEFAULT_LOG_TITLE,
        "input_rect": _DEFAULT_INPUT_RECT,
        "log_rect": _DEFAULT_LOG_RECT,
        "input_frame_id": "f1",
        "log_frame_id": "f2",
        "log_widget_id": "log",
        "event_probe": None,
    }
    for arg in expr.args:
        if not isinstance(arg, ast.NamedCallArg):
            raise ValueError("native.scene_probe only supports named arguments")
        name = arg.name
        if name in {"run_tag", "prompt", "input_title", "log_title"}:
            spec[name] = _require_string(arg.value, name)
            continue
        if name in {"input_rect", "log_rect"}:
            spec[name] = _require_rect(arg.value, name)
            continue
        raise ValueError(f"native.scene_probe does not support argument {name!r}")
    return spec


def _extract_declarative_ui_scene_probe_spec(module: ast.Module) -> dict[str, Any] | None:
    ui_aliases = {"ui"}
    screen_aliases: set[str] = set()
    widget_aliases: set[str] = set()
    frame_names: set[str] = set()
    bindings: dict[str, Any] = {}
    frames: list[dict[str, Any]] = []

    for stmt in module.statements:
        if isinstance(stmt, ast.SpillImport):
            if isinstance(stmt.path, ast.DotModulePath) and stmt.path.segments == ["ui"] and stmt.alias:
                ui_aliases.add(stmt.alias)
                continue
            return None
        if isinstance(stmt, ast.Bind):
            target = stmt.target
            if not isinstance(target, ast.Ident):
                return None
            name = target.name
            value = stmt.value
            if isinstance(value, ast.DotModulePath) and value.segments == ["ui"]:
                ui_aliases.add(name)
                continue
            if _is_attr_of_ident(value, ui_aliases, "display"):
                screen_aliases.add(name)
                continue
            if _is_attr_of_ident(value, ui_aliases, "widgets"):
                widget_aliases.add(name)
                continue
            if _is_call_of_attr(value, ui_aliases | screen_aliases, "Frame"):
                frame_names.add(name)
                continue
            const_value = _try_eval_const(value, bindings)
            if const_value is not _UNSUPPORTED:
                bindings[name] = const_value
                continue
            continue
        if isinstance(stmt, ast.ExprStmt):
            expr = stmt.expr
            if _is_mode_call(expr, ui_aliases) or _is_render_call(expr, screen_aliases):
                continue
            frame_spec = _try_extract_add_frame(expr, screen_aliases, widget_aliases, bindings, frame_names)
            if frame_spec is not None:
                frames.append(frame_spec)
                continue
            continue

    if len(frames) < 2:
        return None

    input_frame = next((frame for frame in frames if frame["body"] is None), None)
    log_frame = next((frame for frame in frames if frame["body"] is not None), None)
    if input_frame is None or log_frame is None:
        return None

    log_widget = log_frame["body"][0]
    log_text = str(log_widget.get("text", "")).rstrip("\n")
    prompt = _DEFAULT_PROMPT
    run_tag = _DEFAULT_RUN_TAG
    if log_text:
        lines = log_text.splitlines()
        if lines:
            run_tag = lines[0]
        if len(lines) > 1:
            prompt = lines[1]

    event_probe = _extract_event_probe_spec(module, ui_aliases, log_frame["id"])

    return {
        "run_tag": run_tag,
        "prompt": prompt,
        "input_title": _frame_title_for_name(input_frame["name"], _DEFAULT_INPUT_TITLE),
        "log_title": _frame_title_for_name(log_frame["name"], _DEFAULT_LOG_TITLE),
        "input_rect": input_frame["rect"],
        "log_rect": log_frame["rect"],
        "input_frame_id": input_frame["id"],
        "log_frame_id": log_frame["id"],
        "log_widget_id": str(log_widget["id"]),
        "event_probe": event_probe,
    }


def _is_scene_probe_callee(node: Any) -> bool:
    if isinstance(node, ast.Attribute) and node.name == "scene_probe":
        return isinstance(node.value, ast.Ident) and node.value.name in {"native", "ui"}
    return False


def _is_attr_of_ident(node: Any, base_names: set[str], attr_name: str) -> bool:
    return (
        isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Ident)
        and node.value.name in base_names
        and node.name == attr_name
    )


def _is_call_of_attr(node: Any, base_names: set[str], attr_name: str) -> bool:
    return (
        isinstance(node, ast.Call)
        and _is_attr_of_ident(node.func, base_names, attr_name)
    )


def _is_mode_call(node: Any, ui_aliases: set[str]) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Ident)
        and node.func.value.name in ui_aliases
        and node.func.name == "set_mode"
    )


def _is_render_call(node: Any, screen_aliases: set[str]) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Ident)
        and node.func.value.name in screen_aliases
        and node.func.name == "render"
    )


def _try_extract_add_frame(
    node: Any,
    screen_aliases: set[str],
    widget_aliases: set[str],
    bindings: dict[str, Any],
    frame_names: set[str],
) -> dict[str, Any] | None:
    if not (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Ident)
        and node.func.value.name in screen_aliases
        and node.func.name == "add_frame"
    ):
        return None
    positional = [arg for arg in node.args if not isinstance(arg, ast.NamedCallArg)]
    named = [arg for arg in node.args if isinstance(arg, ast.NamedCallArg)]
    if len(positional) < 2:
        raise ValueError("screen.add_frame requires frame and rect")
    frame_arg = positional[0]
    rect_arg = positional[1]
    if not isinstance(frame_arg, ast.Ident) or frame_arg.name not in frame_names:
        raise ValueError("screen.add_frame frame must be a frame binding")
    rect = _require_rect(rect_arg, "screen.add_frame rect")
    body = None
    for arg in named:
        if arg.name == "body":
            body = _require_body_widgets(arg.value, widget_aliases, bindings)
        else:
            raise ValueError(f"screen.add_frame does not support native scene arg {arg.name!r}")
    return {"name": frame_arg.name, "id": frame_arg.name, "rect": rect, "body": body}


def _require_body_widgets(node: Any, widget_aliases: set[str], bindings: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(node, ast.ListLit):
        raise ValueError("frame body must be a widget list")
    widgets: list[dict[str, Any]] = []
    for element in node.elements:
        if not (
            isinstance(element, ast.Call)
            and isinstance(element.func, ast.Attribute)
            and isinstance(element.func.value, ast.Ident)
            and element.func.value.name in widget_aliases
            and element.func.name == "text_area"
        ):
            raise ValueError("native scene body only supports widgets.text_area")
        widgets.append(_extract_text_area_widget(element, bindings))
    return widgets


def _extract_text_area_widget(node: ast.Call, bindings: dict[str, Any]) -> dict[str, Any]:
    positional = [arg for arg in node.args if not isinstance(arg, ast.NamedCallArg)]
    named = [arg for arg in node.args if isinstance(arg, ast.NamedCallArg)]
    if not positional:
        raise ValueError("text_area requires widget id")
    widget_id = _require_string(positional[0], "text_area id")
    payload: dict[str, Any] = {"id": widget_id, "type": "textarea"}
    for arg in named:
        value = _try_eval_const(arg.value, bindings)
        if value is _UNSUPPORTED:
            raise ValueError(f"text_area argument {arg.name!r} must be constant in native scene subset")
        payload[arg.name] = value
    return payload


def _extract_event_probe_spec(module: ast.Module, ui_aliases: set[str], log_frame_id: str) -> dict[str, Any] | None:
    trace_def = next((stmt for stmt in module.statements if isinstance(stmt, ast.FuncDef) and stmt.name == "Trace"), None)
    should_ignore_def = next((stmt for stmt in module.statements if isinstance(stmt, ast.FuncDef) and stmt.name == "ShouldIgnore"), None)
    loop_stmt = next((stmt for stmt in module.statements if isinstance(stmt, ast.MatchStmt) and stmt.loop), None)
    if trace_def is None or should_ignore_def is None or loop_stmt is None:
        return None
    if not _matches_should_ignore_function(should_ignore_def):
        return None
    formatters = _extract_trace_formatters(trace_def, ui_aliases)
    loop_rules = _extract_loop_rules(loop_stmt, ui_aliases)
    if formatters is None or loop_rules is None:
        return None
    return {
        "ignore_frame_id": log_frame_id,
        "formatters": formatters,
        "loop_rules": loop_rules,
    }


def _matches_should_ignore_function(func_def: Any) -> bool:
    body = getattr(func_def, "body", None)
    stmts = getattr(body, "statements", None)
    if not isinstance(stmts, list) or len(stmts) != 1:
        return False
    stmt = stmts[0]
    if not isinstance(stmt, ast.ReturnStmt):
        return False
    expr = stmt.value
    return (
        isinstance(expr, ast.BinOp)
        and expr.op == "EQ"
        and isinstance(expr.left, ast.Attribute)
        and isinstance(expr.left.value, ast.Ident)
        and expr.left.value.name == "e"
        and expr.left.name == "frame_id"
        and isinstance(expr.right, ast.Attribute)
        and isinstance(expr.right.value, ast.Ident)
        and expr.right.value.name == "log_frame"
        and expr.right.name == "id"
    )


def _extract_trace_formatters(func_def: Any, ui_aliases: set[str]) -> dict[str, list[str]] | None:
    body = getattr(func_def, "body", None)
    stmts = getattr(body, "statements", None)
    if not isinstance(stmts, list):
        return None
    match_stmt = next((stmt for stmt in stmts if isinstance(stmt, ast.MatchStmt)), None)
    if match_stmt is None:
        return None
    formatters: dict[str, list[str]] = {}
    for arm in match_stmt.arms:
        key = "default"
        if arm.condition is not None:
            type_name = _extract_ui_type_name(arm.condition, ui_aliases)
            if type_name is None:
                return None
            key = type_name
        fields = _extract_show_struct_fields(arm.body)
        if fields is None:
            return None
        formatters[key] = fields
    return formatters


def _extract_show_struct_fields(node: Any) -> list[str] | None:
    if not isinstance(node, ast.Call):
        return None
    if not isinstance(node.func, ast.Ident) or node.func.name != "Show":
        return None
    if len(node.args) != 1:
        return None
    current = node.args[0]
    while isinstance(current, ast.BinOp) and current.op == "AMPERSAND":
        current = current.right
    if not isinstance(current, ast.StructLit):
        return None
    return [name for name, _ in current.fields]


def _extract_loop_rules(match_stmt: Any, ui_aliases: set[str]) -> list[dict[str, Any]] | None:
    rules: list[dict[str, Any]] = []
    for arm in match_stmt.arms:
        if isinstance(arm.condition, ast.NullLit):
            continue
        match_name = "default"
        if arm.condition is not None:
            if isinstance(arm.condition, ast.PrimTypeRef) and arm.condition.name == "any":
                match_name = "default"
            else:
                type_name = _extract_ui_type_name(arm.condition, ui_aliases)
                if type_name is None:
                    return None
                match_name = type_name
        label = _extract_trace_label(arm.body)
        if label is None:
            return None
        rule: dict[str, Any] = {"match": match_name, "label": label}
        throttle = _extract_throttle(arm.body)
        if throttle is not None:
            rule["throttle"] = throttle
        rules.append(rule)
    return rules


def _extract_trace_label(node: Any) -> str | None:
    call = _find_trace_call(node)
    if call is None or not call.args:
        return None
    label = call.args[0]
    if not isinstance(label, ast.StringLit):
        return None
    return label.value


def _find_trace_call(node: Any) -> Any | None:
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Ident) and node.func.name == "Trace":
        return node
    if isinstance(node, ast.Block):
        for stmt in node.statements:
            result = _find_trace_call(stmt)
            if result is not None:
                return result
    if isinstance(node, ast.ExprStmt):
        return _find_trace_call(node.expr)
    if isinstance(node, ast.ConditionalExpr):
        return _find_trace_call(node.body)
    return None


def _extract_throttle(node: Any) -> dict[str, Any] | None:
    if not isinstance(node, ast.Block):
        return None
    conditional = next(
        (
            stmt.expr
            for stmt in node.statements
            if isinstance(stmt, ast.ExprStmt) and isinstance(stmt.expr, ast.ConditionalExpr)
        ),
        None,
    )
    if conditional is None:
        return None
    cond = conditional.condition
    if not (isinstance(cond, ast.BinOp) and cond.op == "OR"):
        return None
    left = cond.left
    right = cond.right
    if not (
        isinstance(left, ast.BinOp)
        and left.op == "EXACT_EQ"
        and isinstance(left.right, ast.NumberLit)
        and left.right.value == 1
        and isinstance(right, ast.BinOp)
        and right.op == "EQ"
        and isinstance(right.left, ast.BinOp)
        and right.left.op == "PERCENT"
        and isinstance(right.left.left, ast.Ident)
        and isinstance(right.left.right, ast.NumberLit)
        and isinstance(right.right, ast.NumberLit)
        and right.right.value == 0
    ):
        return None
    return {"counter": right.left.left.name, "first": 1, "every": int(right.left.right.value)}


def _extract_ui_type_name(node: Any, ui_aliases: set[str]) -> str | None:
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Ident) and node.value.name in ui_aliases:
        return node.name
    return None


def _frame_title_for_name(name: str, default: str) -> str:
    lowered = name.lower()
    if "input" in lowered:
        return "Input Surface"
    if "log" in lowered:
        return "Native Log"
    return default


def _require_string(node: Any, context: str) -> str:
    if not isinstance(node, ast.StringLit):
        raise ValueError(f"{context} must be a string literal")
    return node.value


def _require_rect(node: Any, context: str) -> tuple[float, float, float, float]:
    if not isinstance(node, ast.TupleLit) or len(node.elements) != 4:
        raise ValueError(f"{context} must be a 4-tuple of numbers")
    values: list[float] = []
    for element in node.elements:
        if not isinstance(element, ast.NumberLit):
            raise ValueError(f"{context} must contain only number literals")
        values.append(float(element.value))
    return (values[0], values[1], values[2], values[3])


def _try_eval_const(node: Any, bindings: dict[str, Any]) -> Any:
    if isinstance(node, ast.StringLit):
        return node.value
    if isinstance(node, ast.NumberLit):
        return float(node.value)
    if isinstance(node, ast.BoolLit):
        return bool(node.value)
    if isinstance(node, ast.NullLit):
        return None
    if isinstance(node, ast.Ident):
        return bindings.get(node.name, _UNSUPPORTED)
    if isinstance(node, ast.TupleLit):
        values = [_try_eval_const(element, bindings) for element in node.elements]
        if any(value is _UNSUPPORTED for value in values):
            return _UNSUPPORTED
        return tuple(values)
    if isinstance(node, ast.ListLit):
        values = [_try_eval_const(element, bindings) for element in node.elements]
        if any(value is _UNSUPPORTED for value in values):
            return _UNSUPPORTED
        return list(values)
    if isinstance(node, ast.BinOp) and node.op in {"&", "AMPERSAND"}:
        left = _try_eval_const(node.left, bindings)
        right = _try_eval_const(node.right, bindings)
        if left is _UNSUPPORTED or right is _UNSUPPORTED:
            return _UNSUPPORTED
        return str(left) + str(right)
    return _UNSUPPORTED


def _render_scene_probe_packets(spec: dict[str, Any]) -> str:
    input_x, input_y, input_w, input_h = spec["input_rect"]
    log_x, log_y, log_w, log_h = spec["log_rect"]
    run_tag = str(spec["run_tag"])
    prompt = str(spec["prompt"])
    input_frame_id = str(spec.get("input_frame_id", "f1"))
    log_frame_id = str(spec.get("log_frame_id", "f2"))
    log_widget_id = str(spec.get("log_widget_id", "log"))
    payload = [
        {
            "seq": 1,
            "kind": "scene.replace",
            "payload": {
                "commands": [
                    {
                        "kind": "frame_upsert",
                        "id": input_frame_id,
                        "payload": {
                            "spec": {
                                "id": input_frame_id,
                                "title": str(spec["input_title"]),
                                "title_align": "left",
                                "rect": {"x": input_x, "y": input_y, "w": input_w, "h": input_h},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": False,
                                "exit_counted": True,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "aspect": str(spec.get("aspect", "equal")),
                                "body": None,
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    },
                    {
                        "kind": "frame_upsert",
                        "id": log_frame_id,
                        "payload": {
                            "spec": {
                                "id": log_frame_id,
                                "title": str(spec["log_title"]),
                                "title_align": "left",
                                "rect": {"x": log_x, "y": log_y, "w": log_w, "h": log_h},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": False,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "body": [
                                    {
                                        "id": log_widget_id,
                                        "type": "textarea",
                                        "text": run_tag + "\n" + prompt + "\n",
                                        "rows": 24,
                                        "readonly": True,
                                    }
                                ],
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    },
                ]
            },
        },
        {"seq": 2, "kind": "ui_state.replace", "payload": {"state": {}}},
        {"seq": 3, "kind": "display.replace", "payload": {"display": {"screen": [], "frames": {}, "geom": {}}}},
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_face_edge_vertex_drag_packets(spec: dict[str, Any]) -> str:
    x, y, w, h = spec["rect"]
    frame_id = str(spec["frame_id"])
    debug_frame_id = "fsm_debug_frame"
    debug_widget_id = "fsm_debug_log"
    payload = [
        {
            "seq": 1,
            "kind": "scene.replace",
            "payload": {
                "commands": [
                    {
                        "kind": "frame_upsert",
                        "id": frame_id,
                        "payload": {
                            "spec": {
                                "id": frame_id,
                                "title": str(spec["title"]),
                                "title_align": "left",
                                "rect": {"x": x, "y": y, "w": w, "h": h},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": False,
                                "exit_counted": True,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "aspect": str(spec.get("aspect", "equal")),
                                "body": None,
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    },
                    {
                        "kind": "frame_upsert",
                        "id": "sentinel_frame",
                        "payload": {
                            "spec": {
                                "id": "sentinel_frame",
                                "title": "",
                                "title_align": "left",
                                "rect": {"x": 0.995, "y": 0.995, "w": 0.001, "h": 0.001},
                                "flags": {
                                    "draggable": False,
                                    "dockable": False,
                                    "resizable": False,
                                    "closable": False,
                                    "use_browser": True,
                                },
                                "alpha": 0.0,
                                "master": False,
                                "exit_counted": False,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "body": None,
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    },
                    {
                        "kind": "frame_upsert",
                        "id": debug_frame_id,
                        "payload": {
                            "spec": {
                                "id": debug_frame_id,
                                "title": "FSM Debug",
                                "title_align": "left",
                                "rect": {"x": 0.76, "y": 0.12, "w": 0.22, "h": 0.62},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": False,
                                "exit_counted": True,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "body": [
                                    {
                                        "id": debug_widget_id,
                                        "type": "textarea",
                                        "text": "waiting for state...\n",
                                        "rows": 24,
                                        "readonly": True,
                                    }
                                ],
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    },
                ]
            },
        },
        {"seq": 2, "kind": "ui_state.replace", "payload": {"state": {}}},
        {"seq": 3, "kind": "display.replace", "payload": {"display": {"screen": [], "frames": {}, "geom": {}}}},
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_face_edge_vertex_drag_transport(spec: dict[str, Any]) -> str:
    payload = {
        "kind": "shared-buffer",
        "source": f"session:{spec['frame_id']}",
        "error": "",
        "revision": 0,
        "presentedRevision": -1,
        "stateByteLength": 0,
        "stateFormat": 1001,
        "flags": 0,
        "errorCode": 0,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_face_edge_vertex_drag_state(spec: dict[str, Any]) -> str:
    payload = {
        "channel": "scene",
        "name": spec["frame_id"],
        "points": spec["points"],
        "edgePairs": spec["edge_pairs"],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_cube_hover_packets(spec: dict[str, Any]) -> str:
    x, y, w, h = spec["rect"]
    dx, dy, dw, dh = spec["debug_rect"]
    frame_id = str(spec["frame_id"])
    debug_frame_id = str(spec["debug_frame_id"])
    debug_widget_id = "hover"
    payload = [
        {
            "seq": 1,
            "kind": "scene.replace",
            "payload": {
                "commands": [
                    {
                        "kind": "frame_upsert",
                        "id": frame_id,
                        "payload": {
                            "spec": {
                                "id": frame_id,
                                "title": str(spec["title"]),
                                "title_align": "left",
                                "rect": {"x": x, "y": y, "w": w, "h": h},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": False,
                                "exit_counted": True,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "body": None,
                                "body_layout": None,
                                "parent_id": None,
                                "aspect": spec.get("aspect"),
                            }
                        },
                    },
                    {
                        "kind": "frame_upsert",
                        "id": debug_frame_id,
                        "payload": {
                            "spec": {
                                "id": debug_frame_id,
                                "title": str(spec["debug_title"]),
                                "title_align": "left",
                                "rect": {"x": dx, "y": dy, "w": dw, "h": dh},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": False,
                                "exit_counted": True,
                                "dock_location": "br",
                                "anchor": "tl",
                                "body": [
                                    {
                                        "id": debug_widget_id,
                                        "type": "textarea",
                                        "text": "waiting for native hover...\n",
                                        "rows": 10,
                                        "readonly": True,
                                    }
                                ],
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    },
                ]
            },
        },
        {"seq": 2, "kind": "ui_state.replace", "payload": {"state": {}}},
        {"seq": 3, "kind": "display.replace", "payload": {"display": {"screen": [], "frames": {}, "geom": {}}}},
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_scene_3d_packets(spec: dict[str, Any]) -> str:
    if spec.get("kind") == "scene_3d_views":
        return _render_scene_3d_views_packets(spec)
    x, y, w, h = spec["rect"]
    frame_id = str(spec["frame_id"])
    payload = [
        {
            "seq": 1,
            "kind": "scene.replace",
            "payload": {
                "commands": [
                    {
                        "kind": "frame_upsert",
                        "id": frame_id,
                        "payload": {
                            "spec": {
                                "id": frame_id,
                                "title": str(spec["title"]),
                                "title_align": "left",
                                "rect": {"x": x, "y": y, "w": w, "h": h},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": True,
                                "exit_counted": True,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "body": None,
                                "body_layout": None,
                                "parent_id": None,
                                "aspect": spec.get("aspect"),
                            }
                        },
                    }
                ]
            },
        },
        {"seq": 2, "kind": "ui_state.replace", "payload": {"state": {}}},
        {"seq": 3, "kind": "display.replace", "payload": {"display": {"screen": [], "frames": {}, "geom": {}}}},
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_scene_3d_views_packets(spec: dict[str, Any]) -> str:
    commands: list[dict[str, Any]] = []
    visible_index = 0
    for idx, view in enumerate(spec.get("views", [])):
        x, y, w, h = view["rect"]
        if view.get("visible", True):
            commands.append(
                {
                    "kind": "frame_upsert",
                    "id": str(view["frame_id"]),
                    "payload": {
                        "spec": {
                            "id": str(view["frame_id"]),
                            "title": str(view["title"]),
                            "title_align": "left",
                            "rect": {"x": x, "y": y, "w": w, "h": h},
                            "flags": {
                                "draggable": True,
                                "dockable": True,
                                "resizable": True,
                                "closable": True,
                                "use_browser": True,
                            },
                            "alpha": 1.0,
                            "master": visible_index == 0,
                            "exit_counted": True,
                            "dock_location": "bl" if visible_index == 0 else "br",
                            "anchor": "tl",
                            "body": None,
                            "body_layout": None,
                            "parent_id": None,
                            "aspect": view.get("aspect"),
                        }
                    },
                }
            )
            visible_index += 1
    payload = [
        {"seq": 1, "kind": "scene.replace", "payload": {"commands": commands}},
        {"seq": 2, "kind": "ui_state.replace", "payload": {"state": {}}},
        {"seq": 3, "kind": "display.replace", "payload": {"display": {"screen": [], "frames": {}, "geom": {}}}},
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_ocean_wave_packets(spec: dict[str, Any]) -> str:
    x, y, w, h = spec["rect"]
    frame_id = str(spec["frame_id"])
    payload = [
        {
            "seq": 1,
            "kind": "scene.replace",
            "payload": {
                "commands": [
                    {
                        "kind": "frame_upsert",
                        "id": frame_id,
                        "payload": {
                            "spec": {
                                "id": frame_id,
                                "title": str(spec["title"]),
                                "title_align": "left",
                                "rect": {"x": x, "y": y, "w": w, "h": h},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": False,
                                "exit_counted": True,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "body": None,
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    }
                ]
            },
        },
        {"seq": 2, "kind": "ui_state.replace", "payload": {"state": {}}},
        {"seq": 3, "kind": "display.replace", "payload": {"display": {"screen": [], "frames": {}, "geom": {}}}},
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_dimension_mix_packets(spec: dict[str, Any]) -> str:
    commands: list[dict[str, Any]] = []
    for key, dock in (("points", "bl"), ("lines", "br"), ("surface", "tl"), ("volume", "tr")):
        frame = spec["frames"][key]
        x, y, w, h = frame["rect"]
        commands.append(
            {
                "kind": "frame_upsert",
                "id": str(frame["frame_id"]),
                "payload": {
                    "spec": {
                        "id": str(frame["frame_id"]),
                        "title": str(frame["title"]),
                        "title_align": "left",
                        "rect": {"x": x, "y": y, "w": w, "h": h},
                        "flags": {
                            "draggable": True,
                            "dockable": True,
                            "resizable": True,
                            "closable": True,
                            "use_browser": True,
                        },
                        "alpha": 1.0,
                        "master": key == "points",
                        "dock_location": dock,
                        "anchor": "tl",
                        "body": None,
                        "body_layout": None,
                        "parent_id": None,
                    }
                },
            }
        )
    payload = [
        {"seq": 1, "kind": "scene.replace", "payload": {"commands": commands}},
        {"seq": 2, "kind": "ui_state.replace", "payload": {"state": {}}},
        {"seq": 3, "kind": "display.replace", "payload": {"display": {"screen": [], "frames": {}, "geom": {}}}},
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_scene_probe_html(spec: dict[str, Any]) -> str:
    config_json = json.dumps(spec.get("event_probe") or {}, ensure_ascii=False)
    asset_version = _runtime_asset_version()
    return f"""<!DOCTYPE html>
<html>
  <body>
    <script src="../../vf-runtime-shell.js?v={asset_version}"></script>
    <script>
      (function (global) {{
        "use strict";

        var config = {config_json};
        function hostLog(level, message) {{
          try {{ console.log(message); }} catch (_) {{}}
          try {{
            if (global.chrome && global.chrome.webview && global.chrome.webview.postMessage) {{
              global.chrome.webview.postMessage({{ type: "vf_log", level: level, message: message }});
            }}
          }} catch (_) {{}}
        }}

        hostLog("info", "[native-scene-probe] inline boot");

        function boot() {{
          var frames = Array.prototype.slice.call(document.querySelectorAll(".vf-frame"));
          var textarea = document.querySelector("textarea");
          hostLog("info", "[native-scene-probe] probe frames=" + frames.length + " textarea=" + (!!textarea));
          if (frames.length < 2 || !textarea) {{
            return false;
          }}

          frames.sort(function (a, b) {{
            return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
          }});

          var leftFrame = frames[0];
          var rightFrame = frames[1];
          var leftBody = leftFrame.querySelector(".vf-frame__body");
          if (!leftBody) {{
            hostLog("warn", "[native-scene-probe] left body missing");
            return false;
          }}

          var seq = 0;
          var counters = Object.create(null);
          var ruleByMatch = Object.create(null);
          var rules = Array.isArray(config.loop_rules) ? config.loop_rules : [];
          for (var ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {{
            var rule = rules[ruleIndex];
            if (rule && typeof rule.match === "string") {{
              ruleByMatch[rule.match] = rule;
            }}
          }}
          var hasHoverRule = !!ruleByMatch.MouseHover;
          var hasMoveRule = !!ruleByMatch.MouseMove;

          function append(line) {{
            seq += 1;
            textarea.value += "[" + seq + "] " + line + "\\n";
            textarea.scrollTop = textarea.scrollHeight;
          }}

          function fmt(n) {{
            return Number(n).toFixed(3);
          }}

          function pos(ev) {{
            var r = leftBody.getBoundingClientRect();
            return {{ x: Math.round(ev.clientX - r.left), y: Math.round(ev.clientY - r.top) }};
          }}

          function formatStruct(fields, data) {{
            var parts = [];
            for (var i = 0; i < fields.length; i++) {{
              var key = fields[i];
              var value = data[key];
              if (value === undefined || value === null) {{
                value = "";
              }}
              parts.push(key + "=" + String(value));
            }}
            return parts.join(" ");
          }}

          function formatterFor(kind) {{
            var formatters = config.formatters || {{}};
            if (formatters[kind]) return formatters[kind];
            if (kind === "MouseHover" || kind === "MouseMove" || kind === "MouseDown" || kind === "MouseUp" || kind === "MouseDrag" || kind === "MouseWheel") {{
              return formatters.MouseEvent || formatters.default || [];
            }}
            if (kind === "KeyDown" || kind === "KeyUp") {{
              return formatters.KeyboardEvent || formatters.default || [];
            }}
            if (kind.indexOf("Frame") === 0) {{
              return formatters.FrameEvent || formatters.default || [];
            }}
            return formatters.default || [];
          }}

          function logKind(kind, data) {{
            var fields = formatterFor(kind);
            append(kind + " | " + formatStruct(fields, data));
          }}

          function shouldLogRule(rule) {{
            if (!rule.throttle) return true;
            var counter = String(rule.throttle.counter || "");
            counters[counter] = Number(counters[counter] || 0) + 1;
            return counters[counter] === Number(rule.throttle.first || 1) || (Number(rule.throttle.every || 0) > 0 && counters[counter] % Number(rule.throttle.every) === 0);
          }}

          function dispatchKind(kind, data) {{
            var rule = ruleByMatch[kind];
            if (rule) {{
              if (shouldLogRule(rule)) {{
                logKind(rule.label || kind, data);
              }}
              return;
            }}
            var fallbackRule = ruleByMatch["default"];
            if (fallbackRule) {{
              logKind(fallbackRule.label || "Other", data);
            }}
          }}

          function mouseEventData(eventName, ev, extra) {{
            var p = pos(ev);
            return Object.assign({{
              event: eventName,
              frame_id: "input_frame",
              widget_id: "",
              x: p.x,
              y: p.y,
              pick_id: 0,
              button: Number(ev.button || 0),
              buttons: Number(ev.buttons || 0)
            }}, extra || {{}});
          }}

          function keyEventData(eventName, ev) {{
            return {{
              event: eventName,
              frame_id: "input_frame",
              widget_id: "",
              key: String(ev.key || ""),
              code: String(ev.code || ""),
              ctrl: !!ev.ctrlKey,
              shift: !!ev.shiftKey,
              alt: !!ev.altKey
            }};
          }}

          function frameEventData(eventName, frameEl) {{
            var rect = frameEl.getBoundingClientRect();
            var dock = frameEl.classList.contains("vf-frame--minimized") ? "bl" : "";
            return {{
              event: eventName,
              frame_id: frameEl === rightFrame ? "log_frame" : "input_frame",
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              dock: dock
            }};
          }}

          var lastHeaderRect = null;
          var lastResizeRect = null;
          var header = leftFrame.querySelector(".vf-frame__header");
          var resizeGrip = leftFrame.querySelector(".vf-frame__resize-grip");
          var closeBtn = leftFrame.querySelector(".vf-close-btn");
          var minBtn = leftFrame.querySelector(".vf-min-btn, .vf-minimize-btn, button[aria-label='Minimize']");

          leftBody.tabIndex = 0;
          leftBody.addEventListener("pointerenter", function (ev) {{
            if (hasHoverRule) {{
              dispatchKind("MouseHover", mouseEventData("hover", ev));
            }}
          }});
          leftBody.addEventListener("pointermove", function (ev) {{
            if (ev.buttons) {{
              dispatchKind("MouseDrag", mouseEventData("drag", ev));
            }} else if (hasHoverRule) {{
              dispatchKind("MouseHover", mouseEventData("hover", ev));
            }} else if (hasMoveRule) {{
              dispatchKind("MouseMove", mouseEventData("move", ev));
            }}
          }});
          leftBody.addEventListener("pointerdown", function (ev) {{
            try {{ leftBody.setPointerCapture(ev.pointerId); }} catch (_) {{}}
            dispatchKind("MouseDown", mouseEventData("down", ev));
            leftBody.focus();
          }});
          leftBody.addEventListener("pointerup", function (ev) {{
            dispatchKind("MouseUp", mouseEventData("up", ev));
            try {{ leftBody.releasePointerCapture(ev.pointerId); }} catch (_) {{}}
          }});
          leftBody.addEventListener("wheel", function (ev) {{
            var p = pos(ev);
            dispatchKind("MouseWheel", {{
              event: "wheel",
              frame_id: "input_frame",
              widget_id: "",
              x: p.x,
              y: p.y,
              pick_id: 0,
              button: 0,
              buttons: Number(ev.buttons || 0)
            }});
          }}, {{ passive: true }});
          leftBody.addEventListener("keydown", function (ev) {{
            dispatchKind("KeyDown", keyEventData("keydown", ev));
          }});
          leftBody.addEventListener("keyup", function (ev) {{
            dispatchKind("KeyUp", keyEventData("keyup", ev));
          }});

          if (header) {{
            header.addEventListener("pointerdown", function () {{
              lastHeaderRect = leftFrame.getBoundingClientRect();
            }});
            header.addEventListener("pointerup", function () {{
              if (!lastHeaderRect) return;
              var nextRect = leftFrame.getBoundingClientRect();
              if (Math.round(nextRect.left) !== Math.round(lastHeaderRect.left) || Math.round(nextRect.top) !== Math.round(lastHeaderRect.top)) {{
                dispatchKind("FrameDragged", frameEventData("frame.dragged", leftFrame));
              }}
              lastHeaderRect = null;
            }});
          }}
          if (resizeGrip) {{
            resizeGrip.addEventListener("pointerdown", function () {{
              lastResizeRect = leftFrame.getBoundingClientRect();
            }});
            resizeGrip.addEventListener("pointerup", function () {{
              if (!lastResizeRect) return;
              var nextRect = leftFrame.getBoundingClientRect();
              if (Math.round(nextRect.width) !== Math.round(lastResizeRect.width) || Math.round(nextRect.height) !== Math.round(lastResizeRect.height)) {{
                dispatchKind("FrameResized", frameEventData("frame.resized", leftFrame));
              }}
              lastResizeRect = null;
            }});
          }}
          if (closeBtn) {{
            closeBtn.addEventListener("click", function () {{
              dispatchKind("FrameClosed", frameEventData("frame.closed", leftFrame));
            }});
          }}
          if (minBtn) {{
            minBtn.addEventListener("click", function () {{
              global.setTimeout(function () {{
                dispatchKind("FrameDocked", frameEventData("frame.docked", leftFrame));
              }}, 0);
            }});
          }}

          leftBody.focus();
          hostLog("info", "[native-scene-probe] ready");
          return true;
        }}

        var attempts = 0;
        function waitForFrames() {{
          attempts += 1;
          try {{
            if (boot()) {{
              return;
            }}
          }} catch (err) {{
            hostLog("error", "[native-scene-probe] crash " + (err && err.message ? err.message : String(err)));
            throw err;
          }}
          if (attempts < 240) {{
            global.setTimeout(waitForFrames, 16);
          }} else {{
            hostLog("error", "[native-scene-probe] timed out waiting for frames");
          }}
        }}

        if (document.readyState === "loading") {{
          document.addEventListener("DOMContentLoaded", waitForFrames, {{ once: true }});
        }} else {{
          waitForFrames();
        }}
      }})(typeof window !== "undefined" ? window : this);
    </script>
  </body>
</html>
"""


def _render_face_edge_vertex_drag_html(spec: dict[str, Any]) -> str:
    config_json = json.dumps(
        {
            "frame_id": spec["frame_id"],
            "points": spec["points"],
            "edge_pairs": spec["edge_pairs"],
            "aspect": str(spec.get("aspect", "equal")),
            "styles": spec.get("styles", {}),
            "drag": spec.get("drag", {}),
            "debug_frame_id": "fsm_debug_frame",
            "debug_widget_id": "fsm_debug_log",
        },
        ensure_ascii=False,
    )
    asset_version = _runtime_asset_version()
    return f"""<!DOCTYPE html>
<html>
  <body>
    <script src="../../vf-runtime-shell.js?v={asset_version}"></script>
    <script>
      window.__vfNativeFaceEdgeVertexConfig = {config_json};
    </script>
    <script src="../../vf-native-scene-face-edge-vertex.js?v={asset_version}"></script>
  </body>
</html>
"""


def _render_cube_hover_html(spec: dict[str, Any]) -> str:
    config_json = json.dumps(
        {
            "kind": spec.get("kind", "cube_hover"),
            "frame_id": spec["frame_id"],
            "debug_frame_id": spec["debug_frame_id"],
            "debug_widget_id": "hover",
            "edge_radius": spec["edge_radius"],
            "vertex_radius": spec["vertex_radius"],
            "styles": spec["styles"],
            "camera": spec.get("camera", {}),
            "light": spec.get("light", {}),
        },
        ensure_ascii=False,
    )
    asset_version = _runtime_asset_version()
    return f"""<!DOCTYPE html>
<html>
  <body>
    <script src="../../vf-runtime-shell.js?v={asset_version}"></script>
    <script>
      window.__vfNativeCubeHoverConfig = {config_json};
    </script>
    <script src="../../vf-native-scene-cube-hover.js?v={asset_version}"></script>
  </body>
</html>
"""


def _render_scene_3d_html(spec: dict[str, Any]) -> str:
    if spec.get("kind") == "scene_3d_views":
        return _render_scene_3d_views_html(spec)
    config_json = json.dumps({"scene_ir": spec.get("scene_ir", {})}, ensure_ascii=False)
    asset_version = _runtime_asset_version()
    return f"""<!DOCTYPE html>
<html>
  <body>
    <script src="../../vf-runtime-shell.js?v={asset_version}"></script>
    <script>
      window.__vfNativeSceneConfig = {config_json};
    </script>
    <script src="../../vf-native-scene.js?v={asset_version}"></script>
  </body>
</html>
"""


def _render_scene_3d_views_html(spec: dict[str, Any]) -> str:
    ordered_views = sorted(
        spec.get("views", []),
        key=lambda view: 0 if not view.get("visible", True) else 1,
    )
    config_json = json.dumps(
        [{"scene_ir": view.get("scene_ir", {})} for view in ordered_views],
        ensure_ascii=False,
    )
    asset_version = _runtime_asset_version()
    return f"""<!DOCTYPE html>
<html>
  <body>
    <script src="../../vf-runtime-shell.js?v={asset_version}"></script>
    <script>
      window.__vfNativeSceneConfigs = {config_json};
      (function (global) {{
        var configs = Array.isArray(global.__vfNativeSceneConfigs) ? global.__vfNativeSceneConfigs.slice() : [];
        function fail(text) {{
          throw new Error("scene_3d_views: " + String(text));
        }}
        function loadAt(index) {{
          if (index >= configs.length) {{
            return;
          }}
          global.__vfNativeSceneConfig = configs[index];
          var el = document.createElement("script");
          el.src = "../../vf-native-scene.js?v={asset_version}&view=" + String(index);
          el.onload = function () {{
            loadAt(index + 1);
          }};
          el.onerror = function () {{
            fail("failed to load vf-native-scene.js for view " + String(index));
          }};
          document.body.appendChild(el);
        }}
        loadAt(0);
      }})(typeof window !== "undefined" ? window : this);
    </script>
  </body>
</html>
"""


def _render_ocean_wave_html(spec: dict[str, Any]) -> str:
    config_json = json.dumps(
        {
            "kind": "ocean_wave",
            "frame_id": spec["frame_id"],
            "surface": spec["surface"],
            "styles": spec["styles"],
            "camera": spec["camera"],
            "light": spec["light"],
            "timing": spec["timing"],
            "waves": spec["waves"],
        },
        ensure_ascii=False,
    )
    asset_version = _runtime_asset_version()
    return f"""<!DOCTYPE html>
<html>
  <body>
    <script src="../../vf-runtime-shell.js?v={asset_version}"></script>
    <script>
      window.__vfNativeOceanConfig = {config_json};
    </script>
    <script src="../../vf-native-scene-ocean.js?v={asset_version}"></script>
  </body>
</html>
"""


def _render_dimension_mix_html(spec: dict[str, Any]) -> str:
    config_json = json.dumps(spec, ensure_ascii=False)
    asset_version = _runtime_asset_version()
    return f"""<!DOCTYPE html>
<html>
  <body>
    <script src="../../vf-runtime-shell.js?v={asset_version}"></script>
    <script>
      window.__vfNativeDimensionMixConfig = {config_json};
    </script>
    <script src="../../vf-native-scene-dimension-mix.js?v={asset_version}"></script>
  </body>
</html>
"""


_NATIVE_SCENE_COMPILERS: dict[str, _NativeSceneCompiler] = {
    "scene_3d": _NativeSceneCompiler(
        default_session_name="ui-scene-3d",
        normalize_spec=_normalize_scene_3d_spec,
        render_html=_render_scene_3d_html,
        render_runtime_packets=_render_scene_3d_packets,
    ),
    "scene_3d_views": _NativeSceneCompiler(
        default_session_name="ui-scene-3d-views",
        normalize_spec=_normalize_scene_3d_views_spec,
        render_html=_render_scene_3d_views_html,
        render_runtime_packets=_render_scene_3d_views_packets,
    ),
    "face_edge_vertex_drag": _NativeSceneCompiler(
        default_session_name="ui-face-edge-vertex-drag",
        normalize_spec=_normalize_face_edge_vertex_drag_spec,
        render_html=_render_face_edge_vertex_drag_html,
        render_runtime_packets=_render_face_edge_vertex_drag_packets,
        render_geom_transport=_render_face_edge_vertex_drag_transport,
        render_geom_state=_render_face_edge_vertex_drag_state,
    ),
    "cube_hover": _NativeSceneCompiler(
        default_session_name="ui-cube-hover",
        normalize_spec=_normalize_cube_hover_spec,
        render_html=_render_cube_hover_html,
        render_runtime_packets=_render_cube_hover_packets,
    ),
    "cube_lighting_camera": _NativeSceneCompiler(
        default_session_name="ui-cube-lighting-camera",
        normalize_spec=_normalize_cube_hover_spec,
        render_html=_render_cube_hover_html,
        render_runtime_packets=_render_cube_hover_packets,
    ),
    "ocean_wave": _NativeSceneCompiler(
        default_session_name="ui-ocean-wave",
        normalize_spec=_normalize_ocean_wave_spec,
        render_html=_render_ocean_wave_html,
        render_runtime_packets=_render_ocean_wave_packets,
    ),
    "dimension_mix": _NativeSceneCompiler(
        default_session_name="ui-field-mesh-dimension-mix",
        normalize_spec=_normalize_dimension_mix_spec,
        render_html=_render_dimension_mix_html,
        render_runtime_packets=_render_dimension_mix_packets,
    ),
}

