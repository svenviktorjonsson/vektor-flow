import json
from pathlib import Path

import pytest

from vektorflow.native_overlay_scene_bundle import try_build_native_overlay_scene_program


NATIVE_SCENE_SOURCE = """
native_scene: (
    kind: "face_edge_vertex_drag",
    frame_id: "geom_frame",
    title: "Face / Edge / Vertex Drag",
    rect: [0.12, 0.12, 0.62, 0.62],
    aspect: "equal",
    points: [[0.24, 0.24], [0.76, 0.24], [0.76, 0.76], [0.24, 0.76]],
    edge_pairs: [[0, 1], [1, 2], [2, 3], [3, 0]],
    styles: (
        face: (
            base_color: [1, 0, 0, 1],
            overlay_colors: (
                selected: [1, 1, 0.2, 0.72],
                hover: [1, 0.95, 0.35, 0.48],
                none: [1, 0, 0, 0]
            )
        ),
        edge: (
            base_color: [0, 0.8, 0, 1],
            overlay_colors: (
                selected: [1, 1, 0.2, 0.78],
                hover: [0.35, 1, 0.35, 0.54],
                none: [0, 0.8, 0, 0]
            ),
            base_scale: 0.01,
            overlay_scales: (selected: 0.01, hover: 0.01, none: 0.01)
        ),
        vertex: (
            base_color: [0, 0.4, 1, 1],
            overlay_colors: (
                selected: [1, 1, 0.2, 0.82],
                hover: [1, 1, 1, 0.62],
                none: [0, 0.4, 1, 0]
            ),
            base_scale: 0.022,
            overlay_scales: (selected: 0.022, hover: 0.022, none: 0.022)
        )
    ),
    drag: (
        face_vertices: [0, 1, 2, 3],
        edge_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]],
        vertex_vertices: [[0], [1], [2], [3]],
        preserve_selected_on_plain_down: true
    )
)
"""


CUBE_HOVER_SOURCE = """
native_scene: (
    kind: "cube_hover",
    frame_id: "cube_frame",
    title: "3D Cube Hover",
    rect: [0.08, 0.10, 0.58, 0.72],
    debug_frame_id: "cube_hover_debug",
    debug_title: "Cube Hover Context",
    debug_rect: [0.70, 0.10, 0.24, 0.42],
    edge_radius: 0.085,
    vertex_radius: 0.135,
    styles: (
        face_base: [1, 0, 0, 1],
        face_hover: [1, 0.95, 0, 1],
        edge_base: [0, 0.82, 0.12, 1],
        edge_hover: [1, 1, 0, 1],
        vertex_base: [0.05, 0.32, 1, 1],
        vertex_hover: [1, 1, 1, 1]
    )
)
"""


CUBE_LIGHTING_SOURCE = """
native_scene: (
    kind: "cube_lighting_camera",
    frame_id: "cube_lighting_frame",
    title: "3D Cube Lighting + Camera",
    rect: [0.08, 0.10, 0.58, 0.72],
    debug_frame_id: "cube_lighting_debug",
    debug_title: "Lighting Hover Context",
    debug_rect: [0.70, 0.10, 0.24, 0.42],
    edge_radius: 0.085,
    vertex_radius: 0.135,
    camera: (
        pos: [3.2, 2.25, 4.2],
        target: [0, 0, 0],
        fov: 40,
        up: [0, 1, 0]
    ),
    light: (
        target: [0, 0, 0],
        orbit: true,
        orbit_radius: 4.8,
        height: 3.3,
        theta: 0.45,
        angular_velocity: 0.9,
        model: "blinn_phong",
        color: [1.0, 0.93, 0.78, 1.0]
    ),
    styles: (
        face_base: [1, 0, 0, 1],
        face_hover: [1, 0.95, 0, 1],
        edge_base: [0, 0.82, 0.12, 1],
        edge_hover: [1, 1, 0, 1],
        vertex_base: [0.05, 0.32, 1, 1],
        vertex_hover: [1, 1, 1, 1]
    )
)
"""


CUBE_SHADOW_PLANE_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "scene_3d_frame",
    title: "Cube + Plane + Hard Shadow",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.15],
        size: 1.6,
        face_color: [0.96, 0.22, 0.16, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [3.9, -5.6, 3.2],
        target: [0.0, 0.0, 0.9],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            target: [0.0, 0.0, 0.9],
            radius: 4.8,
            height: 4.0,
            theta: 0.2,
            angular_velocity: 0.55,
            model: "blinn_phong",
            color: [1.0, 0.95, 0.84, 1.0],
            casts_shadow: true,
            source_radius: 0.18,
            spread: 1.0
        ),
        (
            target: [0.0, 0.0, 0.9],
            radius: 3.8,
            height: 2.2,
            theta: 3.1,
            angular_velocity: -0.22,
            model: "blinn_phong",
            color: [0.30, 0.36, 0.52, 1.0],
            casts_shadow: false,
            source_radius: 0.10,
            spread: 0.8
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
"""


SCENE_3D_VIEWS_SOURCE = """
native_scene: (
    kind: "scene_3d_views",
    views: [
        (
            frame_id: "front_camera_frame",
            title: "Front Camera",
            rect: [0.06, 0.10, 0.42, 0.72],
            camera: (
                pos: [0.0, -4.45, 3.2],
                target: [0.0, 1.4, 1.0],
                fov: 34.0,
                up: [0.0, 0.0, 1.0]
            )
        ),
        (
            frame_id: "back_camera_frame",
            title: "Back Camera",
            rect: [0.52, 0.10, 0.42, 0.72],
            camera: (
                pos: [0.0, 10.5, 3.5],
                target: [0.0, 3.5, 3.5],
                fov: 34.0,
                up: [0.0, 0.0, 1.0]
            )
        )
    ],
    lights: [
        (
            kind: "point",
            target: [0.0, 3.5, 1.6],
            model: "blinn_phong",
            color: [1.0, 0.93, 0.78, 1.0],
            intensity: 18.0,
            range: 24.0,
            theta: 0.15,
            angular_velocity: 1.8,
            pos_t: [[0.0, 6.8, 9.2], [-1.3397, 6.6665, 9.2]]
        )
    ],
    timing: (
        fps: 60,
        duration_seconds: 16.0,
        boundary: "repeat"
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.96, 0.96, 0.96, 1.0]
    ),
    object: (
        kind: "simplices",
        points: [[-3.5, 3.5, 0.0], [3.5, 3.5, 0.0]],
        add_simplices: (
            edges: [[0, 1]],
        ),
        show_edges: true,
        edge_width: 5.0,
        edge_caps: true,
        show_vertices: true,
        vertex_size: 5.0,
        edge_color: [0.12, 0.82, 0.22, 1.0],
        vertex_color: [0.12, 0.82, 0.22, 1.0],
        face_color: [0.0, 0.0, 0.0, 0.0]
    ),
    surfaces: [
        (
            center: [0.0, 3.5, 3.5],
            size: [7.0, 7.0],
            rotation: [90.0, 0.0, 0.0],
            color: [0.24, 0.26, 0.30, 0.35]
        )
    ],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
"""


FLASHLIGHT_CUBE_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "flashlight_cube_frame",
    title: "Flashlight Cube",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.15],
        size: 1.6,
        face_color: [0.96, 0.22, 0.16, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.26, 0.30, 0.36, 1.0]
    ),
    camera: (
        pos: [3.5, -4.8, 2.8],
        target: [0.0, 0.0, 0.8],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "spot",
            target: [0.0, 0.0, 0.8],
            radius: 4.2,
            height: 3.1,
            theta: 0.35,
            angular_velocity: 0.30,
            model: "blinn_phong",
            color: [1.0, 0.96, 0.88, 1.0],
            intensity: 58.0,
            inner_cone_deg: 10.0,
            outer_cone_deg: 18.0,
            range: 10.0,
            casts_shadow: true,
            source_radius: 0.10,
            spread: 1.0
        ),
        (
            kind: "point",
            pos: [-2.6, -1.8, 2.1],
            target: [0.0, 0.0, 0.8],
            model: "blinn_phong",
            color: [0.35, 0.42, 0.62, 1.0],
            power: 10.0,
            range: 8.0,
            casts_shadow: false
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


RANDOM_HULL_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "random_hull_frame",
    title: "Random Hull Orbit",
    rect: [0.08, 0.08, 0.72, 0.78],
    object: (
        kind: "random_hull",
        center: [0.0, 0.0, 1.25],
        radius: 1.05,
        count: 100,
        seed: 13,
        stretch: [1.0, 0.82, 1.32],
        jitter: 0.30,
        face_color: [0.94, 0.94, 0.94, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [3.9, -5.6, 3.2],
        target: [0.0, 0.0, 1.0],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: true
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


CONVEX_HULL_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "convex_hull_frame",
    title: "Convex Hull Orbit",
    rect: [0.08, 0.08, 0.72, 0.78],
    object: (
        kind: "convex_hull",
        points: [
            [-0.98, 0.22, 0.44],
            [0.65, 0.17, 0.37],
            [-0.35, -0.09, 2.21],
            [-0.36, -0.83, 0.74],
            [-0.07, 1.02, 0.58],
            [1.22, 0.06, 1.37],
            [-0.39, -0.10, -0.22],
            [0.84, -0.41, 2.29]
        ],
        face_color: [0.94, 0.94, 0.94, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [3.9, -5.6, 3.2],
        target: [0.0, 0.0, 1.0],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: true
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


HULL_SUGAR_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "hull_sugar_frame",
    title: "Hull Sugar Orbit",
    rect: [0.08, 0.08, 0.72, 0.78],
    object: (
        points: [
            [-0.98, 0.22, 0.44],
            [0.65, 0.17, 0.37],
            [-0.35, -0.09, 2.21],
            [-0.36, -0.83, 0.74],
            [-0.07, 1.02, 0.58],
            [1.22, 0.06, 1.37],
            [-0.39, -0.10, -0.22],
            [0.84, -0.41, 2.29]
        ] -> h,
        face_color: [0.94, 0.94, 0.94, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [3.9, -5.6, 3.2],
        target: [0.0, 0.0, 1.0],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: true
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


HULL_SET_SUGAR_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "hull_set_sugar_frame",
    title: "Hull Set Sugar Orbit",
    rect: [0.08, 0.08, 0.72, 0.78],
    object: (
        points: [
            [
                [-0.98, 0.22, 0.44],
                [0.65, 0.17, 0.37],
                [-0.35, -0.09, 2.21],
                [-0.36, -0.83, 0.74]
            ],
            [
                [1.02, 0.12, 0.54],
                [2.65, 0.07, 0.47],
                [1.61, -0.14, 2.28],
                [1.55, -0.92, 0.81]
            ]
        ] -> hi,
        face_color_i: [
            [0.94, 0.94, 0.94, 1.0],
            [0.84, 0.92, 1.0, 1.0]
        ]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [3.9, -5.6, 3.2],
        target: [0.8, 0.0, 1.0],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: true
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


SIMPLICES_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "simplices_frame",
    title: "Simplices Orbit",
    rect: [0.08, 0.08, 0.72, 0.78],
    object: (
        kind: "simplices",
        points: [
            [-0.8, -0.6, 0.2],
            [0.7, -0.5, 0.2],
            [0.1, 0.8, 0.2],
            [0.0, 0.0, 1.8]
        ],
        add_simplices: (
            edges: [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]],
            faces: [[0, 1, 2]],
            volumes: [[0, 1, 2, 3]]
        ),
        face_color: [0.94, 0.94, 0.94, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [3.9, -5.6, 3.2],
        target: [0.0, 0.0, 1.0],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: true
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


DELAUNAY_2D_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "delaunay_2d_frame",
    title: "Delaunay 2D",
    rect: [0.08, 0.08, 0.72, 0.78],
    object: (
        points: [
            [-1.4, -0.9, 0.2],
            [-0.2, -1.2, 0.2],
            [0.9, -0.8, 0.2],
            [1.5, 0.0, 0.2],
            [0.7, 1.1, 0.2],
            [-0.4, 1.3, 0.2],
            [-1.3, 0.3, 0.2],
            [0.1, 0.2, 0.2]
        ] -> d,
        face_color: [0.94, 0.94, 0.94, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [0.0, -0.01, 6.2],
        target: [0.0, 0.0, 0.2],
        fov: 18.0,
        up: [0.0, 1.0, 0.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 0.0, 5.6],
            power: 18000.0,
            range: 16.0,
            casts_shadow: false
        )
    ],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


DELAUNAY_3D_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "delaunay_3d_frame",
    title: "Delaunay 3D",
    rect: [0.08, 0.08, 0.72, 0.78],
    object: (
        points: [
            [-1.1, -0.8, 0.1],
            [-0.4, -1.0, 0.6],
            [0.6, -0.9, -0.2],
            [1.1, -0.1, 0.7],
            [0.9, 0.8, -0.4],
            [0.1, 1.0, 0.3],
            [-0.8, 0.9, -0.1],
            [-1.0, 0.1, 0.8],
            [0.0, 0.0, 1.2],
            [0.2, -0.1, -0.9]
        ] -> d,
        face_color: [0.94, 0.60, 0.22, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: -1.8,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [3.9, -5.6, 3.2],
        target: [0.0, 0.0, 0.1],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: false
        )
    ],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


EMBEDDED_PROPERTY_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "embedded_property_frame",
    title: "Embedded Property Scene",
    rect: [0.08, 0.08, 0.72, 0.78],
    object: (
        kind: "convex_hull",
        properties: (
            verts: [
                [-0.98, 0.22, 0.44],
                [0.65, 0.17, 0.37],
                [-0.35, -0.09, 2.21],
                [-0.36, -0.83, 0.74]
            ],
            tint: [0.94, 0.94, 0.94, 1.0]
        ),
        embedding: (
            points: "verts",
            face_color: "tint"
        )
    ),
    plane: (
        properties: (
            where: [0.0, 0.0],
            span: 7.0,
            level: 0.0,
            tint: [0.20, 0.22, 0.26, 1.0]
        ),
        embedding: (
            center: "where",
            size: "span",
            z: "level",
            color: "tint"
        )
    ),
    camera: (
        properties: (
            eye: [3.9, -5.6, 3.2],
            look: [0.0, 0.0, 1.0],
            angle: 34.0,
            zen: [0.0, 0.0, 1.0]
        ),
        embedding: (
            pos: "eye",
            target: "look",
            fov: "angle",
            up: "zen"
        )
    ),
    lights: [
        (
            properties: (
                location: [0.0, 4.8, 4.8],
                watt: 24000.0,
                max_range: 18.0,
                shadow_on: true,
                beam: [1.0, 0.95, 0.84, 1.0]
            ),
            embedding: (
                pos: "location",
                power: "watt",
                range: "max_range",
                casts_shadow: "shadow_on",
                color: "beam"
            )
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


LIGHT_EYE_TRACK_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "cube_light_eye_test_frame",
    title: "Cube Light Eye Test",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.15],
        size: 1.6,
        face_color: [0.94, 0.24, 0.18, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.30, 0.34, 0.40, 1.0]
    ),
    camera: (
        pos: [0.0, -5.8, 2.35],
        target: [0.0, 0.0, 0.95],
        fov: 32.0,
        up: [0.0, 0.0, 1.0]
    ),
    timing: (
        fps: 14,
        duration_seconds: 1.35,
        boundary: "repeat"
    ),
    lights: [
        (
            kind: "spot",
            target: [0.0, 0.0, 0.95],
            pos_t: [
                [3.02, 4.93, 0.5],
                [2.45, 5.26, 0.5],
                [1.78, 5.52, 0.5],
                [1.10, 5.70, 0.5]
            ],
            color_t: [
                [1.0, 0.2, 0.2, 1.0],
                [0.2, 1.0, 0.2, 1.0],
                [0.2, 0.4, 1.0, 1.0],
                [1.0, 0.9, 0.2, 1.0]
            ],
            intensity: 220.0,
            inner_cone_deg: 4.5,
            outer_cone_deg: 6.0,
            range: 20.0,
            casts_shadow: true
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


LIGHTS_I_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "lights_i_frame",
    title: "Lights I",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.15],
        size: 1.6,
        face_color: [0.94, 0.24, 0.18, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.30, 0.34, 0.40, 1.0]
    ),
    lights_i: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: true
        ),
        (
            kind: "point",
            pos: [0.0, -4.8, 4.8],
            power: 6000.0,
            range: 18.0,
            casts_shadow: false
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


LIGHTS_IJ_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "lights_ij_frame",
    title: "Lights IJ",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.15],
        size: 1.6,
        face_color: [0.94, 0.24, 0.18, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.30, 0.34, 0.40, 1.0]
    ),
    lights_ij: [
        [
            (kind: "point", pos: [-2.5, 4.2, 4.6], power: 8000.0, range: 18.0, casts_shadow: true)
        ],
        [
            (kind: "point", pos: [2.5, 4.2, 4.6], power: 8000.0, range: 18.0, casts_shadow: false)
        ]
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


LIGHTS_ARROW_I_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "lights_arrow_i_frame",
    title: "Lights Arrow I",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.15],
        size: 1.6,
        face_color: [0.94, 0.24, 0.18, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.30, 0.34, 0.40, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, 4.8, 4.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: true
        ),
        (
            kind: "point",
            pos: [0.0, -4.8, 4.8],
            power: 6000.0,
            range: 18.0,
            casts_shadow: false
        )
    ] -> i,
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


LIGHTS_ARROW_IJ_SOURCE = """
native_scene: (
    kind: "scene_3d",
    frame_id: "lights_arrow_ij_frame",
    title: "Lights Arrow IJ",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.15],
        size: 1.6,
        face_color: [0.94, 0.24, 0.18, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.30, 0.34, 0.40, 1.0]
    ),
    lights: [
        [
            (kind: "point", pos: [-2.5, 4.2, 4.6], power: 8000.0, range: 18.0, casts_shadow: true)
        ],
        [
            (kind: "point", pos: [2.5, 4.2, 4.6], power: 8000.0, range: 18.0, casts_shadow: false)
        ]
    ] -> ij,
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 1.0],
        lift: 0.002
    )
)
"""


OCEAN_WAVE_SOURCE = """
native_scene: (
    kind: "ocean_wave",
    frame_id: "ocean_wave_frame",
    title: "Ocean Wave Native",
    rect: [0.06, 0.08, 0.72, 0.82],
    surface: (
        u_min: -6.0,
        u_max: 6.0,
        u_steps: 25,
        v_min: -6.0,
        v_max: 6.0,
        v_steps: 25
    ),
    timing: (
        fps: 30,
        duration_seconds: 10.0,
        boundary: "repeat"
    ),
    camera: (
        target: [0.0, 0.0, 0.0],
        radius: 9.6,
        height: 3.2,
        theta: 0.10,
        turns_per_cycle: 1.0,
        fov: 42.0,
        up: [0.0, 0.0, 1.0]
    ),
    light: (
        target: [0.0, 0.0, 0.0],
        radius: 7.1,
        height: 4.6,
        theta: 0.45,
        turns_per_cycle: 2.0,
        model: "blinn_phong",
        color: [1.0, 0.93, 0.78, 1.0]
    ),
    styles: (
        face_color: [0.06, 0.55, 0.94, 1.0],
        edge_color: [0.08, 0.78, 1.0, 0.95],
        edge_width: 1.6
    ),
    waves: [
        (kind: "linear", fn: "sin", amplitude: 0.38, ux: 0.78, uy: 0.0, time_freq: 1.35),
        (kind: "linear", fn: "cos", amplitude: 0.24, ux: 0.0, uy: 1.04, time_freq: -0.82),
        (kind: "linear", fn: "sin", amplitude: 0.16, ux: 0.56, uy: 0.56, time_freq: 0.61),
        (kind: "radial2", fn: "cos", amplitude: 0.08, radial2: 0.075, time_freq: -0.33)
    ]
)
"""


DIMENSION_MIX_SOURCE = """
native_scene: (
    kind: "dimension_mix",
    frames: (
        points: (frame_id: "dim0_points", title: "0D", rect: [0.02, 0.03, 0.47, 0.44]),
        lines: (frame_id: "dim1_lines", title: "1D", rect: [0.51, 0.03, 0.47, 0.44]),
        surface: (frame_id: "dim2_surface", title: "2D", rect: [0.02, 0.50, 0.47, 0.44]),
        volume: (frame_id: "dim3_volume", title: "3D", rect: [0.51, 0.50, 0.47, 0.44])
    ),
    cloud: (
        count_i: 7,
        count_j: 7,
        count_k: 7,
        sigma: 0.24,
        seed: 7,
        color: [1.0, 0.55, 0.10, 1.0],
        vertex_size: 0.1
    ),
    helix: (
        u_steps: 60,
        radius: 0.72,
        pitch: 0.065,
        turn_step: 0.30,
        color: [0.15, 0.85, 0.25, 1.0],
        edge_width: 0.04,
        vertex_size: 0.08
    ),
    planes: (
        u_steps: 25,
        v_steps: 25,
        layers: [-1.0, 1.0],
        face_color: [0.08, 0.78, 0.95, 0.95],
        edge_color: [0.04, 0.94, 1.0, 1.0],
        edge_width: 0.03
    ),
    volume: (
        u_steps: 20,
        v_steps: 20,
        w_steps: 20,
        face_color: [0.92, 0.18, 0.88, 0.95]
    )
)
"""


UNKNOWN_NATIVE_SCENE_SOURCE = """
native_scene: (
    kind: "not_a_real_scene",
    frame_id: "mystery_frame",
    title: "Unknown Scene",
    rect: [0.1, 0.1, 0.4, 0.4]
)
"""


def test_face_edge_vertex_scene_is_declared_by_vkf_not_filename(tmp_path: Path) -> None:
    path = tmp_path / "not_the_example_name.vkf"
    path.write_text(NATIVE_SCENE_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.session_name == "not-the-example-name"
    assert "FSM Debug" in program.runtime_packets_text
    assert "vf-native-scene-face-edge-vertex.js" in program.html_text
    assert "createFaceEdgeVertexSharedStore" not in program.html_text
    assert "vf-geom-ledger-transport.json" not in program.html_text


def test_face_edge_vertex_scene_does_not_use_filename_magic(tmp_path: Path) -> None:
    path = tmp_path / "ui_face_edge_vertex_drag.vkf"
    path.write_text(':: "not a native scene"', encoding="utf-8")

    assert try_build_native_overlay_scene_program(path) is None


def test_unknown_native_scene_kind_fails_with_clear_error(tmp_path: Path) -> None:
    path = tmp_path / "unknown_native_scene.vkf"
    path.write_text(UNKNOWN_NATIVE_SCENE_SOURCE, encoding="utf-8")

    with pytest.raises(ValueError, match=r"unsupported native_scene\.kind 'not_a_real_scene'"):
        try_build_native_overlay_scene_program(path)


def test_cube_hover_scene_runs_in_native_ui_runtime(tmp_path: Path) -> None:
    path = tmp_path / "ui_cube_hover.vkf"
    path.write_text(CUBE_HOVER_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.session_name == "ui-cube-hover"
    assert "vf-native-scene-cube-hover.js" in program.html_text
    assert "window.__vfNativeCubeHoverConfig" in program.html_text
    assert "Cube Hover Context" in program.runtime_packets_text
    assert program.geom_transport_text == ""
    assert program.geom_state_text == ""


def test_cube_lighting_scene_exposes_camera_and_orbit_light(tmp_path: Path) -> None:
    path = tmp_path / "ui_cube_lighting_camera.vkf"
    path.write_text(CUBE_LIGHTING_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.session_name == "ui-cube-lighting-camera"
    assert '"kind": "cube_lighting_camera"' in program.html_text
    assert '"pos": [3.2, 2.25, 4.2]' in program.html_text
    assert '"orbit": true' in program.html_text
    assert '"angular_velocity": 0.9' in program.html_text
    assert "Lighting Hover Context" in program.runtime_packets_text


def test_scene_3d_scene_runs_in_native_ui_runtime(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d.vkf"
    path.write_text(CUBE_SHADOW_PLANE_SOURCE.replace('kind: "scene_3d"', 'kind: "scene_3d"'), encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.session_name == "ui-scene-3d"
    assert "vf-native-scene.js" in program.html_text
    assert "window.__vfNativeSceneConfig" in program.html_text
    assert '"enabled": true' in program.html_text
    assert '"lights": [{' in program.html_text
    assert '"casts_shadow": false' in program.html_text
    assert '"source_radius": 0.18' in program.html_text
    assert '"spread": 0.8' in program.html_text
    assert '"meshes": [{' in program.html_text
    assert '"shadow_receivers": [{' in program.html_text
    assert '"scene_ir": {' in program.html_text
    assert '"frame": {"frame_id": "scene_3d_frame"' in program.html_text
    assert '"receiver_mesh": "plane_0"' in program.html_text
    assert '"policy_kind": "light_camera_depth_map"' in program.html_text
    assert '"policy_softness": "shadow_map_bias"' in program.html_text
    assert "Cube + Plane + Hard Shadow" in program.runtime_packets_text


def test_scene_3d_views_runs_as_multi_view_native_runtime(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_views.vkf"
    path.write_text(SCENE_3D_VIEWS_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.session_name == "ui-scene-3d-views"
    assert "window.__vfNativeSceneFramesArePacketOwned = true;" in program.html_text
    assert "window.__vfNativeSceneConfigs" in program.html_text
    assert 'vf-native-scene.js?v=' in program.html_text
    assert '"frame_id": "front_camera_frame"' in program.html_text
    assert '"frame_id": "back_camera_frame"' in program.html_text
    assert '"angular_velocity": 1.8' in program.html_text
    assert '"enabled": false' in program.html_text
    assert "Front Camera" in program.runtime_packets_text
    assert "Back Camera" in program.runtime_packets_text


def test_scene_3d_views_allows_per_view_surface_overrides(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_views_surface_override.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d_views",
    views: [
        (
            frame_id: "front_camera_frame",
            title: "Front Camera",
            rect: [0.06, 0.10, 0.42, 0.72],
            camera: (
                pos: [0.0, -3.5, 3.5],
                target: [0.0, 3.5, 3.5],
                fov: 34.0,
                up: [0.0, 0.0, 1.0]
            ),
            surfaces: [
                (
                    center: [0.0, 3.5, 3.5],
                    size: [7.0, 7.0],
                    rotation: [-90.0, 0.0, 0.0],
                    color: [0.24, 0.26, 0.30, 0.35],
                    surface_system: (
                        kind: "screen",
                        frame_ref: "back_camera_frame",
                        reverse_facing: true
                    )
                )
            ]
        ),
        (
            frame_id: "back_camera_frame",
            title: "Back Camera",
            rect: [0.52, 0.10, 0.42, 0.72],
            camera: (
                pos: [0.0, 10.5, 3.5],
                target: [0.0, 3.5, 3.5],
                fov: 34.0,
                up: [0.0, 0.0, 1.0]
            ),
            surfaces: [
                (
                    center: [0.0, 3.5, 3.5],
                    size: [7.0, 7.0],
                    rotation: [-90.0, 0.0, 0.0],
                    color: [0.24, 0.26, 0.30, 0.35]
                )
            ]
        )
    ],
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.96, 0.96, 0.96, 1.0]
    ),
    object: (
        kind: "simplices",
        points: [[-3.5, 3.5, 0.0], [3.5, 3.5, 0.0]],
        add_simplices: (
            edges: [[0, 1]],
        ),
        show_edges: true,
        edge_width: 5.0,
        edge_caps: true,
        show_vertices: true,
        vertex_size: 5.0,
        edge_color: [0.12, 0.82, 0.22, 1.0],
        vertex_color: [0.12, 0.82, 0.22, 1.0],
        face_color: [0.0, 0.0, 0.0, 0.0]
    ),
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    html = program.html_text
    compact = "".join(html.split())
    assert '"frame_id": "front_camera_frame"' in html
    assert '"frame_id": "back_camera_frame"' in html
    assert '"surface_system"' in html
    assert '"kind":"screen"' in compact
    assert '"frame_ref":"back_camera_frame"' in compact
    assert '"reverse_facing":true' in compact
    assert '"color":[0.24,0.26,0.3,0.35]' in compact


def test_scene_3d_camera_preserves_aperture_mirror_mesh_id(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_camera_aperture.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "aperture_frame",
    title: "Aperture",
    rect: [0.1, 0.1, 0.5, 0.5],
    camera: (
        pos: [0.0, -4.0, 3.5],
        target: [0.0, 3.5, 3.5],
        fov: 34.0,
        up: [0.0, 0.0, 1.0],
        aperture_mirror_mesh_id: "quad_0"
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.96, 0.96, 0.96, 1.0]
    ),
    surfaces: [
        (
            id: "quad_0",
            center: [0.0, 3.5, 3.5],
            size: [7.0, 7.0],
            rotation: [-90.0, 0.0, 0.0],
            color: [0.24, 0.26, 0.30, 0.35]
        )
    ],
    object: (
        kind: "simplices",
        points: [[-3.5, 3.5, 0.0], [3.5, 3.5, 0.0]],
        add_simplices: (
            edges: [[0, 1]],
        )
    ),
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    compact = "".join(program.html_text.split())
    assert '"aperture_mirror_mesh_id":"quad_0"' in compact


def test_scene_3d_views_hidden_source_view_stays_in_html_but_not_frame_packets(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_views_hidden_source.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d_views",
    views: [
        (
            frame_id: "hidden_source",
            visible: false,
            title: "",
            rect: [0.1, 0.1, 0.5, 0.5],
            aspect: "equal",
            camera: (
                pos: [0.0, 4.0, 3.0],
                target: [0.0, 0.0, 1.0],
                fov: 34.0,
                up: [0.0, 0.0, 1.0]
            )
        ),
        (
            frame_id: "main_view",
            title: "Main",
            rect: [0.1, 0.1, 0.5, 0.5],
            aspect: "equal",
            camera: (
                pos: [0.0, -4.0, 3.0],
                target: [0.0, 0.0, 1.0],
                fov: 34.0,
                up: [0.0, 0.0, 1.0]
            )
        )
    ],
    plane: (
        center: [0.0, 0.0],
        size: 4.0,
        z: 0.0,
        color: [1.0, 1.0, 1.0, 1.0]
    ),
    surfaces: [
        (
            center: [0.0, 0.0, 1.0],
            size: [2.0, 2.0],
            rotation: [-90.0, 0.0, 0.0],
            color: [0.8, 0.8, 0.8, 1.0]
        )
    ],
    lights: [],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.0],
        lift: 0.0
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert '"frame_id": "hidden_source"' in program.html_text
    packets = program.runtime_packets_text
    assert '"id": "main_view"' in packets
    assert '"id": "hidden_source"' not in packets


def test_scene_3d_camera_preserves_look_only_controls(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_camera_look_only.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "look_only_frame",
    title: "Look Only",
    rect: [0.1, 0.1, 0.5, 0.5],
    camera: (
        pos: [0.0, -4.0, 3.5],
        target: [0.0, 3.5, 3.5],
        fov: 34.0,
        up: [0.0, 0.0, 1.0],
        look_only_controls: true
    ),
    surfaces: [
        (
            center: [0.0, 3.5, 3.5],
            size: [7.0, 7.0],
            rotation: [-90.0, 0.0, 0.0],
            color: [0.24, 0.26, 0.30, 0.35]
        )
    ],
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.96, 0.96, 0.96, 1.0]
    ),
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    compact = "".join(program.html_text.split())
    assert '"look_only_controls":true' in compact


def test_scene_3d_camera_controls_mode_look_only_lowers_to_look_only_controls(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_camera_controls_mode.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "controls_mode_frame",
    title: "Controls Mode",
    rect: [0.1, 0.1, 0.5, 0.5],
    camera: (
        pos: [0.0, -4.0, 3.5],
        target: [0.0, 3.5, 3.5],
        fov: 34.0,
        up: [0.0, 0.0, 1.0],
        controls_mode: "look_only"
    ),
    surfaces: [
        (
            center: [0.0, 3.5, 3.5],
            size: [7.0, 7.0],
            rotation: [-90.0, 0.0, 0.0],
            color: [0.24, 0.26, 0.30, 0.35]
        )
    ],
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.96, 0.96, 0.96, 1.0]
    ),
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    compact = "".join(program.html_text.split())
    assert '"controls_mode":"look_only"' in compact
    assert '"look_only_controls":true' in compact


def test_scene_3d_camera_controls_mode_game_is_preserved(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_camera_controls_game.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "game_controls_frame",
    title: "Game Controls",
    rect: [0.1, 0.1, 0.5, 0.5],
    camera: (
        pos: [0.0, -4.0, 1.8],
        target: [0.0, 0.0, 1.8],
        fov: 60.0,
        up: [0.0, 0.0, 1.0],
        controls_mode: "game",
        speed: 3.2,
        sensitivity: 0.0022
    ),
    cubes: [
        (
            id: "grass_cube",
            center: [0.0, 0.0, -2.0],
            size: 4.0,
            face_color: [1.0, 1.0, 1.0, 1.0],
            texture: (
                kind: "grass",
                scale: [4.4, 4.4],
                color_a: [0.05, 0.18, 0.035, 1.0],
                color_b: [0.64, 0.88, 0.26, 1.0]
            )
        )
    ],
    plane: (
        center: [0.0, 0.0],
        size: 0.01,
        z: -20.0,
        color: [0.0, 0.0, 0.0, 0.0]
    ),
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    compact = "".join(program.html_text.split())
    assert '"controls_mode":"game"' in compact
    assert '"speed":3.2' in compact
    assert '"sensitivity":0.0022' in compact
    assert '"kind":"grass"' in compact


def test_grass_texture_cube_example_compiles() -> None:
    repo = Path(__file__).resolve().parents[1]
    program = try_build_native_overlay_scene_program(repo / "examples" / "114_grass_texture_cube.vkf")

    assert program is not None
    compact = "".join(program.html_text.split())
    assert '"frame_id":"grass_texture_cube_frame"' in compact
    assert '"controls_mode":"game"' in compact
    assert '"speed":4.6' in compact
    assert '"kind":"grass"' in compact
    assert '"id":"grass_field"' in compact
    assert '"roughness":0.99' in compact
    assert '"blade_length":1.1' in compact
    assert '"clump_density":1.22' in compact
    assert '"micro_shadow":0.52' in compact
    assert '"near_blades":true' in compact
    assert '"near_blade_count":140000' in compact
    assert '"background":[0.36,0.68,1.0,1.0]' in compact
    assert '"blue_sky_panel"' not in compact


def test_scene_3d_camera_fit_to_mesh_id_lowers_to_aperture_mirror_mesh_id(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_camera_fit_to_mesh.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "fit_to_mesh_frame",
    title: "Fit To Mesh",
    rect: [0.1, 0.1, 0.5, 0.5],
    camera: (
        pos: [0.0, -4.0, 3.5],
        target: [0.0, 3.5, 3.5],
        fov: 34.0,
        up: [0.0, 0.0, 1.0],
        fit_to_mesh_id: "quad_0"
    ),
    surfaces: [
        (
            id: "quad_0",
            center: [0.0, 3.5, 3.5],
            size: [7.0, 7.0],
            rotation: [-90.0, 0.0, 0.0],
            color: [0.24, 0.26, 0.30, 0.35]
        )
    ],
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.96, 0.96, 0.96, 1.0]
    ),
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    compact = "".join(program.html_text.split())
    assert '"aperture_mirror_mesh_id":"quad_0"' in compact


def test_scene_3d_camera_mirror_of_sugar_lowers_to_locked_reflected_camera(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_camera_mirror_of.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d_views",
    views: [
        (
            frame_id: "main_frame",
            title: "Main",
            rect: [0.06, 0.10, 0.42, 0.42],
            aspect: "equal",
            camera: (
                pos: [0.0, -4.2, 3.5],
                target: [0.0, 3.5, 3.5],
                fov: 34.0,
                    up: [0.0, 0.0, 1.0]
                ),
            surfaces: [
                (
                    center: [0.0, 3.5, 3.5],
                    size: [7.0, 7.0],
                    rotation: [-90.0, 0.0, 0.0],
                    color: [0.24, 0.26, 0.30, 0.35]
                )
            ]
        ),
        (
            frame_id: "mirror_frame",
            title: "Mirror",
            rect: [0.52, 0.10, 0.42, 0.42],
            aspect: "equal",
            camera: (
                fov: 34.0,
                up: [0.0, 0.0, 1.0],
                mirror_of: (
                    frame_id: "main_frame",
                    mesh_id: "quad_0"
                )
            ),
            surfaces: [
                (
                    center: [0.0, 3.5, 3.5],
                    size: [7.0, 7.0],
                    rotation: [-90.0, 0.0, 0.0],
                    color: [0.24, 0.26, 0.30, 0.35]
                )
            ]
        )
    ],
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.96, 0.96, 0.96, 1.0]
    ),
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    compact = "".join(program.html_text.split())
    assert '"reflect_of_frame_id":"main_frame"' in compact
    assert '"reflect_mirror_mesh_id":"quad_0"' in compact
    assert '"aperture_mirror_mesh_id":"quad_0"' in compact
    assert '"reflect_eye_only":true' in compact


def test_scene_3d_surface_mirror_camera_lowers_to_hidden_source_view(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_surface_mirror_camera.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "main_mirror_frame",
    title: "Mirror",
    rect: [0.10, 0.08, 0.76, 0.76],
    aspect: "equal",
    camera: (
        pos: [0.0, -4.8, 2.2],
        target: [0.0, 0.0, 0.0],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    surfaces: [
        (
            id: "mirror_face",
            center: [0.0, 0.0, 1.0],
            size: [2.0, 2.0],
            rotation: [-90.0, 0.0, 0.0],
            color: [0.24, 0.26, 0.30, 0.35],
            surface_system: (
                kind: "screen",
                reverse_facing: true,
                scale: [1.0, 1.0],
                camera: (
                    fov: 34.0,
                    up: [0.0, 0.0, 1.0],
                    mirror_of: (
                        frame_id: "main_mirror_frame",
                        mesh_id: "mirror_face",
                        reflect_eye_only: true,
                        lock_aperture_camera: true,
                        controls_enabled: false
                    )
                )
            )
        )
    ],
    plane: (
        center: [0.0, 0.0],
        size: 8.0,
        z: 0.0,
        color: [1.0, 1.0, 1.0, 1.0]
    ),
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    compact = "".join(program.html_text.split())
    packets = "".join(program.runtime_packets_text.split())
    assert 'window.__vfNativeSceneConfigs=' in compact
    assert '"frame_ref":"main_mirror_frame__surface_source_0"' in compact
    assert '"reflect_of_frame_id":"main_mirror_frame"' in compact
    assert '"reflect_mirror_mesh_id":"mirror_face"' in compact
    assert '"pos":[0.0,-4.8,2.2]' in compact
    assert '"pos":[0.0,4.8,2.2]' not in compact
    assert '"visible":false' in compact
    assert '"reverse_facing":true' in compact
    assert '"show_light_markers":false' in compact
    assert '"id":"main_mirror_frame__surface_source_0"' not in packets
    assert '"lock_aperture_camera":true' in compact
    assert '"controls_enabled":false' in compact
    assert '"flip_x":true' in compact
    assert compact.index('"frame_id":"main_mirror_frame"') < compact.index('"frame_id":"main_mirror_frame__surface_source_0"')


def test_scene_3d_mirror_compiler_does_not_pre_reflect_camera() -> None:
    repo = Path(__file__).resolve().parents[1]
    source = (repo / "vektorflow" / "native_overlay_scene_bundle.py").read_text(encoding="utf-8")
    assert "_surface_plane_point_normal" not in source
    assert "_reflect_point_across_plane" not in source
    assert "_rotate_vec3_zyx_deg" not in source


def test_scene_3d_shadow_receivers_use_declared_light_ids(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_shadow_light_ids.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "shadow_ids_frame",
    title: "Shadow IDs",
    rect: [0.10, 0.08, 0.76, 0.76],
    plane: (
        center: [0.0, 0.0],
        size: 8.0,
        z: 0.0,
        color: [1.0, 1.0, 1.0, 1.0]
    ),
    surfaces: [
        (
            id: "mirror_face",
            center: [0.0, 0.0, 1.0],
            size: [2.0, 2.0],
            rotation: [-90.0, 0.0, 0.0],
            color: [0.24, 0.26, 0.30, 0.35]
        )
    ],
    lights: [
        (
            id: "real_light",
            kind: "point",
            pos: [1.0, -2.0, 4.0],
            casts_shadow: true
        ),
        (
            id: "virtual_light",
            kind: "projected",
            pos: [1.0, 2.0, 4.0],
            casts_shadow: true,
            aperture_face_id: "mirror_face"
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    compact = "".join(program.html_text.split())
    assert '"lights":["real_light","virtual_light"]' in compact


def test_flashlight_scene_preserves_spotlight_fields(tmp_path: Path) -> None:
    path = tmp_path / "ui_flashlight_cube.vkf"
    path.write_text(FLASHLIGHT_CUBE_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.session_name == "ui-flashlight-cube"
    assert '"kind": "spot"' in program.html_text
    assert '"intensity": 58.0' in program.html_text
    assert '"inner_cone_deg": 10.0' in program.html_text
    assert '"outer_cone_deg": 18.0' in program.html_text
    assert '"range": 10.0' in program.html_text
    assert '"power": 10.0' in program.html_text
    assert "Flashlight Cube" in program.runtime_packets_text


def test_scene_3d_projected_light_preserves_aperture_face_fields(tmp_path: Path) -> None:
    path = tmp_path / "ui_projected_light.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "projected_light_frame",
    title: "Projected Light",
    rect: [0.10, 0.10, 0.72, 0.72],
    plane: (
        center: [0.0, 0.0],
        size: 8.0,
        z: 0.0,
        color: [1.0, 1.0, 1.0, 1.0]
    ),
    surfaces: [
        (
            id: "mirror_face",
            center: [0.0, 0.0, 1.0],
            size: [2.0, 2.0],
            rotation: [-90.0, 0.0, 0.0],
            color: [0.24, 0.26, 0.30, 0.35]
        )
    ],
    lights: [
        (
            kind: "projected",
            pos: [-2.2, 2.8, 5.4],
            target: [0.0, 0.0, 1.0],
            intensity: 42.0,
            source_radius: 0.18,
            spread: 1.0,
            aperture_face_id: "mirror_face",
            clip_epsilon_ratio: 0.0002
        )
    ],
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    compact = "".join(program.html_text.split())
    assert '"kind":"projected"' in compact
    assert '"aperture_mesh_id":"mirror_face"' in compact
    assert '"clip_epsilon_ratio":0.0002' in compact


def test_scene_3d_projected_light_rejects_absolute_clip_epsilon(tmp_path: Path) -> None:
    path = tmp_path / "projected_light_absolute_epsilon.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "projected_light_frame",
    title: "Projected Light",
    plane: (
        center: [0.0, 0.0],
        size: 8.0,
        z: 0.0,
        color: [1.0, 1.0, 1.0, 1.0]
    ),
    shadow: (
        enabled: true,
        color: [0.0, 0.0, 0.0, 0.30],
        lift: 0.002
    ),
    surfaces: [
        (
            id: "mirror_face",
            center: [0.0, 0.0, 1.0],
            size: [2.0, 2.0],
            rotation: [-90.0, 0.0, 0.0],
            color: [0.24, 0.26, 0.30, 0.35]
        )
    ],
    lights: [
        (
            kind: "projected",
            pos: [-2.2, 2.8, 5.4],
            target: [0.0, 0.0, 1.0],
            aperture_face_id: "mirror_face",
            clip_epsilon: 0.002
        )
    ]
)
""",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="clip_epsilon is absolute; use clip_epsilon_ratio"):
        try_build_native_overlay_scene_program(path)


def test_scene_3d_surface_mirror_preserves_backface_lighting_flag(tmp_path: Path) -> None:
    path = tmp_path / "ui_mirror_backface_flag.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "mirror_backface_frame",
    title: "Mirror Backface",
    rect: [0.10, 0.10, 0.72, 0.72],
    plane: (
        center: [0.0, 0.0],
        size: 2.0,
        z: 0.0,
        color: [1.0, 1.0, 1.0, 1.0]
    ),
    surfaces: [
        (
            id: "mirror_face",
            center: [0.0, 1.0, 1.0],
            size: [2.0, 2.0],
            rotation: [90.0, 0.0, 0.0],
            color: [0.7, 0.76, 0.86, 1.0],
            casts_shadow: true,
            receives_shadow: false,
            no_backface_specular: true,
            surface_system: (
                kind: "screen",
                frame_ref: "mirror_source"
            )
        )
    ],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.0],
        lift: 0.0
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    compact = "".join(program.html_text.split())
    assert '"casts_shadow":true' in compact
    assert '"receives_shadow":false' in compact
    assert '"no_backface_specular":true' in compact


def test_scene_3d_accepts_surfaces_and_rejects_quads_alias(tmp_path: Path) -> None:
    surfaces_path = tmp_path / "ui_surfaces_ok.vkf"
    surfaces_path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "surface_frame",
    title: "Surface Alias Test",
    rect: [0.08, 0.08, 0.72, 0.78],
    aspect: "equal",
    surfaces: [
        (
            center: [0.0, 0.0, 0.0],
            size: [4.0, 4.0],
            color: [1.0, 1.0, 1.0, 1.0]
        )
    ],
    plane: (
        center: [0.0, 0.0],
        size: 4.0,
        z: 0.0,
        visible: false,
        color: [0.0, 0.0, 0.0, 0.0]
    ),
    camera: (
        pos: [0.0, -6.0, 0.0],
        target: [0.0, 0.0, 0.0],
        up: [0.0, 0.0, 1.0],
        aperture_mirror_mesh_id: "plane_0"
    ),
    lights: [],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.0],
        lift: 0.0
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(surfaces_path)

    assert program is not None
    assert '"kind": "quad"' in program.html_text
    assert '"id": "plane_0"' in program.html_text
    assert '"aspect": "equal"' in program.runtime_packets_text

    quads_path = tmp_path / "ui_quads_bad.vkf"
    quads_path.write_text(surfaces_path.read_text(encoding="utf-8").replace("surfaces:", "quads:"), encoding="utf-8")

    with pytest.raises(ValueError, match="native_scene.scene_3d uses surfaces, not quads"):
        try_build_native_overlay_scene_program(quads_path)


def test_scene_3d_accepts_random_hull_object(tmp_path: Path) -> None:
    path = tmp_path / "ui_random_hull_orbit.vkf"
    path.write_text(RANDOM_HULL_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert '"kind": "random_hull"' in program.html_text
    assert '"count": 100' in program.html_text
    assert '"seed": 13' in program.html_text
    assert '"occluders": ["object_0"]' in program.html_text


def test_scene_3d_accepts_explicit_convex_hull_object(tmp_path: Path) -> None:
    path = tmp_path / "ui_convex_hull_orbit.vkf"
    path.write_text(CONVEX_HULL_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert '"kind": "convex_hull"' in program.html_text
    assert '"points": [[-0.98, 0.22, 0.44], [0.65, 0.17, 0.37]' in program.html_text
    assert '"occluders": ["object_0"]' in program.html_text


def test_scene_3d_accepts_points_arrow_h_hull_sugar(tmp_path: Path) -> None:
    path = tmp_path / "ui_hull_sugar_orbit.vkf"
    path.write_text(HULL_SUGAR_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert '"kind": "convex_hull"' in program.html_text
    assert '"points": [[-0.98, 0.22, 0.44], [0.65, 0.17, 0.37]' in program.html_text
    assert '"occluders": ["object_0"]' in program.html_text


def test_scene_3d_accepts_points_arrow_hi_hull_set_sugar(tmp_path: Path) -> None:
    path = tmp_path / "ui_hull_set_sugar_orbit.vkf"
    path.write_text(HULL_SET_SUGAR_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.html_text.count('"kind": "convex_hull"') >= 2
    assert '"id": "object_0_0"' in program.html_text
    assert '"id": "object_0_1"' in program.html_text
    assert '"occluders": ["object_0_0", "object_0_1"]' in program.html_text
    assert '[0.84, 0.92, 1.0, 1.0]' in program.html_text


def test_scene_3d_accepts_direct_add_simplices_object(tmp_path: Path) -> None:
    path = tmp_path / "ui_simplices_orbit.vkf"
    path.write_text(SIMPLICES_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert '"kind": "simplices"' in program.html_text
    assert '"add_simplices": {"edges": [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]], "faces": [[0, 1, 2]], "volumes": [[0, 1, 2, 3]]}' in program.html_text
    assert '"occluders": ["object_0"]' in program.html_text


def test_scene_3d_accepts_points_arrow_d_delaunay_sugar(tmp_path: Path) -> None:
    path = tmp_path / "ui_delaunay_2d.vkf"
    path.write_text(DELAUNAY_2D_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert '"kind": "simplices"' in program.html_text
    assert '"faces": [[' in program.html_text
    assert '"volumes": []' in program.html_text
    assert '"edges": [[' in program.html_text
    assert '"occluders": ["object_0"]' in program.html_text


def test_scene_3d_accepts_points_arrow_d_delaunay_3d_volumes(tmp_path: Path) -> None:
    path = tmp_path / "ui_delaunay_3d.vkf"
    path.write_text(DELAUNAY_3D_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert '"kind": "simplices"' in program.html_text
    assert '"volumes": [[' in program.html_text
    assert '"faces": []' in program.html_text
    assert '"edges": [[' in program.html_text
    assert '"occluders": ["object_0"]' in program.html_text


def test_scene_3d_accepts_field_mesh_objects_alongside_cubes(tmp_path: Path) -> None:
    path = tmp_path / "ui_scene_3d_field_mesh_object.vkf"
    path.write_text(
        """
math:.math
u: [-1.0, 0.0, 1.0] -> u
v: [-1.0, 0.0, 1.0] -> v
native_scene: (
    kind: "scene_3d",
    frame_id: "scene_3d_field_mesh_frame",
    title: "Scene 3D Field Mesh Object",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, -1.8, 0.7],
        size: 1.0,
        face_color: [0.88, 0.24, 0.20, 1.0]
    ),
    objects: [
        (
            id: "wave_patch",
            kind: "field_mesh",
            x: u,
            y: v,
            z: math.sin(u + v),
            center: [0.0, 1.6, 1.0],
            scale: [0.8, 0.8, 0.35],
            color: [0.18, 0.62, 0.96, 1.0],
            interpolation: true,
            depth_write: true
        )
    ],
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    lights: [],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.0],
        lift: 0.0
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert '"kind": "field_mesh"' in program.html_text
    assert '"id": "wave_patch"' in program.html_text
    assert '"occluders": ["wave_patch", "cube_0"]' in program.html_text


def test_function_plotter_lowers_x_squared_to_native_field_mesh(tmp_path: Path) -> None:
    path = tmp_path / "ui_function_plotter.vkf"
    path.write_text(
        """
native_scene: (
    kind: "function_plotter",
    frame_id: "plot_frame",
    title: "Plot",
    rect: [0.1, 0.1, 0.8, 0.8],
    expr: "x^2",
    u: (
        min: -1.0,
        max: 1.0,
        count: 5
    )
)
""",
        encoding="utf-8",
    )

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    runtime_packets = json.loads(program.runtime_packets_text)
    scene_packet = next(packet for packet in runtime_packets if packet["kind"] == "scene.replace")
    frames = {command["id"]: command["payload"]["spec"] for command in scene_packet["payload"]["commands"]}
    frame = frames["plot_frame"]
    body_widgets = {widget["id"]: widget for widget in frame["body"]}

    assert '"type": "plot_panel"' in program.runtime_packets_text
    assert list(frames) == ["plot_frame"]
    assert body_widgets["plot_stack"]["type"] == "stackframe"
    assert [child["id"] for child in body_widgets["plot_stack"]["children"]] == ["plot_panel", "plot_panel_3d"]
    assert body_widgets["plot_mode"]["options"] == ["2D", "3D"]
    assert '"expr_box"' in program.runtime_packets_text
    assert '"add_button"' in program.runtime_packets_text
    assert '"face_mode"' in program.runtime_packets_text
    assert '"edge_mode"' in program.runtime_packets_text
    assert '"vertex_mode"' in program.runtime_packets_text
    assert frame["body_layout"]["row_heights"] == "max-content max-content max-content max-content max-content max-content max-content max-content max-content repeat(7, minmax(0, 1fr))"
    assert body_widgets["expr_box"]["grid"] == [0, 1, 1, 3]
    assert body_widgets["add_button"]["grid"] == [0, 4, 1, 1]
    assert body_widgets["plot_stack"]["grid"] == [9, 0, 7, 12]
    assert body_widgets["edge_scale"]["max"] == 25.0
    assert body_widgets["vertex_scale"]["max"] == 25.0
    assert body_widgets["y_min"]["visible"] is False
    assert body_widgets["t_min"]["visible"] is False
    assert body_widgets["face_colormap"]["visible"] is False
    assert body_widgets["edge_colormap"]["visible"] is False
    assert body_widgets["vertex_colormap"]["visible"] is False
    assert '"x_min"' in program.runtime_packets_text
    assert '"y_min"' in program.runtime_packets_text
    assert '"plot_frame:plot_panel": [' in program.runtime_packets_text
    assert '"plot_frame:plot_panel_3d": [' in program.runtime_packets_text
    assert '"op": "polyline"' not in program.runtime_packets_text
    assert '"geom": {}' in program.runtime_packets_text
    assert "vf-native-scene.js" not in program.html_text
    assert '"widget_id": "add_button"' in program.event_program_text
    assert '"widget_id": "clear_button"' in program.event_program_text
    assert '"op": "set_widget_state"' in program.event_program_text
    event_program = json.loads(program.event_program_text)
    assert any(rule.get("when") == {"text": "Distributed"} for rule in event_program["rules"])
    assert '"op": "plot_expr_to_frame_ops"' in program.event_program_text
    assert '"plot_space": "2d"' in program.event_program_text
    assert '"plot_space": "3d"' in program.event_program_text
    assert '"panel_widget": "plot_panel_3d"' in program.event_program_text
    assert '"op": "display_frame_ops"' in program.event_program_text
    assert '"op": "display_geom_empty"' in program.event_program_text
    assert '"target": "plot_frame:plot_panel"' in program.event_program_text
    assert '"target": "plot_frame:plot_panel_3d"' in program.event_program_text
    assert '"expr_widget": "expr_box"' in program.event_program_text
    assert '"y_min_widget": "y_min"' in program.event_program_text
    assert '"t_min_widget": "t_min"' in program.event_program_text
    assert '"plot.time_tick"' in program.event_program_text
    assert '"count": 5' in program.event_program_text
    assert '"op": "polyline"' not in program.event_program_text


def test_scene_3d_scene_ir_separates_properties_from_embedding(tmp_path: Path) -> None:
    path = tmp_path / "ui_embedded_property_scene.vkf"
    path.write_text(EMBEDDED_PROPERTY_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert '"properties": {"eye": [3.9, -5.6, 3.2], "look": [0.0, 0.0, 1.0], "angle": 34.0, "zen": [0.0, 0.0, 1.0]}' in program.html_text
    assert '"embedding": {"pos": "eye", "target": "look", "fov": "angle", "up": "zen"' in program.html_text
    assert '"properties": {"location": [0.0, 4.8, 4.8], "watt": 24000.0, "max_range": 18.0, "shadow_on": true, "beam": [1.0, 0.95, 0.84, 1.0], "motion": "orbit"' in program.html_text
    assert '"pos": "location"' in program.html_text
    assert '"power": "watt"' in program.html_text
    assert '"range": "max_range"' in program.html_text
    assert '"casts_shadow": "shadow_on"' in program.html_text
    assert '"color": "beam"' in program.html_text
    assert '"embedding": {"center": "where", "size": "span", "z": "level", "color": "tint", "visible": "visible", "surface_system": "surface_system"}' in program.html_text
    assert '"points": "verts"' in program.html_text
    assert '"face_color": "tint"' in program.html_text


def test_cube_light_eye_scene_preserves_track_fields(tmp_path: Path) -> None:
    path = tmp_path / "ui_cube_light_eye_test.vkf"
    path.write_text(LIGHT_EYE_TRACK_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert '"boundary": "repeat"' in program.html_text
    assert '"tracks": {' in program.html_text


def test_scene_3d_cube_scene_ir_preserves_texture_and_transform_tracks(tmp_path: Path) -> None:
    path = tmp_path / "cube_dice_tracks.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "cube_dice_tracks_frame",
    title: "Cube Dice Tracks",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.1],
        size: 1.6,
        transform: [
            [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 1.1],
                [0.0, 0.0, 0.0, 1.0]
            ],
            [
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [-1.0, 0.0, 0.0, 1.1],
                [0.0, 0.0, 0.0, 1.0]
            ],
            [
                [-1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, -1.0, 1.1],
                [0.0, 0.0, 0.0, 1.0]
            ]
        ] -> abt,
        texture: (
            kind: "dice",
            color_a: [1.0, 1.0, 1.0, 1.0],
            color_b: [0.0, 0.0, 0.0, 1.0]
        ),
        face_color: [0.98, 0.98, 0.98, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        visible: false,
        color: [0.0, 0.0, 0.0, 0.0]
    ),
    camera: (
        pos: [3.8, -5.2, 3.1],
        target: [0.0, 0.0, 1.0],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            target: [0.0, 0.0, 1.0],
            radius: 4.8,
            height: 4.0,
            theta: 0.2,
            angular_velocity: 0.55,
            model: "blinn_phong",
            color: [1.0, 0.95, 0.84, 1.0],
            casts_shadow: false
        )
    ],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.0],
        lift: 0.0
    )
)
""".strip(),
        encoding="utf-8",
    )
    program = try_build_native_overlay_scene_program(path)
    assert program is not None
    assert '"texture":{"kind":"dice"' in program.html_text.replace(" ", "")
    compact = program.html_text.replace(" ", "")
    assert '"transform":{"__vf_axis_tagged__":true,"idx":"abt"' in compact
    assert '"tracks":{"transform":' in compact


def test_scene_3d_cube_scene_ir_preserves_texture_tracks(tmp_path: Path) -> None:
    path = tmp_path / "cube_texture_tracks.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "cube_texture_tracks_frame",
    title: "Cube Texture Tracks",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.1],
        size: 1.6,
        texture: [
            (
                kind: "dice",
                color_a: [1.0, 1.0, 1.0, 1.0],
                color_b: [0.0, 0.0, 0.0, 1.0],
                graph_test: true,
                graph_width_px: 5.0
            ),
            (
                kind: "dice",
                color_a: [1.0, 1.0, 1.0, 1.0],
                color_b: [1.0, 0.10, 0.10, 1.0],
                graph_test: true,
                graph_width_px: 5.0
            )
        ] -> t,
        face_color: [0.98, 0.98, 0.98, 1.0]
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        visible: false,
        color: [0.0, 0.0, 0.0, 0.0]
    ),
    camera: (
        pos: [3.8, -5.2, 3.1],
        target: [0.0, 0.0, 1.0],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            target: [0.0, 0.0, 1.0],
            radius: 4.8,
            height: 4.0,
            theta: 0.2,
            angular_velocity: 0.55,
            model: "blinn_phong",
            color: [1.0, 0.95, 0.84, 1.0],
            casts_shadow: false
        )
    ],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.0],
        lift: 0.0
    )
)
""".strip(),
        encoding="utf-8",
    )
    program = try_build_native_overlay_scene_program(path)
    assert program is not None
    compact = program.html_text.replace(" ", "")
    assert '"tracks":{"texture":' in compact
    assert '"graph_width_px":5.0' in compact


def test_scene_3d_cube_scene_ir_preserves_surface_screen_system(tmp_path: Path) -> None:
    path = tmp_path / "cube_surface_screen.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "cube_surface_screen_frame",
    title: "Cube Surface Screen",
    rect: [0.08, 0.08, 0.72, 0.78],
    cube: (
        center: [0.0, 0.0, 1.1],
        size: 1.6,
        surface_system: (
            kind: "screen",
            camera_ref: "current",
            scale: [1.0, 1.0],
            world: (
                kind: "cube_demo",
                spin_axis: [0.0, 1.0, 0.0],
                angular_velocity: 1.0
            )
        )
    ),
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        visible: false,
        color: [0.0, 0.0, 0.0, 0.0]
    ),
    camera: (
        pos: [4.6, -5.6, 3.4],
        target: [0.0, 0.0, 1.1],
        fov: 34.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.0],
        lift: 0.0
    )
)
""",
        encoding="utf-8",
    )
    program = try_build_native_overlay_scene_program(path)
    assert program is not None
    compact = program.html_text.replace(" ", "")
    assert '"surface_system":{"kind":"screen","camera_ref":"current","scale":[1.0,1.0],"world":{"kind":"cube_demo"' in compact


def test_scene_3d_scene_ir_preserves_cubes_and_mirror_surface_system(tmp_path: Path) -> None:
    path = tmp_path / "cube_surface_mirror.vkf"
    path.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "cube_surface_mirror_frame",
    title: "Cube Surface Mirror",
    rect: [0.08, 0.08, 0.72, 0.78],
    cubes: [
        (
            center: [0.0, 1.55, 1.35],
            size: 2.4,
            face_color: [0.92, 0.92, 0.94, 1.0],
            surface_system: (
                kind: "mirror",
                scale: [1.0, 1.0],
                world: (
                    kind: "mirror_demo",
                    background: [0.0, 0.0, 0.0, 0.0],
                    frame_color: [0.0, 0.0, 0.0, 0.0]
                )
            )
        ),
        (
            center: [-1.15, -1.25, 0.55],
            size: 0.64,
            face_color: [1.0, 1.0, 1.0, 1.0],
            texture: (
                kind: "checker",
                scale: [5.0, 5.0],
                color_a: [0.10, 0.14, 0.22, 1.0],
                color_b: [0.92, 0.94, 0.98, 1.0]
            )
        )
    ],
    plane: (
        center: [0.0, 0.0],
        size: 7.0,
        z: 0.0,
        color: [0.20, 0.22, 0.26, 1.0]
    ),
    camera: (
        pos: [4.2, -5.8, 2.7],
        target: [0.0, -1.1, 1.0],
        fov: 33.0,
        up: [0.0, 0.0, 1.0]
    ),
    lights: [
        (
            kind: "point",
            pos: [0.0, -4.5, 5.8],
            power: 24000.0,
            range: 18.0,
            casts_shadow: false
        )
    ],
    shadow: (
        enabled: false,
        color: [0.0, 0.0, 0.0, 0.0],
        lift: 0.0
    )
)
""",
        encoding="utf-8",
    )
    program = try_build_native_overlay_scene_program(path)
    assert program is not None
    compact = program.html_text.replace(" ", "")
    assert '"surface_system":{"kind":"mirror","scale":[1.0,1.0],"world":{"kind":"mirror_demo"' in compact
    assert '"id":"cube_1","kind":"cube"' in compact


def test_scene_3d_accepts_lights_i(tmp_path: Path) -> None:
    path = tmp_path / "ui_lights_i.vkf"
    path.write_text(LIGHTS_I_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.html_text.count('"id": "light_') >= 2
    assert '"pos": [0.0, 4.8, 4.8]' in program.html_text
    assert '"pos": [0.0, -4.8, 4.8]' in program.html_text


def test_scene_3d_accepts_lights_ij(tmp_path: Path) -> None:
    path = tmp_path / "ui_lights_ij.vkf"
    path.write_text(LIGHTS_IJ_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.html_text.count('"id": "light_') >= 2
    assert '"pos": [-2.5, 4.2, 4.6]' in program.html_text
    assert '"pos": [2.5, 4.2, 4.6]' in program.html_text


def test_scene_3d_accepts_lights_arrow_i_equivalent(tmp_path: Path) -> None:
    path = tmp_path / "ui_lights_arrow_i.vkf"
    path.write_text(LIGHTS_ARROW_I_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.html_text.count('"id": "light_') >= 2
    assert '"pos": [0.0, 4.8, 4.8]' in program.html_text
    assert '"pos": [0.0, -4.8, 4.8]' in program.html_text


def test_scene_3d_accepts_lights_arrow_ij_equivalent(tmp_path: Path) -> None:
    path = tmp_path / "ui_lights_arrow_ij.vkf"
    path.write_text(LIGHTS_ARROW_IJ_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.html_text.count('"id": "light_') >= 2
    assert '"pos": [-2.5, 4.2, 4.6]' in program.html_text
    assert '"pos": [2.5, 4.2, 4.6]' in program.html_text


def test_ocean_wave_scene_runs_in_native_ui_runtime(tmp_path: Path) -> None:
    path = tmp_path / "ui_ocean_wave_test.vkf"
    path.write_text(OCEAN_WAVE_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.session_name == "ui-ocean-wave-test"
    assert "vf-native-scene-ocean.js" in program.html_text
    assert "window.__vfNativeOceanConfig" in program.html_text
    assert '"boundary": "repeat"' in program.html_text
    assert '"turns_per_cycle": 2.0' in program.html_text
    assert "Ocean Wave Native" in program.runtime_packets_text


def test_dimension_mix_scene_runs_in_native_ui_runtime(tmp_path: Path) -> None:
    path = tmp_path / "ui_field_mesh_dimension_mix.vkf"
    path.write_text(DIMENSION_MIX_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.session_name == "ui-field-mesh-dimension-mix"
    assert "vf-native-scene-dimension-mix.js" in program.html_text
    assert "window.__vfNativeDimensionMixConfig" in program.html_text
    assert '"kind": "dimension_mix"' in program.html_text
    assert "dim3_volume" in program.runtime_packets_text


def test_face_edge_vertex_implementation_lives_in_ui_engine() -> None:
    source = Path("vektorflow/native_overlay_scene_bundle.py").read_text(encoding="utf-8")

    assert "writeCapsuleMesh" not in source
    assert "createFaceEdgeVertexSharedStore" not in source
    assert "vf-native-scene-face-edge-vertex.js" in source

