from __future__ import annotations

from vektorflow.native_scene_ir_builder import build_scene_3d_state


def test_build_scene_3d_state_assembles_scene_ir() -> None:
    frame_spec = {
        "frame_id": "frame_0",
        "title": "Frame Zero",
        "rect": (0.1, 0.1, 0.6, 0.7),
    }
    plane_spec = {
        "center": [0.0, 0.0],
        "size": 7.0,
        "z": 0.0,
        "color": [0.2, 0.22, 0.26, 1.0],
        "visible": True,
    }
    plane_props = {
        "where": [0.0, 0.0],
        "span": 7.0,
        "level": 0.0,
        "tint": [0.2, 0.22, 0.26, 1.0],
        "visible": True,
    }
    plane_embedding = {
        "center": "where",
        "size": "span",
        "z": "level",
        "color": "tint",
        "visible": "visible",
    }
    object_meshes = [
        {
            "id": "object_0",
            "kind": "convex_hull",
            "points": [[0.0, 0.0, 1.0], [1.0, 0.0, 1.0], [0.0, 1.0, 1.0], [0.0, 0.0, 2.0]],
            "face_color": [0.96, 0.22, 0.16, 1.0],
        }
    ]
    object_mesh_entities = [
        {
            "id": "object_0",
            "kind": "convex_hull",
            "properties": {"points": [[0.0, 0.0, 1.0], [1.0, 0.0, 1.0], [0.0, 1.0, 1.0], [0.0, 0.0, 2.0]]},
            "embedding": {"points": "points"},
        }
    ]
    camera_entity = {
        "properties": {"pos": [3.9, -5.6, 3.2], "target": [0.0, 0.0, 0.9], "fov": 34.0, "up": [0.0, 0.0, 1.0]},
        "embedding": {"pos": "pos", "target": "target", "fov": "fov", "up": "up"},
    }
    lights = [
        {"id": "light_0", "casts_shadow": True},
        {"id": "light_1", "casts_shadow": False},
    ]
    light_entities = [
        {"properties": {"id": "light_0"}, "embedding": {"id": "id"}},
        {"properties": {"id": "light_1"}, "embedding": {"id": "id"}},
    ]
    shadow_spec = {"enabled": True, "color": [0.0, 0.0, 0.0, 1.0], "lift": 0.002}

    state = build_scene_3d_state(
        frame_spec=frame_spec,
        plane_spec=plane_spec,
        plane_props=plane_props,
        plane_embedding=plane_embedding,
        object_meshes=object_meshes,
        object_mesh_entities=object_mesh_entities,
        camera_entity=camera_entity,
        lights=lights,
        light_entities=light_entities,
        timing={"fps": 60, "boundary": "repeat"},
        shadow_spec=shadow_spec,
        show_light_markers=False,
        light_flares=True,
        light_marker_size=0.18,
    )

    assert state["meshes"][0]["id"] == "plane_0"
    assert state["meshes"][1]["id"] == "object_0"
    assert state["scene_ir"]["frame"] == frame_spec
    assert state["scene_ir"]["camera"] == camera_entity
    assert state["scene_ir"]["lights"] == light_entities
    assert state["scene_ir"]["timing"] == {"fps": 60, "boundary": "repeat"}
    assert state["scene_ir"]["shadow"] == shadow_spec
    assert state["scene_ir"]["render_options"] == {
        "show_light_markers": False,
        "light_flares": True,
        "light_marker_size": 0.18,
    }
    assert state["scene_ir"]["meshes"][0]["kind"] == "quad"
    assert state["scene_ir"]["meshes"][1]["kind"] == "convex_hull"
    assert state["scene_ir"]["shadow_receivers"] == [
        {
            "properties": {
                "receiver_mesh": "plane_0",
                "occluders": ["object_0"],
                "lights": ["light_0"],
                "policy_kind": "light_camera_depth_map",
                "policy_softness": "shadow_map_bias",
            },
            "embedding": {
                "receiver_mesh": "receiver_mesh",
                "occluders": "occluders",
                "lights": "lights",
                "policy_kind": "policy_kind",
                "policy_softness": "policy_softness",
            },
        }
    ]
