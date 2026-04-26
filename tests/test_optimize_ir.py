from __future__ import annotations

from vektorflow.ir import BinaryExpr, CoerceExpr, Const, ExprStmt, IfStmt, LoadSlot, MatchStmt, PrintStmt, ReturnStmt, StoreName, StoreSlot, WhileStmt, lower_module
from vektorflow.optimize_ir import eliminate_noop_coercions, optimize_module
from vektorflow.parser import parse_module
from vektorflow.slot_ir import lower_slots
from vektorflow.stdlib.events import encode_event_code, encode_frame_pattern, encode_ui_pattern
from vektorflow.typed_ir import annotate_module


def test_optimize_ir_constant_folds_arithmetic_bind() -> None:
    mod = parse_module("x: 2 + 3 * 4\n", filename="<opt-ir>")
    lowered = lower_module(mod)
    optimized = optimize_module(lowered)
    bind = optimized.statements[0]
    assert isinstance(bind, StoreName)
    assert isinstance(bind.value, Const)
    assert bind.value.value == 14


def test_optimize_ir_removes_dead_if_and_while_false() -> None:
    mod = parse_module(
        """
false? x: 1
false?> x: 2
y: 3
""",
        filename="<opt-ir>",
    )
    lowered = lower_module(mod)
    optimized = optimize_module(lowered)
    assert len(optimized.statements) == 1
    bind = optimized.statements[0]
    assert isinstance(bind, StoreName)
    assert bind.name == "y"


def test_optimize_ir_reduces_constant_match_to_chosen_arm() -> None:
    exact = encode_event_code("button.pressed", "f1", "save")
    frame = encode_frame_pattern("button.pressed", "f1")
    ui = encode_ui_pattern("button.pressed")
    mod = parse_module(
        f"""
const_x: int({exact})
int({exact})??
    int({ui}) => y: 1
    int({frame}) => y: 2
    int({exact}) => y: 3
z: 4
    """,
        filename="<opt-ir>",
    )
    lowered = lower_module(mod)
    optimized = optimize_module(lowered)
    assert len(optimized.statements) == 3
    assert isinstance(optimized.statements[0], StoreName)
    assert optimized.statements[0].name == "const_x"
    assert isinstance(optimized.statements[1], StoreName)
    assert optimized.statements[1].name == "y"
    assert isinstance(optimized.statements[2], StoreName)
    assert optimized.statements[2].name == "z"


def test_optimize_ir_keeps_dynamic_match_and_loop_shape() -> None:
    mod = parse_module(
        """
x: 1
x??
    1 => y: 2
x<3?>
    x: x + 1
""",
        filename="<opt-ir>",
    )
    lowered = lower_module(mod)
    optimized = optimize_module(lowered)
    assert isinstance(optimized.statements[1], MatchStmt)
    assert isinstance(optimized.statements[2], WhileStmt)


def test_optimize_ir_eliminates_dead_pure_store() -> None:
    mod = parse_module(
        """
f() -> num:
    x: 1
    y: 2 + 3
    x
""",
        filename="<opt-ir>",
    )
    lowered = lower_module(mod)
    optimized = optimize_module(lowered)
    fn = optimized.statements[0]
    assert len(fn.body.statements) == 2
    assert isinstance(fn.body.statements[0], StoreName)
    assert fn.body.statements[0].name == "x"


def test_optimize_ir_simplifies_duplicate_coercion() -> None:
    mod = parse_module("num x: num(3)\n", filename="<opt-ir>")
    lowered = lower_module(mod)
    optimized = optimize_module(lowered)
    bind = optimized.statements[0]
    assert isinstance(bind, StoreName)
    assert isinstance(bind.value, Const)
    assert bind.value.value == 3.0


def test_optimize_ir_forwards_trivial_temp_into_print() -> None:
    mod = parse_module(
        """
f() -> num:
    tmp: 2 + 3
    :: tmp
    0
""",
        filename="<opt-ir>",
    )
    lowered = lower_module(mod)
    optimized = optimize_module(lowered)
    fn = optimized.statements[0]
    assert isinstance(fn.body.statements[0], PrintStmt)
    assert isinstance(fn.body.statements[0].value, Const)
    assert fn.body.statements[0].value.value == 5


def test_optimize_ir_forwards_trivial_temp_into_return() -> None:
    mod = parse_module(
        """
f() -> num:
    tmp: 2 + 3
    @: tmp
""",
        filename="<opt-ir>",
    )
    lowered = lower_module(mod)
    optimized = optimize_module(lowered)
    fn = optimized.statements[0]
    assert len(fn.body.statements) == 1
    assert isinstance(fn.body.statements[0], ReturnStmt)
    assert isinstance(fn.body.statements[0].value, Const)
    assert fn.body.statements[0].value.value == 5


def test_optimize_ir_handles_slot_lowered_block() -> None:
    mod = parse_module(
        """
f(x:num) -> num:
    num a: 1
    num b: x + a
    b
""",
        filename="<opt-ir>",
    )
    lowered = lower_module(mod)
    typed = annotate_module(lowered)
    slotted = lower_slots(lowered, typed)
    optimized = optimize_module(slotted)
    fn = optimized.statements[0]
    assert isinstance(fn.body.statements[0], StoreSlot)
    assert fn.body.statements[0].slot == 1
    assert isinstance(fn.body.statements[1], ExprStmt)
    assert isinstance(fn.body.statements[1].expr, CoerceExpr)
    assert isinstance(fn.body.statements[1].expr.expr, BinaryExpr)
    assert isinstance(fn.body.statements[1].expr.expr.left, LoadSlot)
    assert isinstance(fn.body.statements[1].expr.expr.right, LoadSlot)


def test_eliminate_noop_coercions_removes_redundant_slot_coercion() -> None:
    mod = parse_module(
        """
f(x:num) -> num:
    num a: x
    a
""",
        filename="<opt-ir>",
    )
    lowered = lower_module(mod)
    typed = annotate_module(lowered)
    slotted = lower_slots(lowered, typed)
    typed_slotted = annotate_module(slotted)
    stripped = eliminate_noop_coercions(slotted, typed_slotted)
    fn = stripped.statements[0]
    st0 = fn.body.statements[0]
    assert isinstance(st0, StoreSlot)
    assert isinstance(st0.value, LoadSlot)
