from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow import ast
from vektorflow.errors import EvalError
from vektorflow.interpreter import _stringify
from vektorflow.interpreter import Interpreter
from vektorflow.ir import AttrExpr, BinaryExpr, Block, CallExpr, CoerceExpr, Const, FunctionDef, IfStmt, IndexExpr, LinkedListExpr, ListExpr, LoadName, MapExpr, MatchArm, MatchStmt, Module, MultisetExpr, StdlibImport, StoreName, StructExpr, UnaryExpr, WhileStmt, lower_module
from vektorflow.ir_executor import IRExecutor
from vektorflow.optimize_ir import optimize_module
from vektorflow.parser import parse_module
from vektorflow.runtime.type_values import PrimType
from vektorflow.stdlib.events import encode_event_code, encode_frame_pattern, encode_ui_pattern, encode_widget_pattern


def _run_both(src: str) -> tuple[object, dict[str, object], object, dict[str, object]]:
    mod = parse_module(src, filename="<ir-test>")

    ast_ip = Interpreter(Path(__file__))
    ast_ret = ast_ip.run_module(mod)

    lowered = lower_module(mod)
    ir_ip = IRExecutor(Path(__file__))
    ir_ret = ir_ip.run_module(lowered)

    return ast_ret, ast_ip.globals, ir_ret, ir_ip.globals


def test_ir_parity_literals_binds_and_binops() -> None:
    src = """
a: 4
b: 6
c: a * b + 3
flag: c > 20
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["a"] == ast_globals["a"] == 4
    assert ir_globals["b"] == ast_globals["b"] == 6
    assert ir_globals["c"] == ast_globals["c"] == 27
    assert ir_globals["flag"] == ast_globals["flag"] is True


def test_ir_parity_mixed_string_operator_fallbacks() -> None:
    src = """
a: "x=" + 3
b: "y=" & 4
c: 5 + "z"
d: 6 & "w"
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["a"] == ast_globals["a"] == "x=3"
    assert ir_globals["b"] == ast_globals["b"] == "y=4"
    assert ir_globals["c"] == ast_globals["c"] == "5z"
    assert ir_globals["d"] == ast_globals["d"] == "6w"


def test_ir_parity_type_value_binary_fallbacks() -> None:
    src = """
eq1: int = num
eq2: int = int
neq1: int != num
neq2: int != int
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["eq1"] == ast_globals["eq1"] is False
    assert ir_globals["eq2"] == ast_globals["eq2"] is True
    assert ir_globals["neq1"] == ast_globals["neq1"] is True
    assert ir_globals["neq2"] == ast_globals["neq2"] is False


def test_ir_parity_truthiness_control_and_not_fallbacks() -> None:
    src = """
empty: []
full: [1]
a: ~empty
b: ~full
out: 0
empty? out: 1
full? out: 2
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["a"] == ast_globals["a"] is True
    assert ir_globals["b"] == ast_globals["b"] is False
    assert ir_globals["out"] == ast_globals["out"] == 2


def test_ir_parity_typed_coercion_surface() -> None:
    src = """
f(x:int) -> num:
    x

out: f(true)
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["out"] == ast_globals["out"] == 1.0


def test_optimize_ir_uses_shared_primitive_cast_runtime_semantics() -> None:
    lowered = Module(
        [
            StoreName("a", CallExpr(LoadName("int"), [Const(3.0)], [], [])),
            StoreName("b", CallExpr(LoadName("num"), [Const(True)], [], [])),
            StoreName("bad", CallExpr(LoadName("int"), [Const(3.5)], [], [])),
        ]
    )
    optimized = optimize_module(lowered)

    assert isinstance(optimized.statements[0], StoreName)
    assert optimized.statements[0].value == Const(3)
    assert isinstance(optimized.statements[1], StoreName)
    assert optimized.statements[1].value == Const(1.0)
    assert isinstance(optimized.statements[2], StoreName)
    assert isinstance(optimized.statements[2].value, CallExpr)


def test_optimize_ir_uses_shared_typed_coercion_runtime_semantics() -> None:
    lowered = Module(
        [
            StoreName("a", CoerceExpr(Const(True), ast.PrimTypeRef("num")), None),
            StoreName("b", CoerceExpr(Const(3.5), ast.PrimTypeRef("int")), None),
        ]
    )
    optimized = optimize_module(lowered)

    assert isinstance(optimized.statements[0], StoreName)
    assert optimized.statements[0].value == Const(1.0)
    assert isinstance(optimized.statements[1], StoreName)
    assert isinstance(optimized.statements[1].value, CoerceExpr)


def test_optimize_ir_uses_shared_const_operator_runtime_semantics() -> None:
    lowered = Module(
        [
            StoreName("a", BinaryExpr("PLUS", Const("x="), Const(3)), None),
            StoreName("b", BinaryExpr("OR", Const([]), Const([1])), None),
            StoreName("c", UnaryExpr("NOT", Const([])), None),
            StoreName("d", BinaryExpr("EQ", Const(PrimType("int")), Const(PrimType("num"))), None),
        ]
    )
    optimized = optimize_module(lowered)

    assert isinstance(optimized.statements[0], StoreName)
    assert optimized.statements[0].value == Const("x=3")
    assert isinstance(optimized.statements[1], StoreName)
    assert optimized.statements[1].value == Const(True)
    assert isinstance(optimized.statements[2], StoreName)
    assert optimized.statements[2].value == Const(True)
    assert isinstance(optimized.statements[3], StoreName)
    assert optimized.statements[3].value == Const(False)


def test_optimize_ir_uses_shared_const_dot_runtime_semantics() -> None:
    lowered = Module(
        [
            StoreName("a", AttrExpr(StructExpr([("x", Const(7)), ("y", Const(8))]), "x"), None),
            StoreName("b", IndexExpr(MapExpr([("a", Const(1)), ("b", Const(2))]), [Const("a"), Const("b")]), None),
            StoreName("c", IndexExpr(ListExpr([Const(10), Const(20)]), [Const(1)]), None),
        ]
    )
    optimized = optimize_module(lowered)

    assert isinstance(optimized.statements[0], StoreName)
    assert optimized.statements[0].value == Const(7)
    assert isinstance(optimized.statements[1], StoreName)
    assert optimized.statements[1].value == Const((1, 2))
    assert isinstance(optimized.statements[2], StoreName)
    assert optimized.statements[2].value == Const(20)


def test_optimize_ir_uses_shared_truthiness_control_semantics() -> None:
    lowered = Module(
        [
            StoreName("not_empty", UnaryExpr("NOT", Const([])), None),
            StoreName("either", BinaryExpr("OR", Const([]), Const([1])), None),
            IfStmt(Const([]), Block([StoreName("dead", Const(1), None)])),
            IfStmt(Const([1]), Block([StoreName("live", Const(2), None)])),
            WhileStmt(Const([]), Block([StoreName("loop_dead", Const(3), None)])),
        ]
    )
    optimized = optimize_module(lowered)

    assert len(optimized.statements) == 3
    assert isinstance(optimized.statements[0], StoreName)
    assert optimized.statements[0].value == Const(True)
    assert isinstance(optimized.statements[1], StoreName)
    assert optimized.statements[1].value == Const(True)
    assert isinstance(optimized.statements[2], StoreName)
    assert optimized.statements[2].name == "live"
    assert optimized.statements[2].value == Const(2)


def test_ir_collects_top_level_stdlib_imports_as_module_metadata() -> None:
    lowered = lower_module(
        parse_module(
            "math: .math\n:.collections\n:: math.sin(0)\n",
            filename="<ir-test>",
        )
    )
    assert lowered.stdlib_imports == [
        StdlibImport(module_name="math", binding_name="math", spill_exports=False),
        StdlibImport(module_name="collections", binding_name="collections", spill_exports=True),
    ]
    assert len(lowered.statements) == 1


def test_ir_parity_conditional_effects() -> None:
    src = """
x: 3
x > 0?
    y: x + 10
z: y * 2
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["y"] == ast_globals["y"] == 13
    assert ir_globals["z"] == ast_globals["z"] == 26


def test_ir_parity_top_level_return_channel() -> None:
    src = """
score: 9
score > 5? @: score + 1
score: 0
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ast_ret == 10
    assert ir_ret == 10
    assert ast_globals["score"] == 9
    assert ir_globals["score"] == 9


def test_ir_lowering_rejects_unsupported_nodes_for_now() -> None:
    mod = parse_module('msg: "x=$y"', filename="<ir-test>")
    with pytest.raises(NotImplementedError):
        lower_module(mod)
    catch_mod = parse_module("missing!?\n  errors.Error => out: 1\n", filename="<ir-test>")
    with pytest.raises(NotImplementedError):
        lower_module(catch_mod)


def test_ir_parity_function_call_and_implicit_return() -> None:
    src = """
twice(x):
    x * 2

out: twice(7)
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["out"] == ast_globals["out"] == 14


def test_ir_parity_function_early_return_channel() -> None:
    src = """
classify(x):
    x > 0? @: x + 1
    0

a: classify(4)
b: classify(-2)
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["a"] == ast_globals["a"] == 5
    assert ir_globals["b"] == ast_globals["b"] == 0


def test_ir_parity_function_closure_snapshot() -> None:
    src = """
scale: 2
mul(x):
    x * scale

scale: 5
out: mul(3)
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["out"] == ast_globals["out"] == 6


def test_ir_preserves_symbolic_fixed_vector_function_metadata() -> None:
    mod = parse_module(
        "func(x:[num:n]) -> x:[num:n+1]: 0",
        filename="<ir-test>",
    )
    lowered = lower_module(mod)
    fn = lowered.statements[0]
    assert isinstance(fn, FunctionDef)
    assert fn.param_types[0] is not None
    assert fn.return_type is not None


def test_ir_preserves_prefix_typed_bind_metadata() -> None:
    mod = parse_module("[num:2] v: [1,2]", filename="<ir-test>")
    lowered = lower_module(mod)
    st = lowered.statements[0]
    assert isinstance(st, StoreName)
    assert st.declared_type is not None
    assert isinstance(st.value, CoerceExpr)


def test_ir_lowers_struct_literal_and_attribute() -> None:
    mod = parse_module("(x:num, y:num) p: (x:1, y:2)\n:: p.x\n", filename="<ir-test>")
    lowered = lower_module(mod)
    st = lowered.statements[0]
    assert isinstance(st, StoreName)
    assert isinstance(st.value, CoerceExpr)
    assert isinstance(st.value.expr, StructExpr)
    pr = lowered.statements[1]
    assert isinstance(pr.value, AttrExpr)


def test_ir_lowers_dotted_index() -> None:
    mod = parse_module("[num:3] xs: [1,2,3]\n:: xs.1\n", filename="<ir-test>")
    lowered = lower_module(mod)
    pr = lowered.statements[1]
    assert isinstance(pr.value, IndexExpr)
    assert len(pr.value.indices) == 1


def test_ir_lowers_conditional_loop() -> None:
    mod = parse_module("k:0\nk<3?> k:k+1\n", filename="<ir-test>")
    lowered = lower_module(mod)
    assert isinstance(lowered.statements[1], WhileStmt)


def test_ir_lowers_match_loop() -> None:
    mod = parse_module("k:0\nk??> 0 => @|\n", filename="<ir-test>")
    lowered = lower_module(mod)
    assert isinstance(lowered.statements[1], MatchStmt)
    assert lowered.statements[1].loop is True


def test_ir_parity_prefix_typed_bind_and_symbolic_sizes() -> None:
    src = """
[num:2] base: [1, true]
join(x:[num:n], y:[num:m]) -> [num:n+m]:
    x & y

out: join(base, [3,4,5])
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["base"] == ast_globals["base"] == [1.0, 1.0]
    assert ir_globals["out"] == ast_globals["out"] == [1.0, 1.0, 3.0, 4.0, 5.0]


def test_ir_executor_runtime_collection_constructors_use_runtime_seam() -> None:
    module = Module(
        [
            StoreName("m", MapExpr([("a", Const(1)), ("b", Const(2))])),
            StoreName("L", LinkedListExpr([], spread=Const([3, 4]))),
            StoreName("S", MultisetExpr([(Const(1), Const(2)), (Const(3), Const(1))])),
        ]
    )
    ip = IRExecutor(Path(__file__))
    ret = ip.run_module(module)
    assert ret is None
    assert list(ip.globals["m"].items()) == [("a", 1), ("b", 2)]
    assert list(ip.globals["L"]) == [3, 4]
    assert ip.globals["S"].count(1) == 2
    assert ip.globals["S"].count(3) == 1


def test_ir_parity_conditional_loop_and_match_loop() -> None:
    src = """
k: 0
k<3?>
    k: k + 1
    @>
flag: 0
flag??>
    0 =>
        flag: 1
        @>
    1 => @|
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["k"] == ast_globals["k"] == 3
    assert ir_globals["flag"] == ast_globals["flag"] == 1


def test_ir_parity_return_channel_inside_control_flow() -> None:
    src = """
f(x):
    x > 0? @: x + 1
    x??>
        -1 => @: 99
        0 => @|
    k: 0
    k < 5?>
        k: k + 1
        k = 3? @: k * 10
        @>
    0

a: f(4)
b: f(0)
c: f(-1)
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["a"] == ast_globals["a"] == 5
    assert ir_globals["b"] == ast_globals["b"] == 30
    assert ir_globals["c"] == ast_globals["c"] == 99


def test_ir_parity_bitmask_match_specificity() -> None:
    exact = encode_event_code("button.pressed", "f1", "save")
    frame = encode_frame_pattern("button.pressed", "f1")
    widget = encode_widget_pattern("button.pressed", "save")
    ui = encode_ui_pattern("button.pressed")
    src = f"""
int x: int({exact})
out: 0
x??
    int({ui}) => out: 1
    int({frame}) => out: 2
    int({widget}) => out: 3
    int({exact}) => out: 4
:: out
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["out"] == ast_globals["out"] == 4


def test_ir_parity_bitmask_match_loop_specificity() -> None:
    exact = encode_event_code("button.pressed", "f1", "save")
    frame = encode_frame_pattern("button.pressed", "f1")
    ui = encode_ui_pattern("button.pressed")
    src = f"""
int x: int({exact})
out: 0
x??>
    int({ui}) => out: 1
    int({frame}) =>
        out: 2
        @|
    int({exact}) =>
        out: 3
        @|
:: out
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert ir_globals["out"] == ast_globals["out"] == 3


def test_optimize_ir_uses_shared_const_match_selection_specificity() -> None:
    exact = encode_event_code("button.pressed", "f1", "save")
    frame = encode_frame_pattern("button.pressed", "f1")
    widget = encode_widget_pattern("button.pressed", "save")
    ui = encode_ui_pattern("button.pressed")
    lowered = Module(
        [
            StoreName("out", Const(0), None),
            MatchStmt(
                Const(exact),
                [
                    MatchArm(Const(ui), Block([StoreName("out", Const(1), None)])),
                    MatchArm(Const(frame), Block([StoreName("out", Const(2), None)])),
                    MatchArm(Const(widget), Block([StoreName("out", Const(3), None)])),
                    MatchArm(Const(exact), Block([StoreName("out", Const(4), None)])),
                ],
                loop=False,
            ),
        ]
    )
    optimized = optimize_module(lowered)
    assert not any(isinstance(stmt, MatchStmt) for stmt in optimized.statements)

    ir_ip = IRExecutor(Path(__file__))
    ir_ret = ir_ip.run_module(optimized)

    assert ir_ret is None
    assert ir_ip.globals["out"] == 4


def test_ir_preserves_structured_symbolic_type_metadata() -> None:
    mod = parse_module(
        "push_right(p:(left:[num:n], right:[num:m]), extra:[num:k]) -> (left:[num:n], right:[num:m+k]): 0",
        filename="<ir-test>",
    )
    lowered = lower_module(mod)
    fn = lowered.statements[0]
    assert isinstance(fn, FunctionDef)
    assert fn.param_types[0] is not None
    assert fn.return_type is not None


def test_ir_lowers_multiset_literal() -> None:
    mod = parse_module("{num} bag: {1:2, 3:1}\n", filename="<ir-test>")
    lowered = lower_module(mod)
    st = lowered.statements[0]
    assert isinstance(st, StoreName)
    assert isinstance(st.value, CoerceExpr)
    assert isinstance(st.value.expr, MultisetExpr)


def test_ir_parity_typed_multiset_bind_and_union() -> None:
    src = """
{num} a: {1:2, 3:1}
{num} b: {3:2}
out: a + b
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert _stringify(ir_globals["out"], {}) == _stringify(ast_globals["out"], {})


def test_ir_parity_multiset_function_param_and_return() -> None:
    src = """
merge(a:{num}, b:{num}) -> {num}:
    a + b

out: merge({1:1}, {2:2})
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert _stringify(ir_globals["out"], {}) == _stringify(ast_globals["out"], {})


def test_ir_lowers_collection_constructor_calls_as_collection_exprs() -> None:
    mod = parse_module("m: collections.map(a:1, b:true)\nL: collections.list(:[1,2,3])\n", filename="<ir-test>")
    lowered = lower_module(mod)
    assert isinstance(lowered.statements[0], StoreName)
    assert isinstance(lowered.statements[0].value, MapExpr)
    assert [name for name, _ in lowered.statements[0].value.fields] == ["a", "b"]
    assert isinstance(lowered.statements[1], StoreName)
    assert isinstance(lowered.statements[1].value, LinkedListExpr)
    assert lowered.statements[1].value.spread is not None


def test_ir_lowers_operator_callable_refs_as_call_exprs() -> None:
    mod = parse_module(
        """
Point : (x:num)

+(a:Point, b:num):
    a.x + b

Point p: (x:3,)
out: +(p, 4)
""",
        filename="<ir-test>",
    )
    lowered = lower_module(mod)
    assert isinstance(lowered.statements[-1], StoreName)
    assert isinstance(lowered.statements[-1].value, CallExpr)
    assert isinstance(lowered.statements[-1].value.func, LoadName)
    assert lowered.statements[-1].value.func.name == "+"


def test_ir_parity_map_and_linked_list_runtime_subset() -> None:
    src = """collections: .collections

m: collections.map(a:1, b:"hi", c:true)
L: collections.list(1, 2, 3)
x: m.a
"""
    ast_ret, ast_globals, ir_ret, ir_globals = _run_both(src)
    assert ir_ret == ast_ret
    assert _stringify(ir_globals["m"], {}) == _stringify(ast_globals["m"], {})
    assert _stringify(ir_globals["L"], {}) == _stringify(ast_globals["L"], {})
    assert ir_globals["x"] == ast_globals["x"] == 1


def test_interpreter_run_module_uses_ir_for_supported_subset() -> None:
    mod = parse_module(
        """
seed: 4
twice(x):
    x * 2

out: twice(seed + 3)
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ir"
    assert ip.globals["seed"] == 4
    assert ip.globals["out"] == 14


def test_interpreter_ir_execution_preserves_existing_globals() -> None:
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module("base: 10\n", filename="<ir-test>"))
    ret = ip.run_module(parse_module("next: base + 5\n", filename="<ir-test>"))
    assert ret is None
    assert ip.last_execution_engine == "ir"
    assert ip.globals["base"] == 10
    assert ip.globals["next"] == 15


def test_interpreter_falls_back_to_ast_for_non_lowerable_module() -> None:
    mod = parse_module('value: 4\nmsg: "x=$value"\n', filename="<ir-test>")
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.globals["msg"] == "x=4"


def test_interpreter_uses_ir_for_lowerable_function_inside_ast_module() -> None:
    mod = parse_module(
        """
value: 4
msg: "x=$value"
twice(x):
    x * 2

out: twice(value + 3)
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.last_function_execution_engine == "ir"
    assert ip.globals["msg"] == "x=4"
    assert ip.globals["out"] == 14


def test_interpreter_uses_ir_for_recursive_lowerable_function_calls_inside_ast_module() -> None:
    mod = parse_module(
        """
seed: 3
label: "seed=$seed"
count_down(n):
    n = 0? @: 0
    count_down(n - 1)

out: count_down(3)
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.last_function_execution_engine == "ir"
    assert ip.globals["out"] == 0


def test_interpreter_falls_back_to_ast_for_non_lowerable_function_body() -> None:
    mod = parse_module(
        """
label(x):
    "x=$x"

out: label(4)
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.last_function_execution_engine == "ast"
    assert ip.globals["out"] == "x=4"


def test_interpreter_routes_struct_constructor_calls_through_execution_seam() -> None:
    mod = parse_module(
        """
seed: 2
label: "seed=$seed"
Point(x:num, y:num):

p: Point(3, 4)
out: p.x + p.y
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.last_callable_execution_engine == "runtime"
    assert ip.globals["out"] == 7


def test_interpreter_routes_custom_cast_calls_through_execution_seam() -> None:
    mod = parse_module(
        """
seed: 2
label: "seed=$seed"
Point(x:num):

num(p:Point):
    p.x + 1

out: num(Point(3))
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.last_callable_execution_engine == "ir"
    assert ip.globals["out"] == 4


def test_interpreter_routes_builtin_cast_fallback_through_callable_seam() -> None:
    mod = parse_module(
        """
seed: 2
label: "seed=$seed"
out: num(true)
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.last_callable_execution_engine == "runtime"
    assert ip.globals["out"] == 1.0


def test_interpreter_routes_operator_callable_overloads_through_execution_seam() -> None:
    mod = parse_module(
        """
seed: 2
label: "seed=$seed"
Point(x:num):

+(a:Point, b:num):
    a.x + b

out: +(Point(3), 4)
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.last_callable_execution_engine == "ir"
    assert ip.globals["out"] == 7


def test_interpreter_routes_collection_constructor_calls_through_execution_seam() -> None:
    mod = parse_module(
        """
collections: .collections
seed: 2
label: "seed=$seed"
m: collections.map(a:1, b:true)
L: collections.list(:[1,2,3])
out: m.a
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.last_callable_execution_engine == "runtime"
    assert ip.globals["out"] == 1


def test_interpreter_run_module_uses_ir_for_collection_constructor_alias_calls() -> None:
    mod = parse_module(
        """
collections: .collections
mk: collections.list
out: mk(1, 2, 3)
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ir"
    assert _stringify(ip.globals["out"], {}) == "[1, 2, 3]"


def test_interpreter_run_module_uses_ir_for_collection_constructor_alias_calls_with_named_and_spread_args() -> None:
    mod = parse_module(
        """
collections: .collections
mkmap: collections.map
mklist: collections.list
m: mkmap(a:1, b:true)
L: mklist(:[1,2,3])
out: m.a
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ir"
    assert ip.globals["out"] == 1
    assert _stringify(ip.globals["L"], {}) == "[1, 2, 3]"


def test_interpreter_run_module_uses_ir_for_operator_callable_overload_family() -> None:
    mod = parse_module(
        """
Point : (x:num)

+(a:Point, b:num):
    a.x + b

+(a:Point, b:Point):
    a.x + b.x

Point p: (x:3,)
Point q: (x:5,)
left: +(p, 4)
right: +(p, q)
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ir"
    assert ip.globals["left"] == 7
    assert ip.globals["right"] == 8


def test_interpreter_run_module_uses_ir_for_infix_operator_overload_family() -> None:
    mod = parse_module(
        """
Point : (x:num)

+(a:Point, b:num):
    a.x + b

Point p: (x:3,)
out: p + 4
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ir"
    assert ip.globals["out"] == 7


def test_interpreter_run_module_uses_ir_for_unary_operator_overload_family() -> None:
    mod = parse_module(
        """
Point : (x:num)

-(a:Point):
    a.x

Point p: (x:3,)
out: -p
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ir"
    assert ip.globals["out"] == 3


def test_interpreter_run_module_uses_ir_for_dot_overload_read_family() -> None:
    mod = parse_module(
        """
Pair : (x:num, y:num)

.(p:Pair, key:str):
    key = "left"? @: p.x
    key = "right"? @: p.y
    @

Pair p: (x:3, y:4)
left: p.left
right: p.("right")
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ir"
    assert ip.globals["left"] == 3
    assert ip.globals["right"] == 4


def test_interpreter_ast_fallback_keeps_dot_attr_write_family_working() -> None:
    mod = parse_module(
        """
seed: 2
label: "seed=$seed"
Point : (x:num, y:num)
Point p: (x:1, y:2)
p.x: 7
out: p.x
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.globals["out"] == 7


def test_interpreter_ast_fallback_keeps_dot_index_write_family_working() -> None:
    mod = parse_module(
        """
collections: .collections
seed: 2
label: "seed=$seed"
m: collections.map(a:1, b:2)
m.("a"): 7
out: m.a
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.globals["out"] == 7


def test_interpreter_ast_fallback_uses_execution_seam_for_string_interpolation_paths() -> None:
    mod = parse_module(
        """
Point : (x:num, y:num)
Point p: (x:3, y:4)
msg: "x=$p.x y=$p.y"
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.globals["msg"] == "x=3 y=4"


def test_interpreter_ast_fallback_uses_dot_overload_path_for_string_interpolation() -> None:
    mod = parse_module(
        """
Pair : (x:num, y:num)

.(p:Pair, key:str):
    key = "left"? @: p.x
    key = "right"? @: p.y
    @

Pair p: (x:3, y:4)
msg: "left=$p.left right=$p.right"
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.globals["msg"] == "left=3 right=4"


def test_interpreter_ast_fallback_uses_execution_seam_for_function_binding_attr_reads() -> None:
    mod = parse_module(
        """
seed: 2
label: "seed=$seed"
f(x):
    scale: 2
out: f.scale
expr: f.scale
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.globals["out"] == 2.0
    assert ip.globals["expr"] == 2.0


def test_interpreter_ast_fallback_uses_execution_seam_for_param_referencing_function_binding_attr_reads() -> None:
    mod = parse_module(
        """
seed: 2
label: "seed=$seed"
f(x):
    expr: x + 1
out: f.expr
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.globals["out"] == "x+1"


def test_interpreter_ast_fallback_uses_execution_seam_for_idx_attr_reads() -> None:
    mod = parse_module(
        """
seed: 2
label: "seed=$seed"
v : [1, 2]_ij
out: v.idx
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.globals["out"] == "ij"


def test_interpreter_ast_fallback_uses_execution_seam_for_idx_attr_writes() -> None:
    mod = parse_module(
        """
seed: 2
label: "seed=$seed"
v : [1, 2]_i
v.idx : "ij"
out: v.idx
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.globals["out"] == "ij"


def test_interpreter_ast_fallback_uses_execution_seam_for_multi_key_dot_index_reads() -> None:
    mod = parse_module(
        """
collections: .collections
seed: 2
label: "seed=$seed"
m: collections.map(a:1, b:2)
out: m.("a", "b")
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.globals["out"] == (1, 2)


def test_interpreter_ast_catch_match_uses_shared_match_selection() -> None:
    mod = parse_module(
        """
errors: .errors
missing!?
  errors.Error => out: 1
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    ret = ip.run_module(mod)
    assert ret is None
    assert ip.last_execution_engine == "ast"
    assert ip.globals["out"] == 1


def test_interpreter_ast_catch_match_rethrows_when_no_arm_matches() -> None:
    mod = parse_module(
        """
missing!?
  0 => out: 1
""",
        filename="<ir-test>",
    )
    ip = Interpreter(Path(__file__))
    with pytest.raises(EvalError, match="undefined name"):
        ip.run_module(mod)
