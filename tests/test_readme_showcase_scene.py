from __future__ import annotations

import json
import re
from pathlib import Path

from vektorflow.native_overlay_scene_frontend import try_build_native_overlay_scene_program


def _native_scene_configs_from_html(html: str) -> list[dict[str, object]]:
    match = re.search(r"window\.__vfNativeSceneConfigs\s*=\s*(\[.*?\]);", html, re.DOTALL)
    assert match is not None
    data = json.loads(match.group(1))
    assert isinstance(data, list)
    return data


def test_readme_showcase_uses_two_real_lights_and_one_flare_path() -> None:
    program = try_build_native_overlay_scene_program(Path("examples/110_mirror_showcase.vkf"))
    assert program is not None
    configs = _native_scene_configs_from_html(program.html_text)
    visible = next(
        cfg for cfg in configs
        if ((cfg.get("scene_ir") or {}).get("frame") or {}).get("frame_id") == "readme_mirror_showcase_frame"
    )
    scene_ir = visible["scene_ir"]
    render_options = scene_ir["render_options"]

    assert render_options["show_light_markers"] is False
    assert render_options["light_flares"] is True

    lights = scene_ir["lights"]
    assert len(lights) == 2
    light_props = [light["properties"] for light in lights]
    assert [props["id"] for props in light_props] == ["key_light", "fill_light"]
    assert light_props[0]["show_marker"] is True
    assert light_props[1]["show_marker"] is True
    assert light_props[0]["casts_shadow"] is True
    assert light_props[1]["casts_shadow"] is True
    assert light_props[0]["reflect_mirror_mesh_id"] == "showcase_mirror"
    assert light_props[1]["reflect_mirror_mesh_id"] == "showcase_mirror"


def test_readme_showcase_impostors_keep_point_colors_and_sizes() -> None:
    program = try_build_native_overlay_scene_program(Path("examples/110_mirror_showcase.vkf"))
    assert program is not None
    configs = _native_scene_configs_from_html(program.html_text)
    visible = next(
        cfg for cfg in configs
        if ((cfg.get("scene_ir") or {}).get("frame") or {}).get("frame_id") == "readme_mirror_showcase_frame"
    )
    mesh = next(
        item for item in visible["scene_ir"]["meshes"]
        if item["properties"].get("id") == "impostor_spheres"
    )
    props = mesh["properties"]

    assert props["render_mode"] == "marker_impostor"
    assert props["vertex_scale"] == [0.72, 1.04, 0.86, 1.24, 0.94, 1.14, 0.78, 1.34]

    verts = props["vertices"]
    colors = [tuple(verts[index + 6:index + 10]) for index in range(0, len(verts), 10)]
    assert colors[0] == (1.0, 0.46, 0.02, 1.0)
    assert colors[4] == (0.0, 0.82, 0.96, 1.0)
    assert len(set(colors)) >= 6


def test_readme_showcase_dna_vertices_use_complementary_base_palette() -> None:
    program = try_build_native_overlay_scene_program(Path("examples/110_mirror_showcase.vkf"))
    assert program is not None
    configs = _native_scene_configs_from_html(program.html_text)
    visible = next(
        cfg for cfg in configs
        if ((cfg.get("scene_ir") or {}).get("frame") or {}).get("frame_id") == "readme_mirror_showcase_frame"
    )
    meshes = {
        item["properties"].get("id"): item["properties"]
        for item in visible["scene_ir"]["meshes"]
    }

    strand_a = meshes["dna_strand_a"]
    strand_b = meshes["dna_strand_b"]
    assert strand_a["edge_color"] == [0.05, 0.46, 0.22, 1.0]
    assert strand_b["edge_color"] == [0.08, 0.30, 0.64, 1.0]
    assert len(strand_a["vertex_color"]) == 18
    assert len(strand_b["vertex_color"]) == 18
    assert len({tuple(color) for color in strand_a["vertex_color"]}) == 4
    assert strand_a["vertex_color"][:4] == [
        [1.0, 0.72, 0.04, 1.0],
        [0.72, 0.12, 1.0, 1.0],
        [0.16, 1.0, 0.26, 1.0],
        [0.0, 0.84, 1.0, 1.0],
    ]
    assert strand_b["vertex_color"][:4] == [
        [0.0, 0.84, 1.0, 1.0],
        [0.16, 1.0, 0.26, 1.0],
        [0.72, 0.12, 1.0, 1.0],
        [1.0, 0.72, 0.04, 1.0],
    ]
