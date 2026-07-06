from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib import resolve_stdlib
from vektorflow.stdlib.physics import Quantity


def _run(src: str) -> list[str]:
    mod = parse_module(src, filename="<physics-stdlib-test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return [line for line in buf.getvalue().splitlines() if line.strip()]


def test_resolve_stdlib_physics_exposes_dimension_basis_and_units() -> None:
    ns = resolve_stdlib("physics")

    assert ns["dimensions"].L.dimension == (1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    assert ns["dimensions"].M.dimension == (0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    assert ns["dimensions"].T.dimension == (0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0)
    assert ns["dimensions"].Theta.symbol == "Theta"
    assert ns["dimensions"].Th is ns["dimensions"].Theta
    assert ns["dimensions"].temp is ns["dimensions"].Theta
    assert ns["dimensions"].I.symbol == "I"
    assert ns["dimensions"].N.symbol == "N"
    assert ns["dimensions"].J.symbol == "J"
    assert ns["L"] is ns["dimensions"].L
    assert ns["M"] is ns["dimensions"].M
    assert ns["T"] is ns["dimensions"].T
    assert ns["Theta"] is ns["dimensions"].Theta
    assert ns["I"] is ns["dimensions"].I
    assert ns["N"] is ns["dimensions"].N
    assert ns["J"] is ns["dimensions"].J
    assert ns["km"].value == 1000
    assert ns["cm"].value == 0.01
    assert ns["mm"].value == 0.001
    assert ns["um"].value == 0.000001
    assert ns["kg"].dimension == ns["dimensions"].M.dimension
    assert ns["g"].value == 0.001
    assert ns["mg"].value == 0.000001
    assert ns["sec"] is ns["s"]
    assert ns["second"] is ns["s"]
    assert ns["seconds"] is ns["s"]
    assert ns["min"].value == 60
    assert ns["minutes"].value == 60
    assert ns["h"].value == 3600
    assert ns["d"].value == 86400
    assert ns["month"].value == 2629800
    assert ns["months"].value == 2629800
    assert ns["y"].value == 31557600
    assert ns["K"].dimension == ns["dimensions"].Theta.dimension
    assert ns["A"].dimension == ns["dimensions"].I.dimension
    assert ns["mol"].dimension == ns["dimensions"].N.dimension
    assert ns["mole"] is ns["mol"]
    assert ns["moles"] is ns["mol"]
    assert ns["cd"].dimension == ns["dimensions"].J.dimension
    assert ns["candela"] is ns["cd"]


def test_quantity_arithmetic_enforces_matching_dimensions() -> None:
    ns = resolve_stdlib("physics")

    length = 3 * ns["km"] + 200 * ns["m"]
    speed = length / (100 * ns["s"])
    area = ns["m"] * ns["m"]

    assert isinstance(length, Quantity)
    assert length.value == 3200
    assert length.dimension == ns["m"].dimension
    assert speed.dimension == (1.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0)
    assert area.dimension == (2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    with pytest.raises(ValueError, match="cannot add"):
        ns["m"] + ns["s"]
    with pytest.raises(ValueError, match="cannot compare"):
        ns["m"] < ns["s"]
    with pytest.raises(ValueError, match="cannot equate"):
        ns["m"] == ns["s"]


def test_physics_units_work_from_vkf() -> None:
    assert _run(
        """
physics: .physics
d: physics.dimensions
s: d.L
t: d.T
theta: d.Theta
x: 3 * physics.km
y: 200 * physics.m
speed: (x + y) / (100 * physics.s)
:: s.symbol
:: t.symbol
:: theta.symbol
:: (x + y).value
:: speed.dimension_label
"""
    ) == ["L", "T", "Theta", "3200", "L T^-1"]


def test_physics_spill_import_units_work_from_vkf() -> None:
    assert _run(
        """
:.physics
x: 4 * cm + 2 * mm
:: x.value
:: (m * m).dimension_label
"""
    ) == ["0.042", "L^2"]


def test_vkf_rejects_dimension_mismatched_addition_and_comparison() -> None:
    with pytest.raises(ValueError, match="cannot add"):
        _run(
            """
:.physics
:: m + s
"""
        )
    with pytest.raises(ValueError, match="cannot compare"):
        _run(
            """
:.physics
:: m < s
"""
        )


def test_math_stdlib_requires_unitless_quantities() -> None:
    assert _run(
        """
physics: .physics
math: .math
:: math.sin(physics.unitless(0))
"""
    ) == ["0"]
    with pytest.raises(ValueError, match="unitless"):
        _run(
            """
physics: .physics
math: .math
:: math.sin(physics.m)
"""
        )


def test_physics_namespace_builds_hard_disc_gpu_runtime_spec() -> None:
    ns = resolve_stdlib("physics")
    discs = ns["demo_hard_discs"](4, width=1.2, height=0.8, speed_scale=2.0)

    spec = ns["hard_disc_gpu_runtime"](
        discs,
        width=1.2,
        height=0.8,
        restitution=0.5,
        gravity=(0.0, -9.81),
        solver_iterations=4,
    )

    assert spec["kind"] == "hard_disc_2d"
    assert spec["particle_count"] == 4
    assert spec["particle_stride_f32"] == 8
    assert len(spec["initial_particles"]) == 4 * 8
    assert spec["gravity"] == [0.0, -9.81]
    assert spec["collision_matrix"] == [0.5, 0.0, 0.0, 1.0]
    assert "write_render_instances" in spec["wgsl"]
    assert spec["pipeline"]["rigid_body_supported"] is True
    assert spec["pipeline"]["collision_matrix_supported"] is True


def test_physics_namespace_builds_hard_sphere_gpu_runtime_spec() -> None:
    ns = resolve_stdlib("physics")
    spheres = ns["demo_hard_spheres"](4, width=1.2, depth=0.8, height=0.7)

    spec = ns["hard_sphere_gpu_runtime"](
        spheres,
        width=1.2,
        depth=0.8,
        height=0.7,
        restitution=0.9,
        gravity=(0.0, 0.0, -9.81),
        solver_iterations=5,
    )

    assert spec["kind"] == "hard_sphere_3d"
    assert spec["particle_count"] == 4
    assert spec["particle_stride_f32"] == 12
    assert len(spec["initial_particles"]) == 4 * 12
    assert spec["gravity"] == [0.0, 0.0, -9.81]
    assert spec["collision_matrix"] == [0.9, 0.0, 0.0, 1.0]
    assert "grid_layers" in spec["wgsl"]
    assert "vec3<f32>" in spec["wgsl"]
    assert "write_render_instances" in spec["wgsl"]
    assert spec["pipeline"]["dimension"] == 3
    assert spec["pipeline"]["rigid_body_supported"] is True
    assert spec["pipeline"]["collision_matrix_supported"] is True
