from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow.interpreter import _stringify
from vektorflow.interpreter import Interpreter
from vektorflow.ir import AttrExpr, CoerceExpr, Const, FunctionDef, IndexExpr, LinkedListExpr, MapExpr, MatchStmt, Module, MultisetExpr, StdlibImport, StoreName, StructExpr, WhileStmt, lower_module
from vektorflow.ir_executor import IRExecutor
from vektorflow.parser import parse_module
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
    catch_mod = parse_module("missing!?\n  errors.ERROR => out: 1\n", filename="<ir-test>")
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


def test_ir_lowers_map_and_linked_list_ctors() -> None:
    mod = parse_module("m: collections.map(a:1, b:true)\nL: collections.list(:[1,2,3])\n", filename="<ir-test>")
    lowered = lower_module(mod)
    assert isinstance(lowered.statements[0], StoreName)
    assert isinstance(lowered.statements[0].value, MapExpr)
    assert isinstance(lowered.statements[1], StoreName)
    assert isinstance(lowered.statements[1].value, LinkedListExpr)
    assert lowered.statements[1].value.spread is not None


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
