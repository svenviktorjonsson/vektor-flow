from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib.events import MouseDrag, MouseWheel, get_global_poller


def test_vkf_add_infers_geometry_indices_from_axis_tagged_channels() -> None:
    src = """
ui:.ui
d: ui.display
d.set_auto_render(false)
f: d.Frame()
d.add_frame((0.1, 0.1, 0.5, 0.5))

u: [-1, 0, 1] -> u
v: [-1, 0, 1] -> v
z: u*u + v*v

mesh: d.add(x: u, y: v, z: z, color: "cyan", interpolation: true)
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    display = ip.globals["d"]
    frame_id = ip.globals["f"]._frame_id
    mesh = display._geom[frame_id]["meshes"][0]
    assert mesh["topology"] == "triangle-list"
    assert mesh["manifold_dim_count"] == 2
    assert mesh["indices"] == [
        0, 3, 4, 0, 4, 1,
        1, 4, 5, 1, 5, 2,
        3, 6, 7, 3, 7, 4,
        4, 7, 8, 4, 8, 5,
    ]


def test_axis_tensor_arithmetic_keeps_combined_signature_for_geometry() -> None:
    src = """
u: [-1, 0, 1] -> u
v: [-1, 0, 1] -> v
z: u*u + v*v
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    z = ip.globals["z"]
    assert z.idx == "uv"
    assert z.data == (
        (2, 1, 2),
        (1, 0, 1),
        (2, 1, 2),
    )


def test_axis_tensor_trig_broadcast_keeps_time_surface_signature() -> None:
    src = """
math:.math
u: [-1, 0, 1] -> u
v: [-1, 0, 1] -> v
t: [0, 1] -> t
z: math.sin(u + v + t)
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    z = ip.globals["z"]
    assert z.idx == "uvt"
    assert z.data[0][0][0] ==  pytest.approx(-0.9092974268256817)
    assert z.data[1][1][0] == pytest.approx(0.0)
    assert z.data[1][1][1] == pytest.approx(0.8414709848078965)


def test_axis_tensor_broadcast_preserves_declared_axis_order() -> None:
    src = """
u: [10, 20] -> u
v: [1, 2, 3] -> v
t: [100, 200] -> t
z: u + v + t
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    z = ip.globals["z"]
    assert z.idx == "uvt"
    assert z.data == (
        ((111, 211), (112, 212), (113, 213)),
        ((121, 221), (122, 222), (123, 223)),
    )


def test_axis_tensor_can_sum_multiple_trig_fields_with_same_signature() -> None:
    src = """
math:.math
u: [-1, 0, 1] -> u
v: [-1, 0, 1] -> v
t: [0, 1] -> t
a: math.sin(u + v + t)
b: math.cos((u * 0.0) + v + t)
z: a + b
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    z = ip.globals["z"]
    assert z.idx == "uvt"


def test_vkf_add_accepts_time_varying_height_surface() -> None:
    src = """
ui:.ui
math:.math
d: ui.display
d.set_auto_render(false)
f: d.Frame()
d.add_frame((0.1, 0.1, 0.5, 0.5))

u: [-1, 0, 1] -> u
v: [-1, 0, 1] -> v
t: [0, 1] -> t
height: math.sin(u + v + t)

mesh: d.add(x: u, y: v, z: height, color: "cyan", interpolation: true)
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    display = ip.globals["d"]
    frame_id = ip.globals["f"]._frame_id
    mesh = display._geom[frame_id]["meshes"][0]
    assert mesh["time_count"] == 2
    assert mesh["topology"] == "triangle-list"


def test_axis_2d_sugar_emits_transparent_2d_marker_geometry() -> None:
    src = """
ui:.ui
math:.math
d: ui.display
d.set_auto_render(false)
w: ui.widgets
ticks: [-1, 0, 1]
labels: ui.axis_2d_tick_labels(w, x_ticks: ticks, y_ticks: ticks, x_min: -1, x_max: 1, y_min: -1, y_max: 1)
f: d.frame(gridlayout: (5, 5), body_transparent: true)
d.add_frame(f, (0.1, 0.1, 0.5, 0.5), body: labels)
axis: ui.axis_2d(f, x_min: -1, x_max: 1, y_min: -1, y_max: 1, prefix: "test_axis")
axis.crosshair()
axis.ticks(x: ticks, y: ticks)
x: [-1, 0, 1] -> u
y: math.sin(x)
axis.plot(x: x, y: y, id: "sin")
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    display = ip.globals["d"]
    frame_id = ip.globals["f"]._frame_id
    frame_spec = display._screen._commands[0].payload["spec"]
    assert frame_spec["body_transparent"] is True
    assert frame_spec["body"]
    meshes = display._geom[frame_id]["meshes"]
    assert {m["id"] for m in meshes} >= {"test_axis_crosshair", "test_axis_sin"}
    layers = display._geom[frame_id]["frame_layers"]
    assert any(
        layer["kind"] == "axis"
        and layer["dim"] == 2
        and layer["variant"] == "crosshair"
        and layer["geometry_ids"] == ["test_axis_crosshair"]
        for layer in layers
    )
    for mesh in meshes:
        assert mesh["mode3d"] is False
        assert mesh["render_mode"] == "marker_impostor"
        if mesh["id"] == "test_axis_crosshair":
            assert mesh["axis_full_frame"] is True
            assert mesh["indices"] == [0, 1, 2, 3]
        coords = mesh["vertices"][0::10] + mesh["vertices"][1::10]
        assert max(abs(float(v)) for v in coords) <= 1.000001


def test_axis_3d_crosshair_emits_pixel_line_geometry() -> None:
    src = """
ui:.ui
d: ui.display
d.set_auto_render(false)
f: d.Frame()
d.add_frame(f, (0.1, 0.1, 0.6, 0.6))
axis: ui.axis_3d(f, x_min: -2, x_max: 2, y_min: -3, y_max: 3, z_min: -4, z_max: 4, prefix: "test_axis3d")
axis.crosshair(width: 1)
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    display = ip.globals["d"]
    frame_id = ip.globals["f"]._frame_id
    assert display._geom[frame_id]["axis3d_controls"] is True
    layers = display._geom[frame_id]["frame_layers"]
    assert any(
        layer["kind"] == "axis"
        and layer["dim"] == 3
        and layer["variant"] == "crosshair"
        and layer["geometry_ids"] == ["test_axis3d_crosshair"]
        for layer in layers
    )
    meshes = display._geom[frame_id]["meshes"]
    assert {m["id"] for m in meshes} >= {"test_axis3d_crosshair"}
    for mesh in meshes:
        assert mesh["topology"] == "line-list"
        assert mesh["render_mode"] == "line"
        assert mesh["marker_space"] == "pixel"
        assert mesh["edge_width"] == 1.0
        assert mesh["axis_screen_extend"] is False
        assert mesh["mode3d"] is True
        assert mesh["manifold_dim_count"] == 1
        assert mesh["depth_write"] is True
        assert mesh["receives_lighting"] is False
        if mesh["id"] == "test_axis3d_crosshair":
            assert len(mesh["indices"]) // 2 == 35
    texts = display._geom[frame_id]["texts"]
    assert len(texts) == 35
    assert any(t["text"] == "$x$" for t in texts)
    assert any(t["text"] == "$y$" for t in texts)
    assert any(t["text"] == "$z$" for t in texts)


def test_axis_3d_box_emits_vkf_wrapper_runtime() -> None:
    src = """
ui:.ui
d: ui.display
d.set_auto_render(false)
f: d.Frame()
d.add_frame(f, (0.1, 0.1, 0.6, 0.6))
axis: ui.axis_3d(f, x_min: -2, x_max: 2, y_min: -3, y_max: 3, z_min: -4, z_max: 4, prefix: "test_box3d")
axis.box(width: 1, tick_len_px: 8, axis_lock_angle_deg: 6, axis_lock_sample_count: 4, grid: true, grid_alpha: 0.12)
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    display = ip.globals["d"]
    frame_id = ip.globals["f"]._frame_id
    geom = display._geom[frame_id]
    assert geom["axis3d_controls"] is True
    assert any(
        layer["kind"] == "axis"
        and layer["dim"] == 3
        and layer["variant"] == "box"
        and layer["geometry_ids"] == ["test_box3d_box", "test_box3d_box_ticks"]
        for layer in geom["frame_layers"]
    )
    assert geom["axis3d_runtime"]["mode"] == "box"
    assert geom["axis3d_runtime"]["x_min"] == -2.0
    assert geom["axis3d_runtime"]["z_max"] == 4.0
    assert geom["axis3d_runtime"]["tick_len_px"] == 8.0
    assert geom["axis3d_runtime"]["axis_lock_angle_deg"] == 6.0
    assert geom["axis3d_runtime"]["axis_lock_sample_count"] == 4
    assert geom["axis3d_runtime"]["grid"] is True
    assert geom["axis3d_runtime"]["grid_alpha"] == 0.12
    meshes = geom["meshes"]
    assert {m["id"] for m in meshes} >= {"test_box3d_box"}
    box = next(m for m in meshes if m["id"] == "test_box3d_box")
    assert box["topology"] == "line-list"
    assert box["render_mode"] == "line"
    assert box["marker_space"] == "pixel"
    assert box["edge_width"] == 1.0
    assert box["mode3d"] is True
    assert len(box["indices"]) // 2 == 12


def test_axis_3d_handle_events_routes_to_camera() -> None:
    src = """
ui:.ui
d: ui.display
d.set_auto_render(false)
f: d.Frame()
d.add_frame(f, (0.1, 0.1, 0.6, 0.6))
axis: ui.axis_3d(f)
cam: f.add_camera(pos: [4, -5, 3], target: [0, 0, 0], fov: 42)
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))
    axis = ip.globals["axis"]
    cam = ip.globals["cam"]
    start_pos = list(cam._data["pos"])

    assert axis.handle_events(MouseWheel(event="wheel", x=0, y=0, step=-1), camera=cam)
    zoom_pos = list(cam._data["pos"])
    assert zoom_pos != start_pos

    assert axis.handle_events(MouseDrag(event="drag", x=0, y=0, dx=8, dy=4, width=800, height=600), camera=cam)
    assert list(cam._data["pos"]) != zoom_pos
    assert list(cam._data["target"]) != [0.0, 0.0, 0.0]


def test_axis_sugar_frame_handles_host_events_without_manual_poll() -> None:
    src = """
ui:.ui
ui.set_mode("test")
d: ui.display
d.set_auto_render(false)
f: d.Frame()
d.add_frame(f, (0.1, 0.1, 0.6, 0.6))
axis: ui.axis_2d(f, x_min: -1, x_max: 1, y_min: -1, y_max: 1, prefix: "auto_axis")
axis.crosshair()
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    axis = ip.globals["axis"]
    frame = ip.globals["f"]
    fid = frame._frame_id
    poller = get_global_poller()
    start = (axis.x_min, axis.x_max, axis.y_min, axis.y_max)

    poller._publish_event_payload({
        "type": "vf_event",
        "event": "wheel",
        "frame_id": fid,
        "x": 100.0,
        "y": 120.0,
        "step": -1,
    })

    assert (axis.x_min, axis.x_max, axis.y_min, axis.y_max) != start


def test_axis_sugar_frame_override_can_suppress_default_handling() -> None:
    src = """
ui:.ui
ui.set_mode("test")
d: ui.display
d.set_auto_render(false)
f: d.Frame()
d.add_frame(f, (0.1, 0.1, 0.6, 0.6))
axis: ui.axis_2d(f, x_min: -1, x_max: 1, y_min: -1, y_max: 1, prefix: "override_axis")
axis.crosshair()
"""
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(src, filename="<test>"))

    axis = ip.globals["axis"]
    frame = ip.globals["f"]
    fid = frame._frame_id
    seen: list[str] = []
    frame.on_event(lambda e: seen.append(str(getattr(e, "event", ""))))
    frame.set_event_handler(lambda e: True)
    poller = get_global_poller()
    start = (axis.x_min, axis.x_max, axis.y_min, axis.y_max)

    poller._publish_event_payload({
        "type": "vf_event",
        "event": "wheel",
        "frame_id": fid,
        "x": 100.0,
        "y": 120.0,
        "step": -1,
    })

    assert seen == ["wheel"]
    assert (axis.x_min, axis.x_max, axis.y_min, axis.y_max) == start
