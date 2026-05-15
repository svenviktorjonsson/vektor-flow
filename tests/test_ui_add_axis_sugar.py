from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


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
