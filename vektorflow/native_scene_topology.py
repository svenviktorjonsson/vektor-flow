from __future__ import annotations

from typing import Any

from .runtime.axis_tagged import axis_tagged_data, axis_tagged_idx, axis_tagged_wrap, is_axis_tagged_value


def _require_number_list_value(value: Any, *, path: str, length: int | None = None) -> list[float]:
    value = axis_tagged_data(value)
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a list")
    out = [float(item) for item in value]
    if length is not None and len(out) != length:
        raise ValueError(f"{path} must contain exactly {length} numbers")
    return out


def require_number_matrix_value(value: Any, *, path: str, row_length: int) -> list[list[float]]:
    value = axis_tagged_data(value)
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a list")
    out: list[list[float]] = []
    for index, row in enumerate(value):
        if not isinstance(row, list):
            raise ValueError(f"{path}[{index}] must be a list")
        out.append(_require_number_list_value(row, path=f"{path}[{index}]", length=row_length))
    return out


def require_index_matrix_value(
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


def normalize_add_simplices_spec(value: Any, *, path: str) -> dict[str, list[list[int]]]:
    value = axis_tagged_data(value)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be a struct")
    edges = require_index_matrix_value(value.get("edges", []), path=f"{path}.edges", row_length=2) if "edges" in value else []
    faces = require_index_matrix_value(value.get("faces", []), path=f"{path}.faces", row_length=3) if "faces" in value else []
    volumes = require_index_matrix_value(value.get("volumes", []), path=f"{path}.volumes", row_length=4) if "volumes" in value else []
    if not edges and not faces and not volumes:
        raise ValueError(f"{path} must define edges, faces, or volumes")
    return {
        "edges": edges,
        "faces": faces,
        "volumes": volumes,
    }


def slice_axis_i_property(value: Any, index: int, *, path: str) -> Any:
    idx = axis_tagged_idx(value) if is_axis_tagged_value(value) else None
    data = axis_tagged_data(value)
    if idx is None:
        return data
    if idx != "i":
        raise ValueError(f"{path} only supports -> i when expanding indexed hull sets")
    if not isinstance(data, list):
        raise ValueError(f"{path} -> i must wrap a list")
    if index < 0 or index >= len(data):
        raise ValueError(f"{path} -> i index {index} out of range")
    return data[index]


def require_hull_point_sets(value: Any, *, path: str) -> tuple[list[list[list[float]]], str]:
    axis_name = axis_tagged_idx(value) if is_axis_tagged_value(value) else None
    data = axis_tagged_data(value)
    if axis_name in {None, "h"}:
        return [require_number_matrix_value(data, path=path, row_length=3)], "h"
    if axis_name == "hi":
        if not isinstance(data, list):
            raise ValueError(f"{path} -> hi must wrap a list of hull point sets")
        return [
            require_number_matrix_value(points, path=f"{path}[{index}]", row_length=3)
            for index, points in enumerate(data)
        ], "hi"
    raise ValueError(f"{path} supports -> h or -> hi only")


def _delaunay_faces_2d(points: list[list[float]], *, path: str) -> list[list[int]]:
    if len(points) < 3:
        raise ValueError(f"{path} -> d requires at least 3 points")
    xy = [(float(p[0]), float(p[1])) for p in points]
    min_x = min(p[0] for p in xy)
    max_x = max(p[0] for p in xy)
    min_y = min(p[1] for p in xy)
    max_y = max(p[1] for p in xy)
    dx = max_x - min_x
    dy = max_y - min_y
    delta = max(dx, dy)
    if delta <= 1e-9:
        raise ValueError(f"{path} -> d requires non-degenerate xy spread")
    mid_x = (min_x + max_x) * 0.5
    mid_y = (min_y + max_y) * 0.5
    super_pts = [
        (mid_x - (20.0 * delta), mid_y - delta),
        (mid_x, mid_y + (20.0 * delta)),
        (mid_x + (20.0 * delta), mid_y - delta),
    ]
    all_pts = xy + super_pts
    triangles: list[tuple[int, int, int]] = [(len(xy), len(xy) + 1, len(xy) + 2)]

    def circumcircle_contains(tri: tuple[int, int, int], p_index: int) -> bool:
        ax, ay = all_pts[tri[0]]
        bx, by = all_pts[tri[1]]
        cx, cy = all_pts[tri[2]]
        px, py = all_pts[p_index]
        d = 2.0 * ((ax * (by - cy)) + (bx * (cy - ay)) + (cx * (ay - by)))
        if abs(d) <= 1e-12:
            return False
        ax2ay2 = (ax * ax) + (ay * ay)
        bx2by2 = (bx * bx) + (by * by)
        cx2cy2 = (cx * cx) + (cy * cy)
        ux = (
            (ax2ay2 * (by - cy)) +
            (bx2by2 * (cy - ay)) +
            (cx2cy2 * (ay - by))
        ) / d
        uy = (
            (ax2ay2 * (cx - bx)) +
            (bx2by2 * (ax - cx)) +
            (cx2cy2 * (bx - ax))
        ) / d
        r2 = ((ux - ax) * (ux - ax)) + ((uy - ay) * (uy - ay))
        pd2 = ((ux - px) * (ux - px)) + ((uy - py) * (uy - py))
        return pd2 <= (r2 + 1e-9)

    for point_index in range(len(xy)):
        bad: list[tuple[int, int, int]] = [tri for tri in triangles if circumcircle_contains(tri, point_index)]
        boundary_edges: dict[tuple[int, int], tuple[int, int]] = {}
        for tri in bad:
            for edge in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                key = tuple(sorted(edge))
                if key in boundary_edges:
                    boundary_edges.pop(key, None)
                else:
                    boundary_edges[key] = edge
        triangles = [tri for tri in triangles if tri not in bad]
        for edge in boundary_edges.values():
            a, b = edge
            cross = ((all_pts[b][0] - all_pts[a][0]) * (all_pts[point_index][1] - all_pts[a][1])) - ((all_pts[b][1] - all_pts[a][1]) * (all_pts[point_index][0] - all_pts[a][0]))
            triangles.append((a, point_index, b) if cross > 0.0 else (a, b, point_index))
    final_tris = [tri for tri in triangles if tri[0] < len(xy) and tri[1] < len(xy) and tri[2] < len(xy)]
    unique: list[list[int]] = []
    seen: set[tuple[int, int, int]] = set()
    for tri in final_tris:
        key = tuple(sorted(tri))
        if key in seen:
            continue
        seen.add(key)
        unique.append([tri[0], tri[1], tri[2]])
    if not unique:
        raise ValueError(f"{path} -> d produced no triangles")
    return unique


def faces_to_edge_pairs(faces: list[list[int]]) -> list[list[int]]:
    edges: list[list[int]] = []
    seen: set[tuple[int, int]] = set()
    for face in faces:
        if len(face) != 3:
            continue
        for a, b in ((face[0], face[1]), (face[1], face[2]), (face[2], face[0])):
            key = (a, b) if a < b else (b, a)
            if key in seen:
                continue
            seen.add(key)
            edges.append([key[0], key[1]])
    return edges


def _volumes_to_edge_pairs(volumes: list[list[int]]) -> list[list[int]]:
    edges: list[list[int]] = []
    seen: set[tuple[int, int]] = set()
    for volume in volumes:
        if len(volume) != 4:
            continue
        for a, b in (
            (volume[0], volume[1]),
            (volume[0], volume[2]),
            (volume[0], volume[3]),
            (volume[1], volume[2]),
            (volume[1], volume[3]),
            (volume[2], volume[3]),
        ):
            key = (a, b) if a < b else (b, a)
            if key in seen:
                continue
            seen.add(key)
            edges.append([key[0], key[1]])
    return edges


def delaunay_simplices(points: list[list[float]], *, path: str) -> dict[str, list[list[int]]]:
    if len(points) < 3:
        raise ValueError(f"{path} -> d requires at least 3 points")
    z_values = [float(p[2]) for p in points]
    planar = max(z_values) - min(z_values) <= 1e-9
    if planar:
        faces = _delaunay_faces_2d(points, path=path)
        return {
            "edges": faces_to_edge_pairs(faces),
            "faces": faces,
            "volumes": [],
        }
    if len(points) < 4:
        raise ValueError(f"{path} -> d requires at least 4 non-coplanar points for 3D volumes")
    try:
        from scipy.spatial import Delaunay  # type: ignore[import-untyped]
    except Exception as exc:  # pragma: no cover
        raise ValueError(f"{path} -> d for 3D volumes requires scipy.spatial.Delaunay ({exc})") from exc
    try:
        triangulation = Delaunay(points)
    except Exception as exc:
        raise ValueError(f"{path} -> d failed to build 3D Delaunay volumes: {exc}") from exc
    simplices_raw = getattr(triangulation, "simplices", None)
    if simplices_raw is None:
        raise ValueError(f"{path} -> d produced no simplices")
    volumes: list[list[int]] = []
    seen: set[tuple[int, int, int, int]] = set()
    for simplex in simplices_raw.tolist():
        if not isinstance(simplex, list) or len(simplex) != 4:
            continue
        tet = [int(simplex[0]), int(simplex[1]), int(simplex[2]), int(simplex[3])]
        key = tuple(sorted(tet))
        if key in seen:
            continue
        seen.add(key)
        volumes.append(tet)
    if not volumes:
        raise ValueError(f"{path} -> d produced no tetrahedra")
    return {
        "edges": _volumes_to_edge_pairs(volumes),
        "faces": [],
        "volumes": volumes,
    }


__all__ = [
    "axis_tagged_wrap",
    "delaunay_simplices",
    "faces_to_edge_pairs",
    "normalize_add_simplices_spec",
    "require_hull_point_sets",
    "require_index_matrix_value",
    "require_number_matrix_value",
    "slice_axis_i_property",
]
