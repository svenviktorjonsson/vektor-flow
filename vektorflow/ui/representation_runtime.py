"""UI representation runtime helpers.

This module owns representation refresh and lowering helpers so the Python
``Display`` object can move toward orchestration-only behavior.
"""

from __future__ import annotations

import math
from itertools import product
from typing import Any


def _ui():
    from vektorflow.stdlib import ui as ui_stdlib

    return ui_stdlib


def build_embedding_scope_draw_ops(
    display: Any,
    scope: dict[str, Any],
    defaults: dict[str, Any],
    source_value: Any,
    *,
    rep_ordinal: int,
    content_path: int = 0,
) -> list[dict[str, Any]]:
    ui_stdlib = _ui()
    raw_vertices = scope.get("vertices")
    if raw_vertices is None:
        raise TypeError("graphics embedding must define vertices")

    vertices = ui_stdlib._coerce_vertices2(raw_vertices)
    edge_indices = ui_stdlib._coerce_index_pairs(scope.get("edge_indices", []), "edge_indices")
    face_indices = ui_stdlib._coerce_face_indices(scope.get("face_indices", []))
    _validate_index_bounds(vertices, edge_indices, "edge_indices")
    _validate_index_bounds(vertices, face_indices, "face_indices")

    ops: list[dict[str, Any]] = []

    face_color_value = scope.get("face_color")
    face_scale_value = scope.get("face_scale")
    face_style_value = scope.get("face_style")
    for face_index, face in enumerate(face_indices):
        points = [vertices[idx] for idx in face]
        color = ui_stdlib._sample_continuous_property(
            face_color_value,
            ui_stdlib.VFVector([0.5, 0.5]),
            ui_stdlib._resolve_graphics_default(defaults, "face", "color"),
        )
        scale = ui_stdlib._sample_continuous_property(
            face_scale_value,
            ui_stdlib.VFVector([0.5, 0.5]),
            ui_stdlib._resolve_graphics_default(defaults, "face", "scale"),
        )
        style_fields = ui_stdlib._style_fields(
            ui_stdlib._sample_continuous_property(
                face_style_value,
                ui_stdlib.VFVector([0.5, 0.5]),
                ui_stdlib._resolve_graphics_default(defaults, "face", "style"),
            ),
            "face",
        )
        if style_fields.get("filled", True):
            ops.append(
                {
                    "op": "polygon",
                    "points": points,
                    "color": ui_stdlib._color_to_css(color),
                    "scale": float(scale),
                    "strokeColor": ui_stdlib._color_to_css(style_fields["stroke_color"]) if "stroke_color" in style_fields else None,
                    "strokeWidth": float(style_fields["stroke_scale"]) if "stroke_scale" in style_fields else None,
                    **ui_stdlib._pick_meta(rep_ordinal, ui_stdlib._PICK_KIND_FACE, face_index, content_path=content_path),
                }
            )
        content_spec = ui_stdlib._coerce_content_spec(style_fields.get("content"), source_value)
        if content_spec is not None:
            child_value, child_embedding, child_view, child_defaults_patch = content_spec
            child_defaults = defaults
            if child_defaults_patch:
                child_defaults = ui_stdlib._structural_merge_dict(child_defaults, ui_stdlib._normalize_graphics_defaults_patch(child_defaults_patch))
            child_scope = display._evaluate_embedding_scope(child_value, child_embedding, child_view)
            child_ops = build_embedding_scope_draw_ops(
                display,
                child_scope,
                child_defaults,
                child_value,
                rep_ordinal=rep_ordinal,
                content_path=ui_stdlib._next_content_path(content_path, ui_stdlib._PICK_KIND_FACE, face_index),
            )
            bbox_w = max(p[0] for p in points) - min(p[0] for p in points)
            bbox_h = max(p[1] for p in points) - min(p[1] for p in points)
            child_scale = max(1e-9, min(abs(bbox_w), abs(bbox_h)))
            ops.extend(
                ui_stdlib._transform_ops(
                    child_ops,
                    lambda p, pts=points: ui_stdlib._transform_point_face(pts, p),
                    linear_scale=child_scale,
                )
            )

    edge_color_value = scope.get("edge_color")
    edge_scale_value = scope.get("edge_scale")
    edge_style_value = scope.get("edge_style")
    for edge_index, pair in enumerate(edge_indices):
        points = [vertices[pair[0]], vertices[pair[1]]]
        color = ui_stdlib._sample_continuous_property(
            edge_color_value,
            0.5,
            ui_stdlib._resolve_graphics_default(defaults, "edge", "color"),
        )
        width = ui_stdlib._sample_continuous_property(
            edge_scale_value,
            0.5,
            ui_stdlib._resolve_graphics_default(defaults, "edge", "scale"),
        )
        style_fields = ui_stdlib._style_fields(
            ui_stdlib._sample_continuous_property(
                edge_style_value,
                0.5,
                ui_stdlib._resolve_graphics_default(defaults, "edge", "style"),
            ),
            "edge",
        )
        if style_fields.get("pattern", "solid") != "none":
            ops.append(
                {
                    "op": "polyline",
                    "points": points,
                    "color": ui_stdlib._color_to_css(color),
                    "width": float(width),
                    "pattern": str(style_fields.get("pattern", "solid")),
                    "cap": str(style_fields.get("cap", "round")),
                    **ui_stdlib._pick_meta(rep_ordinal, ui_stdlib._PICK_KIND_EDGE, edge_index, content_path=content_path),
                }
            )
        content_spec = ui_stdlib._coerce_content_spec(style_fields.get("content"), source_value)
        if content_spec is not None:
            child_value, child_embedding, child_view, child_defaults_patch = content_spec
            child_defaults = defaults
            if child_defaults_patch:
                child_defaults = ui_stdlib._structural_merge_dict(child_defaults, ui_stdlib._normalize_graphics_defaults_patch(child_defaults_patch))
            child_scope = display._evaluate_embedding_scope(child_value, child_embedding, child_view)
            child_ops = build_embedding_scope_draw_ops(
                display,
                child_scope,
                child_defaults,
                child_value,
                rep_ordinal=rep_ordinal,
                content_path=ui_stdlib._next_content_path(content_path, ui_stdlib._PICK_KIND_EDGE, edge_index),
            )
            ops.extend(
                ui_stdlib._transform_ops(
                    child_ops,
                    lambda p, a=points[0], b=points[1], w=float(width): ui_stdlib._transform_point_edge(a, b, w, p),
                    linear_scale=max(1e-9, float(width)),
                )
            )

    show_vertices = any(k in scope for k in ("vertex_color", "vertex_scale", "vertex_style")) or (
        not edge_indices and not face_indices
    )
    if show_vertices:
        vertex_colors = ui_stdlib._vertex_value_ledger(
            scope.get("vertex_color"),
            len(vertices),
            ui_stdlib._resolve_graphics_default(defaults, "vertex", "color"),
        )
        vertex_scales = ui_stdlib._vertex_scalar_ledger(
            scope.get("vertex_scale"),
            len(vertices),
            float(ui_stdlib._resolve_graphics_default(defaults, "vertex", "scale")),
        )
        vertex_styles = ui_stdlib._vertex_value_ledger(
            scope.get("vertex_style"),
            len(vertices),
            ui_stdlib._resolve_graphics_default(defaults, "vertex", "style"),
        )
        for i, point in enumerate(vertices):
            style_fields = ui_stdlib._style_fields(vertex_styles[i], "vertex")
            shape = str(style_fields.get("marker", "circle"))
            if shape != "none":
                ops.append(
                    {
                        "op": "point",
                        "point": point,
                        "color": ui_stdlib._color_to_css(vertex_colors[i]),
                        "radius": float(vertex_scales[i]),
                        "shape": shape,
                        **ui_stdlib._pick_meta(rep_ordinal, ui_stdlib._PICK_KIND_VERTEX, i, content_path=content_path),
                    }
                )
            content_spec = ui_stdlib._coerce_content_spec(style_fields.get("content"), source_value)
            if content_spec is not None:
                child_value, child_embedding, child_view, child_defaults_patch = content_spec
                child_defaults = defaults
                if child_defaults_patch:
                    child_defaults = ui_stdlib._structural_merge_dict(child_defaults, ui_stdlib._normalize_graphics_defaults_patch(child_defaults_patch))
                child_scope = display._evaluate_embedding_scope(child_value, child_embedding, child_view)
                child_ops = build_embedding_scope_draw_ops(
                    display,
                    child_scope,
                    child_defaults,
                    child_value,
                    rep_ordinal=rep_ordinal,
                    content_path=ui_stdlib._next_content_path(content_path, ui_stdlib._PICK_KIND_VERTEX, i),
                )
                ops.extend(
                    ui_stdlib._transform_ops(
                        child_ops,
                        lambda p, anchor=point, s=float(vertex_scales[i]): ui_stdlib._transform_point_vertex(anchor, s, p),
                        linear_scale=max(1e-9, float(vertex_scales[i])),
                    )
                )

    return ops


def refresh_representation(display: Any, rep: Any) -> None:
    scope = display._evaluate_embedding_scope(rep.source, rep.embedding, rep.view)
    ops = build_embedding_scope_draw_ops(
        display,
        scope,
        display._effective_graphics_defaults(rep._frame_id),
        rep.source,
        rep_ordinal=rep.rep_ordinal,
    )
    display._set_representation_ops(rep._frame_id, rep.rep_id, ops)


def refresh_representations_for_frame(display: Any, frame_id: str | None) -> None:
    if frame_id is None:
        return
    descendants = {frame_id}
    changed = True
    while changed:
        changed = False
        for child, parent in list(display._frame_parent.items()):
            if parent in descendants and child not in descendants:
                descendants.add(child)
                changed = True
    for rep in list(display._representations.values()):
        if rep._frame_id in descendants:
            refresh_representation(display, rep)


def refresh_all_representations(display: Any) -> None:
    for rep in list(display._representations.values()):
        refresh_representation(display, rep)


def _shape_of_nested(value: Any) -> tuple[int, ...]:
    ui_stdlib = _ui()
    if not isinstance(value, (ui_stdlib.VFVector, list, tuple)):
        return ()
    n = len(value)
    if n == 0:
        return (0,)
    first = _shape_of_nested(value[0])
    for i in range(1, n):
        if _shape_of_nested(value[i]) != first:
            raise ValueError("ragged arrays are not supported in ui.add(...)")
    return (n,) + first


def _nested_get(value: Any, idxs: tuple[int, ...]) -> Any:
    cur = value
    for idx in idxs:
        cur = cur[idx]
    return cur


def _iter_multi_index(shape: tuple[int, ...]):
    if not shape:
        yield ()
        return
    for tup in product(*[range(n) for n in shape]):
        yield tup


def _normalize3(x: float, y: float, z: float) -> tuple[float, float, float]:
    m = math.sqrt(x * x + y * y + z * z)
    if m <= 1e-12:
        return (0.0, 0.0, 1.0)
    return (x / m, y / m, z / m)


def _face_normal(a: tuple[float, float, float], b: tuple[float, float, float], c: tuple[float, float, float]) -> tuple[float, float, float]:
    ux, uy, uz = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    vx, vy, vz = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    nx = uy * vz - uz * vy
    ny = uz * vx - ux * vz
    nz = ux * vy - uy * vx
    return _normalize3(nx, ny, nz)


def build_field_mesh_geometry(
    channels: dict[str, dict[str, Any]],
    meta: dict[str, Any],
    *,
    time_index: int = 0,
) -> dict[str, Any]:
    ui_stdlib = _ui()
    canonical_dims = [d for d in ui_stdlib._DIM_ORDER if any(d in channels[a]["dims"] for a in ("x", "y", "z"))]
    dim_sizes: dict[str, int] = {}
    for d in canonical_dims:
        sizes: list[int] = []
        for a in ("x", "y", "z"):
            cdims = channels[a]["dims"]
            if d in cdims:
                axis_i = cdims.index(d)
                sizes.append(int(channels[a]["shape"][axis_i]))
        if not sizes:
            dim_sizes[d] = 1
            continue
        target = max(sizes)
        for s in sizes:
            if s not in (1, target):
                raise ValueError(
                    f"incompatible broadcast for dim {d!r}: sizes={sizes}"
                )
        dim_sizes[d] = target

    time_count = int(dim_sizes.get("t", 1))
    current_t = max(0, min(int(time_index), max(0, time_count - 1)))
    sample_dims = [d for d in canonical_dims if d != "t"]
    cshape = tuple(dim_sizes[d] for d in sample_dims)

    def _sample(axis: str, idx_tuple: tuple[int, ...]) -> float:
        ch = channels[axis]
        if not ch["dims"]:
            return float(ch["data"])
        idx_map = {d: 0 for d in canonical_dims}
        idx_map["t"] = current_t
        for i, d in enumerate(sample_dims):
            idx_map[d] = idx_tuple[i]
        use_idxs: list[int] = []
        for k, d in enumerate(ch["dims"]):
            sz = int(ch["shape"][k])
            full_i = idx_map.get(d, 0)
            use_idxs.append(0 if sz == 1 else full_i)
        return float(_nested_get(ch["data"], tuple(use_idxs)))

    rgba = ui_stdlib._parse_color_rgba(meta.get("color"))
    interpolation = bool(meta.get("interpolation", False))

    points: list[tuple[float, float, float]] = []
    vindex: dict[tuple[int, ...], int] = {}
    for i, idx in enumerate(_iter_multi_index(cshape)):
        x = _sample("x", idx)
        y = _sample("y", idx)
        z = _sample("z", idx)
        points.append((x, y, z))
        vindex[idx] = i

    manifold_dims = [d for d in "uvw" if d in dim_sizes and dim_sizes[d] > 1]
    base_indices: list[int] = []
    topology = "line-list"

    def _idx(base: dict[str, int]) -> int:
        tup = tuple(base.get(d, 0) for d in sample_dims)
        return int(vindex[tup])

    if len(manifold_dims) == 1:
        topology = "line-list"
        du = manifold_dims[0]
        loop_dims = [d for d in sample_dims if d != du]
        for rest in _iter_multi_index(tuple(dim_sizes[d] for d in loop_dims)):
            base = {d: 0 for d in sample_dims}
            for k, d in enumerate(loop_dims):
                base[d] = int(rest[k])
            for u in range(dim_sizes[du] - 1):
                base[du] = u
                a = _idx(base)
                base[du] = u + 1
                b = _idx(base)
                base_indices.extend([a, b])
    elif len(manifold_dims) == 2:
        topology = "triangle-list"
        du, dv = manifold_dims
        loop_dims = [d for d in sample_dims if d not in (du, dv)]
        for rest in _iter_multi_index(tuple(dim_sizes[d] for d in loop_dims)):
            base = {d: 0 for d in sample_dims}
            for k, d in enumerate(loop_dims):
                base[d] = int(rest[k])
            for u in range(dim_sizes[du] - 1):
                for v in range(dim_sizes[dv] - 1):
                    base[du], base[dv] = u, v
                    a = _idx(base)
                    base[du], base[dv] = u + 1, v
                    b = _idx(base)
                    base[du], base[dv] = u + 1, v + 1
                    c = _idx(base)
                    base[du], base[dv] = u, v + 1
                    d = _idx(base)
                    base_indices.extend([a, b, c, a, c, d])
    elif len(manifold_dims) >= 3:
        topology = "triangle-list"
        du, dv, dw = manifold_dims[0], manifold_dims[1], manifold_dims[2]
        loop_dims = [d for d in sample_dims if d not in (du, dv, dw)]
        for rest in _iter_multi_index(tuple(dim_sizes[d] for d in loop_dims)):
            base = {d: 0 for d in sample_dims}
            for k, d in enumerate(loop_dims):
                base[d] = int(rest[k])
            for u in range(dim_sizes[du] - 1):
                for v in range(dim_sizes[dv] - 1):
                    for w in range(dim_sizes[dw] - 1):
                        base[du], base[dv], base[dw] = u, v, w
                        c000 = _idx(base)
                        base[du], base[dv], base[dw] = u + 1, v, w
                        c100 = _idx(base)
                        base[du], base[dv], base[dw] = u, v + 1, w
                        c010 = _idx(base)
                        base[du], base[dv], base[dw] = u + 1, v + 1, w
                        c110 = _idx(base)
                        base[du], base[dv], base[dw] = u, v, w + 1
                        c001 = _idx(base)
                        base[du], base[dv], base[dw] = u + 1, v, w + 1
                        c101 = _idx(base)
                        base[du], base[dv], base[dw] = u, v + 1, w + 1
                        c011 = _idx(base)
                        base[du], base[dv], base[dw] = u + 1, v + 1, w + 1
                        c111 = _idx(base)
                        base_indices.extend([c000, c100, c110, c000, c110, c010])
                        base_indices.extend([c001, c011, c111, c001, c111, c101])
                        base_indices.extend([c000, c010, c011, c000, c011, c001])
                        base_indices.extend([c100, c101, c111, c100, c111, c110])
                        base_indices.extend([c000, c001, c101, c000, c101, c100])
                        base_indices.extend([c010, c110, c111, c010, c111, c011])

    vertices: list[float] = []
    indices: list[int] = []
    if topology == "triangle-list":
        if interpolation:
            acc: list[list[float]] = [[0.0, 0.0, 0.0] for _ in range(len(points))]
            for t in range(0, len(base_indices), 3):
                ia, ib, ic = base_indices[t], base_indices[t + 1], base_indices[t + 2]
                n = _face_normal(points[ia], points[ib], points[ic])
                for ii in (ia, ib, ic):
                    acc[ii][0] += n[0]
                    acc[ii][1] += n[1]
                    acc[ii][2] += n[2]
            for i, p in enumerate(points):
                nx, ny, nz = _normalize3(acc[i][0], acc[i][1], acc[i][2])
                vertices.extend([p[0], p[1], p[2], nx, ny, nz, rgba[0], rgba[1], rgba[2], rgba[3]])
            indices = list(base_indices)
        else:
            for t in range(0, len(base_indices), 3):
                ia, ib, ic = base_indices[t], base_indices[t + 1], base_indices[t + 2]
                a, b, c = points[ia], points[ib], points[ic]
                nx, ny, nz = _face_normal(a, b, c)
                base = len(vertices) // 10
                for p in (a, b, c):
                    vertices.extend([p[0], p[1], p[2], nx, ny, nz, rgba[0], rgba[1], rgba[2], rgba[3]])
                indices.extend([base, base + 1, base + 2])
    else:
        for p in points:
            vertices.extend([p[0], p[1], p[2], 0.0, 0.0, 1.0, rgba[0], rgba[1], rgba[2], rgba[3]])
        indices = list(base_indices)

    return {
        "vertices": vertices,
        "indices": indices,
        "topology": topology,
        "interpolation": interpolation,
        "alpha": float(rgba[3]),
        "time_count": time_count,
        "time_index": current_t,
    }


def build_field_mesh_from_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
    ui_stdlib = _ui()
    channels: dict[str, dict[str, Any]] = {}
    meta: dict[str, Any] = {}
    for key, value in kwargs.items():
        m = ui_stdlib._MESH_CHANNEL_RE.match(str(key))
        if m:
            axis = m.group(1)
            dims = str(m.group(2) or "")
            channels[axis] = _parse_mesh_channel(axis, dims, value)
        else:
            meta[key] = value

    missing = [a for a in ("x", "y", "z") if a not in channels]
    if missing:
        raise ValueError(f"ui.add(...) missing channels: {', '.join(missing)}")

    geom = build_field_mesh_geometry(
        channels,
        meta,
        time_index=int(meta.get("t", 0)),
    )

    return {
        "type": "field_mesh",
        "id": str(meta.get("id", "field_mesh")),
        "vertices": geom["vertices"],
        "indices": geom["indices"],
        "topology": geom["topology"],
        "interpolation": geom["interpolation"],
        "alpha": geom["alpha"],
        "center": ui_stdlib._vec3(meta.get("center", [0, 0, 0]), "center"),
        "scale": ui_stdlib._vec3(meta.get("scale", [1, 1, 1]), "scale"),
        "rotation": ui_stdlib._vec3(meta.get("rotation", [0, 0, 0]), "rotation"),
        "color": meta.get("color"),
        "time_count": geom["time_count"],
        "time_index": geom["time_index"],
    }


def _parse_mesh_channel(
    axis: str,
    dims: str,
    value: Any,
) -> dict[str, Any]:
    ui_stdlib = _ui()
    if len(set(dims)) != len(dims):
        raise ValueError(f"duplicate dimensions in {axis}_{dims!s}")
    for d in dims:
        if d not in ui_stdlib._DIM_ORDER:
            raise ValueError(f"unsupported dimension {d!r}; use only {ui_stdlib._DIM_ORDER!r}")
    shape = _shape_of_nested(value)
    if len(shape) != len(dims):
        raise ValueError(
            f"{axis}_{dims}: rank mismatch; got array rank {len(shape)} for {len(dims)} dims"
        )
    return {"axis": axis, "dims": dims, "shape": shape, "data": value}


def _validate_index_bounds(vertices: list[list[float]], indices: list[list[int]], name: str) -> None:
    n = len(vertices)
    for i, group in enumerate(indices):
        for j, idx in enumerate(group):
            if idx < 0 or idx >= n:
                raise IndexError(f"{name}[{i}][{j}] index {idx} is out of bounds for {n} vertices")
