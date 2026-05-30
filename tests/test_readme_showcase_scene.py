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
