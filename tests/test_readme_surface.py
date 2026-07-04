"""End-to-end checks for README-documented surface features."""

from __future__ import annotations

import contextlib
import json
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.ui.display_runtime import build_display_payload


def _emit(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


REPO = Path(__file__).resolve().parents[1]


def _display_payload_for_file(path: Path) -> dict:
    source = path.read_text(encoding="utf-8")
    mod = parse_module(source, filename=str(path))
    ip = Interpreter(path)
    ip.run_module(mod)
    d = ip.globals["d"]
    payload = build_display_payload(
        screen_ops=list(getattr(d, "_screen_ops", [])),
        screen_repr_ops=dict(getattr(d, "_screen_repr_ops", {})),
        frame_ops=dict(getattr(d, "_frame_ops", {})),
        frame_repr_ops=dict(getattr(d, "_frame_repr_ops", {})),
        geom=dict(getattr(d, "_geom", {})),
    )
    json.dumps(payload)
    return payload


class TestReadmeGeneratedExamples:
    def test_physics_layer_lighting_example_preserves_layer_contract(self) -> None:
        payload = _display_payload_for_file(
            REPO / "examples" / "generated" / "readme" / "ui_physics_layer_lighting.vkf"
        )
        geom = payload["geom"]["physics_layer_light_canvas"]
        meshes = {mesh["id"]: mesh for mesh in geom["meshes"]}

        assert meshes["layer_1_light_source"]["physics"] == {
            "kind": "light2d",
            "layer": 1,
            "radius_ratio_to_square_width": 0.1,
            "shape": "circle",
            "center": "-0.35,0.0",
            "color": "#fff8a8",
            "falloff_radius_ratio": 0.7666666667,
            "illuminates_lower_layers": True,
        }
        assert meshes["layer_1_blue_light_source"]["physics"] == {
            "kind": "light2d",
            "layer": 1,
            "radius_ratio_to_square_width": 0.1,
            "shape": "circle",
            "center": "0.85,0.0",
            "color": "#7ddcff",
            "falloff_radius_ratio": 0.7666666667,
            "illuminates_lower_layers": True,
        }
        assert meshes["adjacent_square_backgrounds"]["physics"]["layer"] == 0
        assert meshes["adjacent_square_backgrounds"]["physics"]["floor_texture"] == "axis_aligned_tiles"
        assert meshes["adjacent_square_backgrounds"]["physics"]["square_width"] == 1.0
        assert meshes["adjacent_square_backgrounds"]["physics"]["rooms"] == (
            "-1.5,-0.5,-0.5,0.5;-0.5,-0.5,0.5,0.5;0.5,-0.5,1.5,0.5"
        )
        assert meshes["adjacent_square_backgrounds"]["physics"]["left_square"] == "-1.5,-0.5,-0.5,0.5"
        assert meshes["adjacent_square_backgrounds"]["physics"]["middle_square"] == "-0.5,-0.5,0.5,0.5"
        assert meshes["adjacent_square_backgrounds"]["physics"]["right_square"] == "0.5,-0.5,1.5,0.5"
        assert meshes["adjacent_square_backgrounds"]["physics"]["light_result"] == "background_layer_under_light"
        assert meshes["boundary_parts_with_middle_gap"]["physics"]["layer"] == 0
        assert meshes["boundary_parts_with_middle_gap"]["physics"]["boundary_parts"] == (
            "outer_edges_and_each_shared_edge_first_last_thirds"
        )
        assert meshes["boundary_parts_with_middle_gap"]["physics"]["shared_edge_gaps"] == "middle_thirds"
        assert meshes["boundary_parts_with_middle_gap"]["physics"]["wall_thickness_ratio"] == 0.0266666667
        assert meshes["boundary_parts_with_middle_gap"]["physics"]["wall_material"] == "plain_shader_lit"
        assert meshes["lighting_layer_passes_through_gap"]["physics"] == {
            "kind": "light_field2d",
            "layer": 1,
            "passes_through": "shared_edge_middle_third_gaps",
            "above_layer": 0,
            "penumbra_base_ratio": 0.0166666667,
            "penumbra_growth_ratio": 0.16,
            "falloff_radius_ratio": 0.7666666667,
        }


class TestStringInterpolation:
    def test_dollar_var_and_format(self) -> None:
        src = """
a : 4.2345
:: "printing $a.2f"
"""
        assert _emit(src) == "printing 4.23"

    def test_dollar_dotted_vmap_path(self) -> None:
        src = """
:.collections
state : map(time_idx: 7, time_max: 47)
:: "t=$state.time_idx / $state.time_max"
"""
        assert _emit(src) == "t=7 / 47"


class TestTypeInstanceAndEmit:
    def test_struct_literal_zero_sum(self) -> None:
        src = """
Point : (x:num, y:num)
p : (x:0, y:0)
:: p.x + p.y
"""
        assert _emit(src) == "0"

    def test_primitive_type_defaults(self) -> None:
        src = """
n : num
s : str
b : bit
:: n
:: s
:: b
"""
        assert _emit(src) == "0\n\nfalse"

    def test_emit_overload(self) -> None:
        src = """
Point : (x:num, y:num)
::(value:Point): :: "($value.x,$value.y)"
q : (x:3, y:4)
:: q
"""
        assert _emit(src) == "(3,4)"


class TestPrimitiveDefaults:
    def test_num_str_bool_defaults(self) -> None:
        src = r"""
n : num
s : str
b : bit
:: (n = 0) /\ (s = "") /\ (~ b)
"""
        assert _emit(src) == "true"


class TestTemplateNumbersAndVarargs:
    def test_compile_time_number_parameter_example_interprets(self) -> None:
        src = """
join(x:[num:n], y:[num:m]) -> [num:n+m]:
    x & y

[num:2] a: [1, 2]
[num:3] b: [3, 4, 5]
:: join(a, b)
"""
        assert _emit(src) == "[1, 2, 3, 4, 5]"

    def test_varargs_vector_spread_example(self) -> None:
        src = """
volume(x, y, z):
    x * y * z

args: [2, 3, 4]
:: volume(:args)
"""
        assert _emit(src) == "24"

    def test_varargs_record_spread_example(self) -> None:
        src = """
point_sum(x, y):
    x + y

point: (y:4, x:3)
:: point_sum(:point)
"""
        assert _emit(src) == "7"


class TestDefaultStructOrder:
    def test_lt_lexicographic(self) -> None:
        src = """
a : (x:1, y:2)
b : (x:1, y:3)
:: (a < b)
"""
        assert _emit(src) == "true"


class TestListRangeAndLambda:
    def test_list_range_expands(self) -> None:
        src = """
v : [1..3]
:: v.0 + v.1 + v.2
"""
        assert _emit(src) == "6"

    def test_lambda_call(self) -> None:
        src = """
:: ((x): x^2)(5)
"""
        assert _emit(src) == "25"

    def test_zero_arg_lambda_call(self) -> None:
        src = """
:: ((): 3)()
"""
        assert _emit(src) == "3"


class TestKeywordOperatorDef:
    def test_and_def(self) -> None:
        # Operator overloads must use custom/constructed parameter types (not num/str/…).
        src = r"""
T(x:num):
    :
/\(a:T, b:T): a.x + b.x
:: /\(T(2), T(3))
"""
        assert _emit(src) == "5"
