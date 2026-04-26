from __future__ import annotations

from vektorflow.ir import AttrExpr, BinaryExpr, CoerceExpr, LoadSlot, StoreSlot, lower_module
from vektorflow.parser import parse_module
from vektorflow.slot_ir import lower_slots
from vektorflow.typed_ir import annotate_module


def test_slot_ir_rewrites_function_locals_and_params() -> None:
    mod = parse_module(
        """
f(x:num) -> num:
    num a: 1
    num b: x + a
    b
""",
        filename="<slot-ir>",
    )
    lowered = lower_module(mod)
    typed = annotate_module(lowered)
    slotted = lower_slots(lowered, typed)
    fn = slotted.statements[0]
    st0 = fn.body.statements[0]
    st1 = fn.body.statements[1]
    ret = fn.body.statements[2]
    assert isinstance(st0, StoreSlot)
    assert st0.slot == 1
    assert isinstance(st1, StoreSlot)
    assert st1.slot == 2
    assert isinstance(st1.value, CoerceExpr)
    assert isinstance(st1.value.expr, BinaryExpr)
    assert isinstance(st1.value.expr.left, LoadSlot)
    assert st1.value.expr.left.slot == 0
    assert isinstance(st1.value.expr.right, LoadSlot)
    assert st1.value.expr.right.slot == 1
    assert isinstance(ret.expr, LoadSlot)
    assert ret.expr.slot == 2


def test_slot_ir_keeps_module_scope_named_for_now() -> None:
    mod = parse_module(
        """
num x: 3
:: x
""",
        filename="<slot-ir>",
    )
    lowered = lower_module(mod)
    typed = annotate_module(lowered)
    slotted = lower_slots(lowered, typed)
    st = slotted.statements[0]
    assert st.__class__.__name__ == "StoreName"


def test_slot_ir_rewrites_nested_struct_attr_uses() -> None:
    mod = parse_module(
        """
f(x:(left:num, right:num)) -> num:
    x.left
""",
        filename="<slot-ir>",
    )
    lowered = lower_module(mod)
    typed = annotate_module(lowered)
    slotted = lower_slots(lowered, typed)
    fn = slotted.statements[0]
    last = fn.body.statements[0]
    assert isinstance(last.expr, AttrExpr)
    assert isinstance(last.expr.value, LoadSlot)
    assert last.expr.value.slot == 0
