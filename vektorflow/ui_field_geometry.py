"""Pure field-geometry builders for ``ui.add(...)`` style meshes."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from itertools import product
from typing import Any

_DIM_ORDER = "tijkuvw"
_MESH_CHANNEL_RE = re.compile(r"^([xyz])(?:_([tijkuvw]+))?$")
_COLOR_NAMES: dict[str, tuple[float, float, float, float]] = {
    "white": (1.0, 1.0, 1.0, 1.0),
    "black": (0.0, 0.0, 0.0, 1.0),
    "red": (1.0, 0.1, 0.1, 1.0),
    "green": (0.15, 0.85, 0.15, 1.0),
    "blue": (0.15, 0.35, 1.0, 1.0),
    "yellow": (1.0, 0.9, 0.1, 1.0),
    "cyan": (0.1, 0.9, 0.9, 1.0),
    "magenta": (0.9, 0.1, 0.9, 1.0),
    "orange": (1.0, 0.5, 0.05, 1.0),
    "gray": (0.5, 0.5, 0.5, 1.0),
    "grey": (0.5, 0.5, 0.5, 1.0),
}
_TIME_BOUNDARY_MODES = frozenset({"mirror", "repeat", "reset", "stop"})


@dataclass(frozen=True, slots=True)
class FieldTopologyPolicy:
    volume_surface_mode: str = "boundary-only"


def _normalize_time_boundary(value: Any) -> str:
    mode = str(value or "stop").strip().lower().replace("-", "_")
    if mode not in _TIME_BOUNDARY_MODES:
        allowed = ", ".join(sorted(_TIME_BOUNDARY_MODES))
        raise ValueError(f"time boundary must be one of: {allowed}")
    return mode


def _resolve_time_index(time_value: Any, time_count: int, *, boundary: Any = "stop") -> int:
    count = max(1, int(time_count))
    idx = int(round(float(time_value)))
    mode = _normalize_time_boundary(boundary)
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


def parse_field_channels_and_meta(kwargs: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    channels: dict[str, dict[str, Any]] = {}
    meta: dict[str, Any] = {}
    for key, value in kwargs.items():
        match = _MESH_CHANNEL_RE.match(str(key))
        if match:
            axis = match.group(1)
            dims = str(match.group(2) or "")
            channels[axis] = _parse_mesh_channel(axis, dims, value)
        else:
            meta[str(key)] = value
    missing = [axis for axis in ("x", "y", "z") if axis not in channels]
    if missing:
        raise ValueError(f"ui.add(...) missing channels: {', '.join(missing)}")
    return channels, meta


def build_field_mesh_geometry(
    channels: dict[str, dict[str, Any]],
    meta: dict[str, Any],
    *,
    time_index: int = 0,
    topology_policy: FieldTopologyPolicy | None = None,
) -> dict[str, Any]:
    policy = topology_policy or FieldTopologyPolicy()
    canonical_dims = [d for d in _DIM_ORDER if any(d in channels[a]["dims"] for a in ("x", "y", "z"))]
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
        for size in sizes:
            if size not in (1, target):
                raise ValueError(f"incompatible broadcast for dim {d!r}: sizes={sizes}")
        dim_sizes[d] = target

    time_count = int(dim_sizes.get("t", 1))
    current_t = _resolve_time_index(
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
            size = int(ch["shape"][k])
            full_i = idx_map.get(d, 0)
            use_idxs.append(0 if size == 1 else full_i)
        return float(_nested_get(ch["data"], tuple(use_idxs)))

    rgba = _parse_color_rgba(meta.get("color"))
    interpolation = bool(meta.get("interpolation", False))

    points: list[tuple[float, float, float]] = []
    vindex: dict[tuple[int, ...], int] = {}
    for i, idx in enumerate(_iter_multi_index(cshape)):
        point = (_sample("x", idx), _sample("y", idx), _sample("z", idx))
        points.append(point)
        vindex[idx] = i

    manifold_dims = [d for d in "uvw" if d in dim_sizes and dim_sizes[d] > 1]
    manifold_dim_count = len(manifold_dims)
    vertex_size, edge_width = _overlay_size_policy(meta, manifold_dim_count)
    base_indices: list[int] = []
    topology = "point-list"

    def _idx(base: dict[str, int]) -> int:
        tup = tuple(base.get(d, 0) for d in sample_dims)
        return int(vindex[tup])

    if len(manifold_dims) == 0:
        topology = "point-list"
        base_indices = list(range(len(points)))
    elif len(manifold_dims) == 1:
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
                        if policy.volume_surface_mode == "boundary-only":
                            _extend_boundary_faces(
                                base_indices, base, _idx, dim_sizes, du, dv, dw, u, v, w
                            )
                        else:
                            raise ValueError(
                                f"unsupported volume surface mode {policy.volume_surface_mode!r}"
                            )
        for i in range(0, len(base_indices), 3):
            base_indices[i + 1], base_indices[i + 2] = base_indices[i + 2], base_indices[i + 1]

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
        "time_boundary": _normalize_time_boundary(
            meta.get("time_boundary", meta.get("t_boundary", meta.get("time_mode", meta.get("t_mode", "stop"))))
        ),
        "time_count": time_count,
        "time_index": current_t,
        "manifold_dim_count": manifold_dim_count,
        "solid_volume": manifold_dim_count >= 3,
        "vertex_size": vertex_size,
        "edge_width": edge_width,
    }


def _overlay_size_policy(meta: dict[str, Any], manifold_dim_count: int) -> tuple[float, float]:
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


def _nonnegative_float(value: Any, name: str) -> float:
    out = float(value)
    if out < 0:
        raise ValueError(f"{name} must be non-negative")
    return out


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


def _shape_of_nested(value: Any) -> tuple[int, ...]:
    if not isinstance(value, (list, tuple)):
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


def _parse_mesh_channel(axis: str, dims: str, value: Any) -> dict[str, Any]:
    if len(set(dims)) != len(dims):
        raise ValueError(f"duplicate dimensions in {axis}_{dims!s}")
    for d in dims:
        if d not in _DIM_ORDER:
            raise ValueError(f"unsupported dimension {d!r}; use only {_DIM_ORDER!r}")
    shape = _shape_of_nested(value)
    if len(shape) != len(dims):
        raise ValueError(
            f"{axis}_{dims}: rank mismatch; got array rank {len(shape)} for {len(dims)} dims"
        )
    return {"axis": axis, "dims": dims, "shape": shape, "data": value}


def _parse_color_rgba(color: Any) -> tuple[float, float, float, float]:
    if color is None:
        return (0.8, 0.8, 0.8, 1.0)
    if isinstance(color, (list, tuple)) and len(color) >= 3:
        r = float(color[0]); g = float(color[1]); b = float(color[2])
        a = float(color[3]) if len(color) >= 4 else 1.0
        if max(abs(r), abs(g), abs(b), abs(a)) > 1.0:
            r /= 255.0; g /= 255.0; b /= 255.0
            if a > 1.0:
                a /= 255.0
        return (r, g, b, a)
    s = str(color).strip().lower()
    if s in _COLOR_NAMES:
        return _COLOR_NAMES[s]
    if s.startswith("#"):
        h = s[1:]
        if len(h) == 3:
            h = f"{h[0]}{h[0]}{h[1]}{h[1]}{h[2]}{h[2]}"
        if len(h) == 6:
            n = int(h, 16)
            return (((n >> 16) & 255) / 255.0, ((n >> 8) & 255) / 255.0, (n & 255) / 255.0, 1.0)
    return (0.8, 0.8, 0.8, 1.0)


def _normalize3(x: float, y: float, z: float) -> tuple[float, float, float]:
    m = math.sqrt(x * x + y * y + z * z)
    if m <= 1e-12:
        return (0.0, 0.0, 1.0)
    return (x / m, y / m, z / m)


def _face_normal(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
    c: tuple[float, float, float],
) -> tuple[float, float, float]:
    ux, uy, uz = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    vx, vy, vz = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    nx = uy * vz - uz * vy
    ny = uz * vx - ux * vz
    nz = ux * vy - uy * vx
    return _normalize3(nx, ny, nz)
