from __future__ import annotations

from vektorflow import ast
from vektorflow.ir import AttrExpr, BinaryExpr, CallExpr, IndexExpr, StoreName, lower_module
from vektorflow.parser import parse_module
from vektorflow.typed_ir import annotate_module


def test_typed_ir_tracks_scalar_bind_and_call_types() -> None:
    mod = parse_module(
        """
twice(x:num) -> num:
    x * 2

num a: 3
out: twice(a)
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    fn = lowered.statements[0]
    bind_a = lowered.statements[1]
    bind_out = lowered.statements[2]
    assert isinstance(bind_a, StoreName)
    assert isinstance(bind_out, StoreName)
    assert isinstance(info.expr_type(bind_a.value), ast.PrimTypeRef)
    assert info.expr_type(bind_a.value).name == "num"
    assert isinstance(bind_out.value, CallExpr)
    assert isinstance(info.expr_type(bind_out.value), ast.PrimTypeRef)
    assert info.expr_type(bind_out.value).name == "num"
    assert info.function_envs[fn.name]["x"].name == "num"
    assert info.function_slots[fn.name]["x"] == 0
    assert info.module_slots["a"] == 0
    assert info.module_slots["out"] == 1


def test_typed_ir_tracks_vector_and_struct_expression_types() -> None:
    mod = parse_module(
        """
[num:2] a: [1,2]
[num:2] b: [3,4]
sum: a + b
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_sum = lowered.statements[2]
    assert isinstance(bind_sum, StoreName)
    assert isinstance(bind_sum.value, BinaryExpr)
    sum_type = info.expr_type(bind_sum.value)
    assert isinstance(sum_type, ast.FixedVectorType)
    assert isinstance(sum_type.size, ast.TypeSizeConst)
    assert sum_type.size.value == 2


def test_typed_ir_tracks_struct_and_attribute_types() -> None:
    mod = parse_module(
        """
(x:num, y:num) p: (x:1, y:2)
px: p.x
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_p = lowered.statements[0]
    bind_px = lowered.statements[1]
    assert isinstance(bind_p, StoreName)
    p_type = info.expr_type(bind_p.value)
    assert isinstance(p_type, ast.TypeExpr)
    assert [name for name, _ in p_type.fields] == ["x", "y"]
    assert isinstance(bind_px, StoreName)
    assert isinstance(bind_px.value, AttrExpr)
    px_type = info.expr_type(bind_px.value)
    assert isinstance(px_type, ast.PrimTypeRef)
    assert px_type.name == "num"


def test_typed_ir_tracks_fixed_vector_index_type() -> None:
    mod = parse_module(
        """
[num:3] xs: [1,2,3]
mid: xs.1
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_mid = lowered.statements[1]
    assert isinstance(bind_mid, StoreName)
    assert isinstance(bind_mid.value, IndexExpr)
    mid_t = info.expr_type(bind_mid.value)
    assert isinstance(mid_t, ast.PrimTypeRef)
    assert mid_t.name == "num"


def test_typed_ir_tracks_math_and_stat_intrinsics() -> None:
    mod = parse_module(
        """
angle: math.sin(0)
mu: stat.mean([1,2,3,4])
sigma: stat.std([2,4,4,4,5,5,7,9])
counted: stat.count([1,2,3])
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_angle = lowered.statements[0]
    bind_mu = lowered.statements[1]
    bind_sigma = lowered.statements[2]
    bind_counted = lowered.statements[3]
    assert isinstance(bind_angle, StoreName)
    assert isinstance(info.expr_type(bind_angle.value), ast.PrimTypeRef)
    assert info.expr_type(bind_angle.value).name == "num"
    assert isinstance(bind_mu, StoreName)
    assert info.expr_type(bind_mu.value).name == "num"
    assert isinstance(bind_sigma, StoreName)
    assert info.expr_type(bind_sigma.value).name == "num"
    assert isinstance(bind_counted, StoreName)
    assert info.expr_type(bind_counted.value).name == "int"


def test_typed_ir_tracks_symbolic_template_return_type() -> None:
    mod = parse_module(
        """
join(x:[num:n], y:[num:m]) -> [num:n+m]:
    x & y
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    fn = lowered.statements[0]
    last = fn.body.statements[0]
    expr = last.expr
    out_t = info.expr_type(expr)
    assert isinstance(out_t, ast.FixedVectorType)
    assert isinstance(out_t.size, ast.TypeSizeBinOp)


def test_typed_ir_tracks_local_slots_in_function_body() -> None:
    mod = parse_module(
        """
f(x:num) -> num:
    num a: 1
    num b: x + a
    b
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    slots = info.function_slots["f"]
    assert slots["x"] == 0
    assert slots["a"] == 1
    assert slots["b"] == 2


def test_typed_ir_tracks_nested_record_vector_return_types() -> None:
    mod = parse_module(
        """
make() -> (pts:[num:2], meta:(x:num, y:num)):
    (pts:[1,2], meta:(x:3, y:4))

v: make().pts
m: make().meta
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_v = lowered.statements[1]
    bind_m = lowered.statements[2]
    v_t = info.expr_type(bind_v.value)
    m_t = info.expr_type(bind_m.value)
    assert isinstance(v_t, ast.FixedVectorType)
    assert isinstance(v_t.size, ast.TypeSizeConst)
    assert v_t.size.value == 2
    assert isinstance(m_t, ast.TypeExpr)
    assert [name for name, _ in m_t.fields] == ["x", "y"]


def test_typed_ir_tracks_multiset_literal_and_union_types() -> None:
    mod = parse_module(
        """
{num} a: {1:2, 3:1}
{num} b: {3:2}
out: a + b
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_out = lowered.statements[2]
    out_t = info.expr_type(bind_out.value)
    assert isinstance(out_t, ast.MultisetType)
    assert isinstance(out_t.element_type, ast.PrimTypeRef)
    assert out_t.element_type.name == "num"


def test_typed_ir_tracks_nested_record_with_multiset_field() -> None:
    mod = parse_module(
        """
make() -> (bag:{num}, total:num):
    (bag:{1:2, 3:1}, total:3)

out: make()
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_out = lowered.statements[1]
    out_t = info.expr_type(bind_out.value)
    assert isinstance(out_t, ast.TypeExpr)
    fields = dict(out_t.fields)
    assert isinstance(fields["bag"], ast.MultisetType)
    assert isinstance(fields["total"], ast.PrimTypeRef)


def test_typed_ir_tracks_record_with_vector_and_multiset_fields() -> None:
    mod = parse_module(
        """
make() -> (pts:[num:2], bag:{num}, total:num):
    (pts:[1,2], bag:{3:1, 4:2}, total:3)

out: make()
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_out = lowered.statements[1]
    out_t = info.expr_type(bind_out.value)
    assert isinstance(out_t, ast.TypeExpr)
    fields = dict(out_t.fields)
    assert isinstance(fields["pts"], ast.FixedVectorType)
    assert isinstance(fields["bag"], ast.MultisetType)
    assert isinstance(fields["total"], ast.PrimTypeRef)


def test_typed_ir_tracks_transformed_record_with_vector_and_multiset_fields() -> None:
    mod = parse_module(
        """
update(state:(pts:[num:2], bag:{num}, total:num), extra:[num:2], delta:{num}) -> (pts:[num:2], bag:{num}, total:num):
    (pts:state.pts + extra, bag:state.bag + delta, total:state.total + 2)

out: update((pts:[1,2], bag:{3:1}, total:1), [4,5], {6:2})
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_out = lowered.statements[1]
    out_t = info.expr_type(bind_out.value)
    assert isinstance(out_t, ast.TypeExpr)
    fields = dict(out_t.fields)
    assert isinstance(fields["pts"], ast.FixedVectorType)
    assert isinstance(fields["bag"], ast.MultisetType)
    assert isinstance(fields["total"], ast.PrimTypeRef)


def test_typed_ir_tracks_map_fields_and_linked_list_elements() -> None:
    mod = parse_module(
        """
m: collections.map(a:1, b:"hi", c:true)
L: collections.list(:[1,2,3])
x: m.b
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_m = lowered.statements[0]
    bind_l = lowered.statements[1]
    bind_x = lowered.statements[2]
    m_t = info.expr_type(bind_m.value)
    l_t = info.expr_type(bind_l.value)
    x_t = info.expr_type(bind_x.value)
    assert isinstance(m_t, ast.MapValueType)
    assert [name for name, _ in m_t.fields] == ["a", "b", "c"]
    assert isinstance(l_t, ast.LinkedListValueType)
    assert len(l_t.elements) == 3
    assert all(isinstance(elem, ast.PrimTypeRef) and elem.name == "num" for elem in l_t.elements)
    assert isinstance(x_t, ast.PrimTypeRef)
    assert x_t.name == "str"


def test_typed_ir_tracks_record_with_map_and_list_fields() -> None:
    mod = parse_module(
        """
make() -> (meta:map(name:str, ok:bool), items:list(num, num, num), total:num):
    (meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2,3]), total:3)

out: make()
name: out.meta.name
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_out = lowered.statements[1]
    bind_name = lowered.statements[2]
    out_t = info.expr_type(bind_out.value)
    name_t = info.expr_type(bind_name.value)
    assert isinstance(out_t, ast.TypeExpr)
    fields = dict(out_t.fields)
    assert isinstance(fields["meta"], ast.MapValueType)
    assert isinstance(fields["items"], ast.LinkedListValueType)
    assert isinstance(fields["total"], ast.PrimTypeRef)
    assert isinstance(name_t, ast.PrimTypeRef)
    assert name_t.name == "str"


def test_typed_ir_tracks_transformed_record_with_map_and_list_fields() -> None:
    mod = parse_module(
        """
update(state:(meta:map(name:str, ok:bool), items:list(num, num), total:num)) -> (meta:map(name:str, ok:bool), items:list(num, num, num), total:num):
    (meta:state.meta, items:state.items & collections.list(9), total:state.total + 1)

out: update((meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), total:2))
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_out = lowered.statements[1]
    out_t = info.expr_type(bind_out.value)
    assert isinstance(out_t, ast.TypeExpr)
    fields = dict(out_t.fields)
    assert isinstance(fields["meta"], ast.MapValueType)
    assert isinstance(fields["items"], ast.LinkedListValueType)
    assert len(fields["items"].elements) == 3
    assert isinstance(fields["total"], ast.PrimTypeRef)


def test_typed_ir_tracks_nested_dynamic_map_and_list_fields() -> None:
    mod = parse_module(
        """
make() -> (payload:map(meta:map(name:str, ok:bool), items:list(num, num), groups:list(map(name:str), map(name:str)))):
    (payload:collections.map(meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), groups:collections.list(collections.map(name:"a"), collections.map(name:"b"))))

out: make()
name: out.payload.meta.name
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_out = lowered.statements[1]
    bind_name = lowered.statements[2]
    out_t = info.expr_type(bind_out.value)
    name_t = info.expr_type(bind_name.value)
    assert isinstance(out_t, ast.TypeExpr)
    fields = dict(out_t.fields)
    assert isinstance(fields["payload"], ast.MapValueType)
    payload_fields = dict(fields["payload"].fields)
    assert isinstance(payload_fields["meta"], ast.MapValueType)
    assert isinstance(payload_fields["items"], ast.LinkedListValueType)
    assert isinstance(payload_fields["groups"], ast.LinkedListValueType)
    assert isinstance(name_t, ast.PrimTypeRef)
    assert name_t.name == "str"


def test_typed_ir_tracks_transform_for_direct_dynamic_map_payload() -> None:
    mod = parse_module(
        """
update(payload:map(meta:map(name:str, ok:bool), items:list(num, num), groups:list(map(name:str), map(name:str)))) -> map(meta:map(name:str, ok:bool), items:list(num, num, num), groups:list(map(name:str), map(name:str), map(name:str))):
    collections.map(meta:payload.meta, items:payload.items & collections.list(9), groups:payload.groups & collections.list(collections.map(name:"c")))

out: update(collections.map(meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), groups:collections.list(collections.map(name:"a"), collections.map(name:"b"))))
name: out.meta.name
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_out = lowered.statements[1]
    bind_name = lowered.statements[2]
    out_t = info.expr_type(bind_out.value)
    name_t = info.expr_type(bind_name.value)
    assert isinstance(out_t, ast.MapValueType)
    out_fields = dict(out_t.fields)
    assert isinstance(out_fields["meta"], ast.MapValueType)
    assert isinstance(out_fields["items"], ast.LinkedListValueType)
    assert len(out_fields["items"].elements) == 3
    assert isinstance(out_fields["groups"], ast.LinkedListValueType)
    assert len(out_fields["groups"].elements) == 3
    assert isinstance(name_t, ast.PrimTypeRef)
    assert name_t.name == "str"


def test_typed_ir_tracks_mixed_static_and_dynamic_collection_record() -> None:
    mod = parse_module(
        """
make() -> (pts:[num:2], payload:map(meta:map(name:str), items:list(num, num)), total:num):
    (pts:[1,2], payload:collections.map(meta:collections.map(name:"alice"), items:collections.list(:[3,4])), total:5)

out: make()
item_name: out.payload.meta.name
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_out = lowered.statements[1]
    bind_item_name = lowered.statements[2]
    out_t = info.expr_type(bind_out.value)
    item_name_t = info.expr_type(bind_item_name.value)
    assert isinstance(out_t, ast.TypeExpr)
    fields = dict(out_t.fields)
    assert isinstance(fields["pts"], ast.FixedVectorType)
    assert isinstance(fields["payload"], ast.MapValueType)
    assert isinstance(fields["total"], ast.PrimTypeRef)
    assert isinstance(item_name_t, ast.PrimTypeRef)
    assert item_name_t.name == "str"
