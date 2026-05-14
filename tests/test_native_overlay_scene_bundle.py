from pathlib import Path

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


def test_face_edge_vertex_scene_is_declared_by_vkf_not_filename(tmp_path: Path) -> None:
    path = tmp_path / "not_the_example_name.vkf"
    path.write_text(NATIVE_SCENE_SOURCE, encoding="utf-8")

    program = try_build_native_overlay_scene_program(path)

    assert program is not None
    assert program.session_name == "not-the-example-name"
    assert "FSM Debug" in program.runtime_packets_text
    assert "createFaceEdgeVertexSharedStore" in program.html_text
    assert "vf-geom-ledger-transport.json" in program.html_text


def test_face_edge_vertex_scene_does_not_use_filename_magic(tmp_path: Path) -> None:
    path = tmp_path / "ui_face_edge_vertex_drag.vkf"
    path.write_text(':: "not a native scene"', encoding="utf-8")

    assert try_build_native_overlay_scene_program(path) is None
