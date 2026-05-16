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
    kind: "cube_shadow_plane",
    frame_id: "cube_shadow_plane_frame",
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


def test_cube_shadow_plane_scene_runs_in_native_ui_runtime(tmp_path: Path) -> None:
    path = tmp_path / "ui_cube_shadow_plane.vkf"
    path.write_text(CUBE_SHADOW_PLANE_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.session_name == "ui-cube-shadow-plane"
    assert "vf-native-scene-cube-shadow-plane.js" in program.html_text
    assert "window.__vfNativeCubeShadowConfig" in program.html_text
    assert '"enabled": true' in program.html_text
    assert '"lights": [{' in program.html_text
    assert '"casts_shadow": false' in program.html_text
    assert '"source_radius": 0.18' in program.html_text
    assert '"spread": 0.8' in program.html_text
    assert '"meshes": [{' in program.html_text
    assert '"shadow_receivers": [{' in program.html_text
    assert '"receiver_mesh": "plane_0"' in program.html_text
    assert "Cube + Plane + Hard Shadow" in program.runtime_packets_text


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
