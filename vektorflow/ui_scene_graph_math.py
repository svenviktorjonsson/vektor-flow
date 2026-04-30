"""Pure scene-graph math helpers shared by 2D and 3D UI nodes."""

from __future__ import annotations

from dataclasses import dataclass
import math

Affine2D = tuple[float, float, float, float, float, float]
Matrix4x4 = tuple[float, ...]
Vec2 = tuple[float, float]
Vec3 = tuple[float, float, float]

IDENTITY_AFFINE_2D: Affine2D = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
IDENTITY_MATRIX_4X4: Matrix4x4 = (
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
)


@dataclass(frozen=True, slots=True)
class Transform2D:
    translation: Vec2 = (0.0, 0.0)
    rotation_degrees: float = 0.0
    scale: Vec2 = (1.0, 1.0)


@dataclass(frozen=True, slots=True)
class Transform3D:
    translation: Vec3 = (0.0, 0.0, 0.0)
    rotation_degrees_xyz: Vec3 = (0.0, 0.0, 0.0)
    scale: Vec3 = (1.0, 1.0, 1.0)


@dataclass(frozen=True, slots=True)
class ResolvedAffine2D:
    local: Affine2D
    world: Affine2D


@dataclass(frozen=True, slots=True)
class ResolvedModelMatrix3D:
    local: Matrix4x4
    world: Matrix4x4

    @property
    def world_translation(self) -> Vec3:
        return extract_translation_3d(self.world)


def compose_transform_2d(transform: Transform2D) -> Affine2D:
    return multiply_affine_2d(
        translation_affine_2d(*transform.translation),
        multiply_affine_2d(
            rotation_affine_2d(transform.rotation_degrees),
            scale_affine_2d(*transform.scale),
        ),
    )


def resolve_affine_2d(
    transform: Transform2D,
    *,
    parent_world: Affine2D | None = None,
) -> ResolvedAffine2D:
    local_affine = compose_transform_2d(transform)
    world_affine = local_affine if parent_world is None else compose_parent_child_2d(parent_world, local_affine)
    return ResolvedAffine2D(local=local_affine, world=world_affine)


def world_affine_2d(
    transform: Transform2D,
    *,
    parent_world: Affine2D | None = None,
) -> Affine2D:
    return resolve_affine_2d(transform, parent_world=parent_world).world


def resolve_affine_2d_from_scene_fields(
    *,
    translation: Vec2 = (0.0, 0.0),
    rotation_degrees: float = 0.0,
    scale: Vec2 = (1.0, 1.0),
    parent_world: Affine2D | None = None,
) -> ResolvedAffine2D:
    return resolve_affine_2d(
        Transform2D(
            translation=tuple(float(value) for value in translation),
            rotation_degrees=float(rotation_degrees),
            scale=tuple(float(value) for value in scale),
        ),
        parent_world=parent_world,
    )


def world_affine_2d_from_scene_fields(
    *,
    translation: Vec2 = (0.0, 0.0),
    rotation_degrees: float = 0.0,
    scale: Vec2 = (1.0, 1.0),
    parent_world: Affine2D | None = None,
) -> Affine2D:
    return resolve_affine_2d_from_scene_fields(
        translation=translation,
        rotation_degrees=rotation_degrees,
        scale=scale,
        parent_world=parent_world,
    ).world


def compose_transform_3d(transform: Transform3D) -> Matrix4x4:
    return multiply_matrix4(
        translation_matrix4(*transform.translation),
        multiply_matrix4(
            rotation_matrix4_xyz(*transform.rotation_degrees_xyz),
            scale_matrix4(*transform.scale),
        ),
    )


def local_model_matrix_from_scene_fields(
    *,
    center: Vec3 = (0.0, 0.0, 0.0),
    rotation: Vec3 = (0.0, 0.0, 0.0),
    scale: Vec3 = (1.0, 1.0, 1.0),
) -> Matrix4x4:
    return resolve_model_matrix_3d_from_scene_fields(
        center=center,
        rotation=rotation,
        scale=scale,
    ).local


def resolve_model_matrix_3d(
    transform: Transform3D,
    *,
    parent_world: Matrix4x4 | None = None,
) -> ResolvedModelMatrix3D:
    local_matrix = compose_transform_3d(transform)
    world_matrix = local_matrix if parent_world is None else compose_parent_child_3d(parent_world, local_matrix)
    return ResolvedModelMatrix3D(local=local_matrix, world=world_matrix)


def world_model_matrix(
    transform: Transform3D,
    *,
    parent_world: Matrix4x4 | None = None,
) -> Matrix4x4:
    return resolve_model_matrix_3d(transform, parent_world=parent_world).world


def resolve_model_matrix_3d_from_scene_fields(
    *,
    center: Vec3 = (0.0, 0.0, 0.0),
    rotation: Vec3 = (0.0, 0.0, 0.0),
    scale: Vec3 = (1.0, 1.0, 1.0),
    parent_world: Matrix4x4 | None = None,
) -> ResolvedModelMatrix3D:
    return resolve_model_matrix_3d(
        Transform3D(
            translation=tuple(float(value) for value in center),
            rotation_degrees_xyz=tuple(float(value) for value in rotation),
            scale=tuple(float(value) for value in scale),
        ),
        parent_world=parent_world,
    )


def world_model_matrix_from_scene_fields(
    *,
    center: Vec3 = (0.0, 0.0, 0.0),
    rotation: Vec3 = (0.0, 0.0, 0.0),
    scale: Vec3 = (1.0, 1.0, 1.0),
    parent_world: Matrix4x4 | None = None,
) -> Matrix4x4:
    return resolve_model_matrix_3d_from_scene_fields(
        center=center,
        rotation=rotation,
        scale=scale,
        parent_world=parent_world,
    ).world


def accumulate_world_model_matrices(transforms: tuple[Transform3D, ...] | list[Transform3D]) -> tuple[Matrix4x4, ...]:
    if not transforms:
        return ()
    local_matrices = [compose_transform_3d(transform) for transform in transforms]
    return accumulate_world_matrix4(local_matrices)


def accumulate_world_model_matrices_from_scene_fields(
    nodes: tuple[tuple[Vec3, Vec3, Vec3], ...] | list[tuple[Vec3, Vec3, Vec3]],
) -> tuple[Matrix4x4, ...]:
    return accumulate_world_model_matrices(
        [
            Transform3D(
                translation=tuple(float(value) for value in center),
                rotation_degrees_xyz=tuple(float(value) for value in rotation),
                scale=tuple(float(value) for value in scale),
            )
            for center, rotation, scale in nodes
        ]
    )


def compose_parent_child_2d(parent_world: Affine2D, child_local: Affine2D) -> Affine2D:
    return multiply_affine_2d(parent_world, child_local)


def compose_parent_child_3d(parent_world: Matrix4x4, child_local: Matrix4x4) -> Matrix4x4:
    return multiply_matrix4(parent_world, child_local)


def accumulate_world_affine_2d(local_transforms: tuple[Affine2D, ...] | list[Affine2D]) -> tuple[Affine2D, ...]:
    if not local_transforms:
        return ()
    world: list[Affine2D] = [local_transforms[0]]
    current = local_transforms[0]
    for local in local_transforms[1:]:
        current = compose_parent_child_2d(current, local)
        world.append(current)
    return tuple(world)


def accumulate_world_matrix4(local_transforms: tuple[Matrix4x4, ...] | list[Matrix4x4]) -> tuple[Matrix4x4, ...]:
    if not local_transforms:
        return ()
    world: list[Matrix4x4] = [local_transforms[0]]
    current = local_transforms[0]
    for local in local_transforms[1:]:
        current = compose_parent_child_3d(current, local)
        world.append(current)
    return tuple(world)


def translation_affine_2d(dx: float, dy: float) -> Affine2D:
    return (1.0, 0.0, 0.0, 1.0, float(dx), float(dy))


def scale_affine_2d(sx: float, sy: float) -> Affine2D:
    return (float(sx), 0.0, 0.0, float(sy), 0.0, 0.0)


def rotation_affine_2d(angle_degrees: float) -> Affine2D:
    radians = math.radians(float(angle_degrees))
    cosine = math.cos(radians)
    sine = math.sin(radians)
    return (cosine, sine, -sine, cosine, 0.0, 0.0)


def multiply_affine_2d(left: Affine2D, right: Affine2D) -> Affine2D:
    a1, b1, c1, d1, e1, f1 = left
    a2, b2, c2, d2, e2, f2 = right
    return (
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    )


def transform_point_2d(transform: Affine2D, point: Vec2) -> Vec2:
    a, b, c, d, e, f = transform
    x, y = point
    return (
        a * float(x) + c * float(y) + e,
        b * float(x) + d * float(y) + f,
    )


def translation_matrix4(x: float, y: float, z: float) -> Matrix4x4:
    return (
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        float(x), float(y), float(z), 1.0,
    )


def scale_matrix4(x: float, y: float, z: float) -> Matrix4x4:
    return (
        float(x), 0.0, 0.0, 0.0,
        0.0, float(y), 0.0, 0.0,
        0.0, 0.0, float(z), 0.0,
        0.0, 0.0, 0.0, 1.0,
    )


def rotation_matrix4_x(angle_degrees: float) -> Matrix4x4:
    radians = math.radians(float(angle_degrees))
    cosine = math.cos(radians)
    sine = math.sin(radians)
    return (
        1.0, 0.0, 0.0, 0.0,
        0.0, cosine, sine, 0.0,
        0.0, -sine, cosine, 0.0,
        0.0, 0.0, 0.0, 1.0,
    )


def rotation_matrix4_y(angle_degrees: float) -> Matrix4x4:
    radians = math.radians(float(angle_degrees))
    cosine = math.cos(radians)
    sine = math.sin(radians)
    return (
        cosine, 0.0, -sine, 0.0,
        0.0, 1.0, 0.0, 0.0,
        sine, 0.0, cosine, 0.0,
        0.0, 0.0, 0.0, 1.0,
    )


def rotation_matrix4_z(angle_degrees: float) -> Matrix4x4:
    radians = math.radians(float(angle_degrees))
    cosine = math.cos(radians)
    sine = math.sin(radians)
    return (
        cosine, sine, 0.0, 0.0,
        -sine, cosine, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    )


def rotation_matrix4_xyz(rx_degrees: float, ry_degrees: float, rz_degrees: float) -> Matrix4x4:
    return multiply_matrix4(
        multiply_matrix4(rotation_matrix4_z(rz_degrees), rotation_matrix4_y(ry_degrees)),
        rotation_matrix4_x(rx_degrees),
    )


def multiply_matrix4(left: Matrix4x4, right: Matrix4x4) -> Matrix4x4:
    if len(left) != 16 or len(right) != 16:
        raise ValueError("expected 4x4 matrices in flat column-major form")
    out = [0.0] * 16
    for col in range(4):
        for row in range(4):
            out[col * 4 + row] = (
                left[0 * 4 + row] * right[col * 4 + 0]
                + left[1 * 4 + row] * right[col * 4 + 1]
                + left[2 * 4 + row] * right[col * 4 + 2]
                + left[3 * 4 + row] * right[col * 4 + 3]
            )
    return tuple(out)


def transform_point_3d(transform: Matrix4x4, point: Vec3) -> Vec3:
    if len(transform) != 16:
        raise ValueError("expected 4x4 matrix in flat column-major form")
    x, y, z = (float(value) for value in point)
    return (
        transform[0] * x + transform[4] * y + transform[8] * z + transform[12],
        transform[1] * x + transform[5] * y + transform[9] * z + transform[13],
        transform[2] * x + transform[6] * y + transform[10] * z + transform[14],
    )


def extract_translation_3d(transform: Matrix4x4) -> Vec3:
    if len(transform) != 16:
        raise ValueError("expected 4x4 matrix in flat column-major form")
    return (float(transform[12]), float(transform[13]), float(transform[14]))


__all__ = [
    "Affine2D",
    "IDENTITY_AFFINE_2D",
    "IDENTITY_MATRIX_4X4",
    "Matrix4x4",
    "ResolvedAffine2D",
    "ResolvedModelMatrix3D",
    "Transform2D",
    "Transform3D",
    "accumulate_world_affine_2d",
    "accumulate_world_model_matrices",
    "accumulate_world_model_matrices_from_scene_fields",
    "accumulate_world_matrix4",
    "compose_parent_child_2d",
    "compose_parent_child_3d",
    "compose_transform_2d",
    "compose_transform_3d",
    "extract_translation_3d",
    "local_model_matrix_from_scene_fields",
    "multiply_affine_2d",
    "multiply_matrix4",
    "resolve_affine_2d",
    "resolve_affine_2d_from_scene_fields",
    "resolve_model_matrix_3d",
    "resolve_model_matrix_3d_from_scene_fields",
    "rotation_affine_2d",
    "rotation_matrix4_x",
    "rotation_matrix4_xyz",
    "rotation_matrix4_y",
    "rotation_matrix4_z",
    "scale_affine_2d",
    "scale_matrix4",
    "transform_point_2d",
    "transform_point_3d",
    "translation_affine_2d",
    "translation_matrix4",
    "world_affine_2d",
    "world_affine_2d_from_scene_fields",
    "world_model_matrix",
    "world_model_matrix_from_scene_fields",
]
