"""Generic GPU physics pipeline contracts.

These contracts describe the buffers and compute stages that the VKF runtime
can bind for particle, rigid-body, and later arbitrary-shape collision solving.
They are intentionally shape-agnostic: discs/spheres are one narrowphase, while
polygon/polyhedron contacts can use the same broadphase and contact matrix
buffers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


PhysicsDimension = Literal[2, 3]
PhysicsStageKind = Literal[
    "integrate",
    "clear_broadphase",
    "bin_bodies",
    "build_contact_candidates",
    "solve_contacts",
    "write_render_instances",
]
GpuScalarType = Literal["f32", "u32", "i32"]


@dataclass(frozen=True, slots=True)
class GpuFieldSpec:
    name: str
    scalar: GpuScalarType
    lanes: int
    offset: int
    description: str = ""


@dataclass(frozen=True, slots=True)
class GpuStructLayout:
    name: str
    stride_f32: int
    fields: tuple[GpuFieldSpec, ...]


@dataclass(frozen=True, slots=True)
class GpuPhysicsStageSpec:
    name: str
    kind: PhysicsStageKind
    entry_point: str
    reads: tuple[str, ...]
    writes: tuple[str, ...]
    description: str


@dataclass(frozen=True, slots=True)
class GpuPhysicsPipelineSpec:
    name: str
    dimension: PhysicsDimension
    workgroup_size: int
    body_layout: GpuStructLayout
    collider_layout: GpuStructLayout
    contact_layout: GpuStructLayout
    params_layout: GpuStructLayout
    stages: tuple[GpuPhysicsStageSpec, ...]
    collision_matrix_supported: bool
    rigid_body_supported: bool
    wgsl: str


BODY_STATE_2D_LAYOUT = GpuStructLayout(
    "PhysicsBodyState2D",
    16,
    (
        GpuFieldSpec("position_radius", "f32", 4, 0, "x, y, bounding radius, inverse mass"),
        GpuFieldSpec("velocity_flags", "f32", 4, 4, "vx, vy, angular velocity, flags"),
        GpuFieldSpec("force_torque", "f32", 4, 8, "fx, fy, torque, material id"),
        GpuFieldSpec("orientation_inertia", "f32", 4, 12, "angle, inverse inertia, restitution, friction"),
    ),
)


BODY_STATE_3D_LAYOUT = GpuStructLayout(
    "PhysicsBodyState3D",
    24,
    (
        GpuFieldSpec("position_radius", "f32", 4, 0, "x, y, z, bounding radius"),
        GpuFieldSpec("linear_velocity_inv_mass", "f32", 4, 4, "vx, vy, vz, inverse mass"),
        GpuFieldSpec("orientation_quat", "f32", 4, 8, "qx, qy, qz, qw"),
        GpuFieldSpec("angular_velocity", "f32", 4, 12, "wx, wy, wz, flags"),
        GpuFieldSpec("force_material", "f32", 4, 16, "fx, fy, fz, material id"),
        GpuFieldSpec("torque_restitution_friction", "f32", 4, 20, "tx, ty, restitution, friction"),
    ),
)


COLLIDER_LAYOUT = GpuStructLayout(
    "PhysicsCollider",
    8,
    (
        GpuFieldSpec("kind_body", "u32", 4, 0, "shape kind, body index, vertex offset, vertex count"),
        GpuFieldSpec("shape_data", "f32", 4, 4, "radius/half extents/support offset depending on shape kind"),
    ),
)


CONTACT_LAYOUT = GpuStructLayout(
    "PhysicsContact",
    16,
    (
        GpuFieldSpec("body_pair", "u32", 4, 0, "body a, body b, collider a, collider b"),
        GpuFieldSpec("normal_depth", "f32", 4, 4, "nx, ny/nz, depth, time of impact"),
        GpuFieldSpec("point_a", "f32", 4, 8, "contact point on body a"),
        GpuFieldSpec("material", "f32", 4, 12, "restitution, friction, constraint row, flags"),
    ),
)


PARAMS_LAYOUT = GpuStructLayout(
    "PhysicsStepParams",
    16,
    (
        GpuFieldSpec("world_dt", "f32", 4, 0, "world bounds scale and dt"),
        GpuFieldSpec("gravity_counts", "f32", 4, 4, "gx, gy/gz, body count, collider count"),
        GpuFieldSpec("grid", "f32", 4, 8, "cell size, cols, rows, layers"),
        GpuFieldSpec("solver", "f32", 4, 12, "iterations, contact band, max contacts, mode"),
    ),
)


DEFAULT_GPU_PHYSICS_STAGES = (
    GpuPhysicsStageSpec(
        "integrate",
        "integrate",
        "integrate",
        ("bodies", "params"),
        ("bodies",),
        "Apply forces, gravity, velocity, and boundary response.",
    ),
    GpuPhysicsStageSpec(
        "clear_broadphase",
        "clear_broadphase",
        "clear_cells",
        ("params",),
        ("cell_counts",),
        "Reset uniform-grid broadphase bins.",
    ),
    GpuPhysicsStageSpec(
        "bin_bodies",
        "bin_bodies",
        "fill_cells",
        ("bodies", "colliders", "params"),
        ("cell_counts", "cell_items"),
        "Insert colliders into spatial bins using conservative bounds.",
    ),
    GpuPhysicsStageSpec(
        "build_contact_candidates",
        "build_contact_candidates",
        "build_contact_candidates",
        ("cell_counts", "cell_items", "colliders", "params"),
        ("contacts", "contact_count"),
        "Create candidate contact pairs without solving them.",
    ),
    GpuPhysicsStageSpec(
        "solve_contacts",
        "solve_contacts",
        "solve_contacts",
        ("bodies", "colliders", "contacts", "collision_matrix", "params"),
        ("bodies", "contacts"),
        "Apply normal/friction impulses from candidate contacts and material pair data.",
    ),
    GpuPhysicsStageSpec(
        "write_render_instances",
        "write_render_instances",
        "write_render_instances",
        ("bodies", "colliders"),
        ("render_instances",),
        "Write renderable impostor or mesh instance data from simulated state.",
    ),
)


def gpu_physics_pipeline_spec(dimension: PhysicsDimension = 2, *, wgsl: str = "") -> GpuPhysicsPipelineSpec:
    return GpuPhysicsPipelineSpec(
        name=f"gpu_physics_{dimension}d",
        dimension=dimension,
        workgroup_size=128,
        body_layout=BODY_STATE_2D_LAYOUT if dimension == 2 else BODY_STATE_3D_LAYOUT,
        collider_layout=COLLIDER_LAYOUT,
        contact_layout=CONTACT_LAYOUT,
        params_layout=PARAMS_LAYOUT,
        stages=DEFAULT_GPU_PHYSICS_STAGES,
        collision_matrix_supported=True,
        rigid_body_supported=True,
        wgsl=wgsl,
    )
