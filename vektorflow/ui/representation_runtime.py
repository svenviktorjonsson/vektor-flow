"""UI representation runtime helpers.

This module owns representation refresh and lowering helpers so the Python
``Display`` object can move toward orchestration-only behavior.
"""

from __future__ import annotations

import math
from itertools import product
from typing import Any

from vektorflow.runtime.axis_tagged import AxisTaggedValue


def _ui():
    from vektorflow.stdlib import ui as ui_stdlib

    return ui_stdlib


FIELD_TIME_BOUNDARY_MODES = frozenset({"mirror", "repeat", "reset", "stop"})


def normalize_field_mesh_time_boundary(value: Any) -> str:
    mode = str(value or "stop").strip().lower().replace("-", "_")
    if mode not in FIELD_TIME_BOUNDARY_MODES:
        allowed = ", ".join(sorted(FIELD_TIME_BOUNDARY_MODES))
        raise ValueError(f"time boundary must be one of: {allowed}")
    return mode


def resolve_field_mesh_time_index(
    time_value: Any,
    time_count: int,
    *,
    boundary: Any = "stop",
) -> int:
    count = max(1, int(time_count))
    idx = int(round(float(time_value)))
    mode = normalize_field_mesh_time_boundary(boundary)
    if count <= 1:
        return 0
    if mode == "stop":
        return max(0, min(idx, count - 1))
    if mode == "repeat":
        return idx % count
    if mode == "reset":
        return idx if 0 <= idx < count else 0
    period = 2 * (count - 1)
    ping = idx % period
    return ping if ping < count else period - ping


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
    current_t = resolve_field_mesh_time_index(
        time_index,
        time_count,
        boundary=meta.get("time_boundary", meta.get("t_boundary", meta.get("time_mode", meta.get("t_mode", "stop")))),
    )
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

    def _sample_rgba(idx_tuple: tuple[int, ...]) -> tuple[float, float, float, float]:
        if "c" not in channels:
            return rgba
        ch = channels["c"]
        if not ch["dims"]:
            return ui_stdlib._parse_color_rgba(ch["data"])
        idx_map = {d: 0 for d in canonical_dims}
        idx_map["t"] = current_t
        for i, d in enumerate(sample_dims):
            idx_map[d] = idx_tuple[i]
        use_idxs: list[int] = []
        for k, d in enumerate(ch["dims"]):
            sz = int(ch["shape"][k])
            full_i = idx_map.get(d, 0)
            use_idxs.append(0 if sz == 1 else full_i)
        return ui_stdlib._parse_color_rgba(_nested_get(ch["data"], tuple(use_idxs)))

    def _sample_vertex_width(idx_tuple: tuple[int, ...]) -> float:
        ch = meta.get("vertex_width_channel")
        if not isinstance(ch, dict):
            return 0.0
        if not ch["dims"]:
            return _nonnegative_float(ch["data"], "vertex_width")
        idx_map = {d: 0 for d in canonical_dims}
        idx_map["t"] = current_t
        for i, d in enumerate(sample_dims):
            idx_map[d] = idx_tuple[i]
        use_idxs: list[int] = []
        for k, d in enumerate(ch["dims"]):
            sz = int(ch["shape"][k])
            full_i = idx_map.get(d, 0)
            use_idxs.append(0 if sz == 1 else full_i)
        return _nonnegative_float(_nested_get(ch["data"], tuple(use_idxs)), "vertex_width")

    rgba = ui_stdlib._parse_color_rgba(meta.get("color"))
    interpolation = bool(meta.get("interpolation", False))

    points: list[tuple[float, float, float]] = []
    point_rgba: list[tuple[float, float, float, float]] = []
    point_widths: list[float] = []
    vindex: dict[tuple[int, ...], int] = {}
    for i, idx in enumerate(_iter_multi_index(cshape)):
        x = _sample("x", idx)
        y = _sample("y", idx)
        z = _sample("z", idx)
        points.append((x, y, z))
        point_rgba.append(_sample_rgba(idx))
        point_widths.append(_sample_vertex_width(idx))
        vindex[idx] = i

    manifold_dims = [d for d in "uvw" if d in dim_sizes and dim_sizes[d] > 1]
    manifold_dim_count = len(manifold_dims)
    vertex_size, edge_width = _overlay_size_policy(meta, manifold_dim_count)
    base_indices: list[int] = []
    topology = "point-list"
    representation = str(meta.get("representation", meta.get("topology_mode", "")) or "").strip().lower()
    if representation in ("vertex", "vertices", "points", "point-list", "point_list"):
        representation = "vertices"
    elif representation in ("edge", "edges", "wire", "wireframe", "line-list", "line_list"):
        representation = "edges"
    elif representation in ("face", "faces", "surface", "triangle-list", "triangle_list"):
        representation = "faces"
    else:
        representation = ""

    def _idx(base: dict[str, int]) -> int:
        tup = tuple(base.get(d, 0) for d in sample_dims)
        return int(vindex[tup])

    if representation == "vertices":
        topology = "point-list"
        base_indices = list(range(len(points)))
    elif representation == "edges" or (not representation and len(manifold_dims) == 1):
        topology = "line-list"
        for du in manifold_dims:
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
    elif len(manifold_dims) == 0:
        topology = "point-list"
        base_indices = list(range(len(points)))
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
                        _extend_boundary_faces(
                            base_indices, base, _idx, dim_sizes, du, dv, dw, u, v, w
                        )

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
                prgba = point_rgba[i]
                vertices.extend([p[0], p[1], p[2], nx, ny, nz, prgba[0], prgba[1], prgba[2], prgba[3]])
            indices = list(base_indices)
        else:
            t = 0
            while t < len(base_indices):
                if (
                    t + 5 < len(base_indices)
                    and base_indices[t + 3] == base_indices[t]
                    and base_indices[t + 4] == base_indices[t + 2]
                ):
                    ia, ib, ic = base_indices[t], base_indices[t + 1], base_indices[t + 2]
                    id_ = base_indices[t + 5]
                    a, b, c, d = points[ia], points[ib], points[ic], points[id_]
                    nx, ny, nz = _face_normal(a, b, c)
                    quad_rgba = _avg_rgba([point_rgba[ia], point_rgba[ib], point_rgba[ic], point_rgba[id_]])
                    base = len(vertices) // 10
                    for p in (a, b, c, a, c, d):
                        vertices.extend([p[0], p[1], p[2], nx, ny, nz, quad_rgba[0], quad_rgba[1], quad_rgba[2], quad_rgba[3]])
                    indices.extend([base, base + 1, base + 2, base + 3, base + 4, base + 5])
                    t += 6
                    continue
                ia, ib, ic = base_indices[t], base_indices[t + 1], base_indices[t + 2]
                a, b, c = points[ia], points[ib], points[ic]
                nx, ny, nz = _face_normal(a, b, c)
                tri_rgba = _avg_rgba([point_rgba[ia], point_rgba[ib], point_rgba[ic]])
                base = len(vertices) // 10
                for p in (a, b, c):
                    vertices.extend([p[0], p[1], p[2], nx, ny, nz, tri_rgba[0], tri_rgba[1], tri_rgba[2], tri_rgba[3]])
                indices.extend([base, base + 1, base + 2])
                t += 3
    else:
        for i, p in enumerate(points):
            prgba = point_rgba[i]
            vertices.extend([p[0], p[1], p[2], 0.0, 0.0, 1.0, prgba[0], prgba[1], prgba[2], prgba[3]])
        indices = list(base_indices)

    alpha = float(rgba[3])
    if point_rgba:
        alpha = max(float(prgba[3]) for prgba in point_rgba)

    return {
        "vertices": vertices,
        "indices": indices,
        "topology": topology,
        "interpolation": interpolation,
        "alpha": alpha,
        "time_boundary": normalize_field_mesh_time_boundary(
            meta.get("time_boundary", meta.get("t_boundary", meta.get("time_mode", meta.get("t_mode", "stop"))))
        ),
        "time_count": time_count,
        "time_index": current_t,
        "manifold_dim_count": manifold_dim_count,
        "solid_volume": manifold_dim_count >= 3,
        "vertex_size": vertex_size,
        "edge_width": edge_width,
        "vertex_widths": point_widths,
    }


def _extend_boundary_faces(
    indices: list[int],
    base: dict[str, int],
    idx_fn: Any,
    dim_sizes: dict[str, int],
    du: str,
    dv: str,
    dw: str,
    u: int,
    v: int,
    w: int,
) -> None:
    def vertex(uu: int, vv: int, ww: int) -> int:
        base[du], base[dv], base[dw] = uu, vv, ww
        return idx_fn(base)

    c000 = vertex(u, v, w)
    c100 = vertex(u + 1, v, w)
    c010 = vertex(u, v + 1, w)
    c110 = vertex(u + 1, v + 1, w)
    c001 = vertex(u, v, w + 1)
    c101 = vertex(u + 1, v, w + 1)
    c011 = vertex(u, v + 1, w + 1)
    c111 = vertex(u + 1, v + 1, w + 1)

    if u == 0:
        indices.extend([c000, c010, c011, c000, c011, c001])
    if u == dim_sizes[du] - 2:
        indices.extend([c100, c101, c111, c100, c111, c110])
    if v == 0:
        indices.extend([c000, c001, c101, c000, c101, c100])
    if v == dim_sizes[dv] - 2:
        indices.extend([c010, c110, c111, c010, c111, c011])
    if w == 0:
        indices.extend([c000, c100, c110, c000, c110, c010])
    if w == dim_sizes[dw] - 2:
        indices.extend([c001, c011, c111, c001, c111, c101])


def _avg_rgba(samples: list[tuple[float, float, float, float]]) -> tuple[float, float, float, float]:
    if not samples:
        return (1.0, 1.0, 1.0, 1.0)
    inv = 1.0 / float(len(samples))
    return (
        sum(float(s[0]) for s in samples) * inv,
        sum(float(s[1]) for s in samples) * inv,
        sum(float(s[2]) for s in samples) * inv,
        sum(float(s[3]) for s in samples) * inv,
    )


def _overlay_size_policy(meta: dict[str, Any], manifold_dim_count: int) -> tuple[float, float]:
    if str(meta.get("render_mode", "")).strip().lower() in {"line", "native_line", "line_list", "line-list"}:
        return (
            _nonnegative_float(meta.get("vertex_size", 0.0), "vertex_size"),
            _nonnegative_float(meta.get("edge_width", 1.0), "edge_width"),
        )
    if manifold_dim_count == 0:
        default_vertex_size = 4.0
        default_edge_width = 0.0
    elif manifold_dim_count == 1:
        default_vertex_size = 0.0
        default_edge_width = 4.0
    else:
        default_vertex_size = 0.0
        default_edge_width = 0.0
    return (
        _nonnegative_float(meta.get("vertex_size", default_vertex_size), "vertex_size"),
        _nonnegative_float(meta.get("edge_width", default_edge_width), "edge_width"),
    )


def _normalize_field_mesh_render_mode(value: Any) -> str:
    mode = str(value or "proxy_geometry").strip().lower()
    if mode in ("proxy_geometry", "proxy", "proxy_mesh", "geometry", "real_geometry"):
        return "proxy_geometry"
    if mode in ("line", "native_line", "line_list", "line-list"):
        return "line"
    if mode in ("marker", "impostor", "marker_impostor", "analytical_marker"):
        return "marker_impostor"
    raise ValueError("render_mode must be 'proxy_geometry', 'marker_impostor', or 'line'")


def _normalize_field_mesh_marker_space(value: Any, render_mode: str) -> str:
    default_space = "pixel" if render_mode == "marker_impostor" else "world"
    space = str(value or default_space).strip().lower()
    if space in ("pixel", "pixels", "screen"):
        return "pixel"
    if space in ("world", "scene"):
        return "world"
    raise ValueError("marker_space must be 'pixel' or 'world'")


def _nonnegative_float(value: Any, name: str) -> float:
    out = float(value)
    if out < 0:
        raise ValueError(f"{name} must be non-negative")
    return out


def parse_field_mesh_channels_and_meta(kwargs: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    ui_stdlib = _ui()
    channels: dict[str, dict[str, Any]] = {}
    meta: dict[str, Any] = {}
    for key, value in kwargs.items():
        key_str = str(key)
        m = ui_stdlib._MESH_CHANNEL_RE.match(key_str)
        if m:
            axis = m.group(1)
            dims = str(m.group(2) or "")
            if isinstance(value, AxisTaggedValue):
                inferred_dims = value.idx
                if dims and dims != inferred_dims:
                    raise ValueError(
                        f"ui.add(...) channel {key!r} conflicts with value indices {inferred_dims!r}"
                    )
                dims = inferred_dims
                value = value.data
            channels[axis] = _parse_mesh_channel(axis, dims, value)
        elif key_str.startswith("vertex_width"):
            suffix = key_str[len("vertex_width") :]
            dims = suffix[1:] if suffix.startswith("_") else ""
            if isinstance(value, AxisTaggedValue):
                inferred_dims = value.idx
                if dims and dims != inferred_dims:
                    raise ValueError(
                        f"ui.add(...) channel {key!r} conflicts with value indices {inferred_dims!r}"
                    )
                dims = inferred_dims
                value = value.data
            meta["vertex_width_channel"] = _parse_mesh_channel("vertex_width", dims, value)
        else:
            meta[key] = value
    return channels, meta


def build_field_mesh_from_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
    ui_stdlib = _ui()
    channels, meta = parse_field_mesh_channels_and_meta(kwargs)

    missing = [a for a in ("x", "y", "z") if a not in channels]
    if missing:
        raise ValueError(f"ui.add(...) missing channels: {', '.join(missing)}")

    geom = build_field_mesh_geometry(
        channels,
        meta,
        time_index=int(meta.get("t", 0)),
    )
    render_mode = _normalize_field_mesh_render_mode(meta.get("render_mode", "proxy_geometry"))
    marker_space = _normalize_field_mesh_marker_space(meta.get("marker_space"), render_mode)
    casts_shadow = bool(meta.get("casts_shadow", render_mode != "marker_impostor"))
    receives_lighting = bool(meta.get("receives_lighting", True))

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
        "color": ui_stdlib._color_to_payload(meta.get("color")),
        "time_boundary": geom["time_boundary"],
        "time_count": geom["time_count"],
        "time_index": geom["time_index"],
        "manifold_dim_count": geom["manifold_dim_count"],
        "solid_volume": geom["solid_volume"],
        "vertex_size": geom["vertex_size"],
        "edge_width": geom["edge_width"],
        "vertex_widths": geom["vertex_widths"],
        "render_mode": render_mode,
        "marker_space": marker_space,
        "aspect": str(meta.get("aspect", "")),
        "axis_full_frame": bool(meta.get("axis_full_frame", False)),
        "axis_box": bool(meta.get("axis_box", False)),
        "axis_screen_extend": bool(meta.get("axis_screen_extend", False)),
        "axis_screen_inset_px": float(meta.get("axis_screen_inset_px", 20.0)),
        "axis_margin_px": float(meta.get("axis_margin_px", 58.0)),
        "axis_bind_id": str(meta.get("axis_bind_id", "")),
        "axis_ticks": meta.get("axis_ticks"),
        "axis_plot2d": meta.get("axis_plot2d"),
        "axis_plot3d": meta.get("axis_plot3d"),
        "axis3d_helper_lines": bool(meta.get("axis3d_helper_lines", False)),
        "mode3d": bool(meta.get("mode3d", True)),
        "casts_shadow": casts_shadow,
        "receives_lighting": receives_lighting,
        "depth_write": bool(meta.get("depth_write", False)),
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
    if axis == "c":
        if len(shape) == len(dims) + 1 and shape[-1] in (3, 4):
            return {
                "axis": axis,
                "dims": dims,
                "shape": shape[:-1],
                "color_width": int(shape[-1]),
                "data": value,
            }
        raise ValueError(
            f"{axis}_{dims}: color channel must have trailing rgb/rgba width; got shape {shape}"
        )
    if axis == "vertex_width":
        if len(shape) != len(dims):
            raise ValueError(
                f"{axis}_{dims}: rank mismatch; got array rank {len(shape)} for {len(dims)} dims"
            )
        return {"axis": axis, "dims": dims, "shape": shape, "data": value}
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
