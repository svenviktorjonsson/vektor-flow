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
            "radius": 1.8,
            "blocked_by_same_layer": True,
            "illuminates_lower_layers": True,
        }
        assert meshes["lower_room_backgrounds"]["physics"]["layer"] == 0
        assert meshes["lower_room_backgrounds"]["physics"]["light_result"] == "lit_through_room_openings"
        assert meshes["light_path_through_openings"]["physics"]["layer"] == 0
        assert meshes["light_path_through_openings"]["physics"]["light_result"] == (
            "passes_through_two_wall_openings"
        )
        assert meshes["same_layer_room_walls"]["physics"]["layer"] == 1
        assert meshes["same_layer_room_walls"]["physics"]["blocks_light"] is True
        assert meshes["closed_wall_shadow"]["physics"]["light_result"] == "blocks_light_outside_openings"
        assert meshes["upper_ambient_text"]["physics"]["layer"] == 2
        assert meshes["upper_ambient_text"]["physics"]["ambient_only"] is True
        assert meshes["upper_ambient_text"]["physics"]["light_result"] == "ambient_only_text_above_light"


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
