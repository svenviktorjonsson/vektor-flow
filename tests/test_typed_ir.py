from __future__ import annotations

from pathlib import Path

from vektorflow import ast
from vektorflow.ir import AttrExpr, BinaryExpr, CallExpr, IndexExpr, StoreName, lower_module
from vektorflow.parser import parse_module
from vektorflow.typed_ir import AxisTaggedType, ImportedFunctionType, StdlibFunctionType, annotate_module


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


def test_typed_ir_tracks_vector_power_expression_types() -> None:
    mod = parse_module(
        """
[num:2] a: [2,3]
[num:2] b: [4,5]
powed: a ^ b
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_powed = lowered.statements[2]
    assert isinstance(bind_powed, StoreName)
    assert isinstance(bind_powed.value, BinaryExpr)
    pow_t = info.expr_type(bind_powed.value)
    assert isinstance(pow_t, ast.FixedVectorType)
    assert isinstance(pow_t.size, ast.TypeSizeConst)
    assert pow_t.size.value == 2


def test_typed_ir_tracks_empty_list_as_zero_length_any_vector() -> None:
    mod = parse_module(
        """
empty: []
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_empty = lowered.statements[0]
    empty_t = info.expr_type(bind_empty.value)
    assert isinstance(empty_t, ast.FixedVectorType)
    assert isinstance(empty_t.element_type, ast.PrimTypeRef)
    assert empty_t.element_type.name == "any"
    assert isinstance(empty_t.size, ast.TypeSizeConst)
    assert empty_t.size.value == 0


def test_typed_ir_tracks_empty_multiset_as_any_element_type() -> None:
    mod = parse_module(
        """
empty: {}
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_empty = lowered.statements[0]
    empty_t = info.expr_type(bind_empty.value)
    assert isinstance(empty_t, ast.MultisetType)
    assert isinstance(empty_t.element_type, ast.PrimTypeRef)
    assert empty_t.element_type.name == "any"


def test_typed_ir_tracks_heterogeneous_struct_list_as_any_element_type() -> None:
    mod = parse_module(
        """
mixed: [1, [2]]
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_mixed = lowered.statements[0]
    mixed_t = info.expr_type(bind_mixed.value)
    assert isinstance(mixed_t, ast.FixedVectorType)
    assert isinstance(mixed_t.element_type, ast.PrimTypeRef)
    assert mixed_t.element_type.name == "any"
    assert isinstance(mixed_t.size, ast.TypeSizeConst)
    assert mixed_t.size.value == 2


def test_typed_ir_tracks_axis_aligned_fixed_vector_type() -> None:
    mod = parse_module(
        """
u: [-1, 0, 1] -> u
axis_name: "v"
v: [-1, 0, 1] -> (axis_name)
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_u = lowered.statements[0]
    bind_v = lowered.statements[2]
    u_t = info.expr_type(bind_u.value)
    v_t = info.expr_type(bind_v.value)
    assert isinstance(u_t, AxisTaggedType)
    assert u_t.axis_key == "u"
    assert isinstance(u_t.value_type, ast.FixedVectorType)
    assert isinstance(v_t, AxisTaggedType)
    assert v_t.axis_key is None
    assert isinstance(v_t.value_type, ast.FixedVectorType)


def test_typed_ir_tracks_disjoint_axis_outer_product_type() -> None:
    mod = parse_module(
        """
u: [-1, 0, 1] -> u
v: [-1, 0, 1] -> v
z: u * v
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_z = lowered.statements[2]
    z_t = info.expr_type(bind_z.value)
    assert isinstance(z_t, AxisTaggedType)
    assert z_t.axis_key == "uv"
    assert isinstance(z_t.value_type, ast.FixedVectorType)
    assert isinstance(z_t.value_type.size, ast.TypeSizeConst)
    assert z_t.value_type.size.value == 3
    assert isinstance(z_t.value_type.element_type, ast.FixedVectorType)
    assert isinstance(z_t.value_type.element_type.size, ast.TypeSizeConst)
    assert z_t.value_type.element_type.size.value == 3


def test_typed_ir_tracks_same_axis_power_type() -> None:
    mod = parse_module(
        """
u: [2, 3, 4] -> u
v: [5, 6, 7] -> u
z: u ^ v
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_z = lowered.statements[2]
    z_t = info.expr_type(bind_z.value)
    assert isinstance(z_t, AxisTaggedType)
    assert z_t.axis_key == "u"
    assert isinstance(z_t.value_type, ast.FixedVectorType)
    assert isinstance(z_t.value_type.size, ast.TypeSizeConst)
    assert z_t.value_type.size.value == 3


def test_typed_ir_tracks_disjoint_axis_power_type() -> None:
    mod = parse_module(
        """
u: [2, 3] -> u
v: [4, 5, 6] -> v
z: u ^ v
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_z = lowered.statements[2]
    z_t = info.expr_type(bind_z.value)
    assert isinstance(z_t, AxisTaggedType)
    assert z_t.axis_key == "uv"
    assert isinstance(z_t.value_type, ast.FixedVectorType)
    assert isinstance(z_t.value_type.size, ast.TypeSizeConst)
    assert z_t.value_type.size.value == 2
    assert isinstance(z_t.value_type.element_type, ast.FixedVectorType)
    assert isinstance(z_t.value_type.element_type.size, ast.TypeSizeConst)
    assert z_t.value_type.element_type.size.value == 3


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
        """math: .math
stat: .stat

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


def test_typed_ir_tracks_axis_tagged_math_intrinsics() -> None:
    mod = parse_module(
        """math: .math

theta: [0, 1, 2] -> u
wave: math.sin(theta)
arc: math.cos(theta)
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    wave_t = info.expr_type(lowered.statements[1].value)
    arc_t = info.expr_type(lowered.statements[2].value)
    assert isinstance(wave_t, AxisTaggedType)
    assert wave_t.axis_key == "u"
    assert isinstance(wave_t.value_type, ast.FixedVectorType)
    assert isinstance(wave_t.value_type.element_type, ast.PrimTypeRef)
    assert wave_t.value_type.element_type.name == "num"
    assert isinstance(arc_t, AxisTaggedType)
    assert arc_t.axis_key == "u"
    assert isinstance(arc_t.value_type, ast.FixedVectorType)
    assert isinstance(arc_t.value_type.element_type, ast.PrimTypeRef)
    assert arc_t.value_type.element_type.name == "num"


def test_typed_ir_tracks_math_constants_and_vector_stats() -> None:
    mod = parse_module(
        """math: .math
stat: .stat

pi_v: math.pi
tau_v: math.tau
mid: stat.median([1,2,3,4])
p75: stat.percentile([1,2,3,4,5], 75)
spread: stat.iqr([1,2,3,4,5])
zs: stat.zscore([1,2,3])
norm: stat.normalize([2,4,6])
cov: stat.covariance([1,2,3], [2,4,6])
corr: stat.correlation([1,2,3], [2,4,6])
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    assert info.expr_type(lowered.statements[0].value).name == "num"
    assert info.expr_type(lowered.statements[1].value).name == "num"
    assert info.expr_type(lowered.statements[2].value).name == "num"
    assert info.expr_type(lowered.statements[3].value).name == "num"
    assert info.expr_type(lowered.statements[4].value).name == "num"
    zs_t = info.expr_type(lowered.statements[5].value)
    norm_t = info.expr_type(lowered.statements[6].value)
    assert isinstance(zs_t, ast.FixedVectorType)
    assert isinstance(norm_t, ast.FixedVectorType)
    assert isinstance(zs_t.size, ast.TypeSizeConst) and zs_t.size.value == 3
    assert isinstance(norm_t.size, ast.TypeSizeConst) and norm_t.size.value == 3
    assert info.expr_type(lowered.statements[7].value).name == "num"
    assert info.expr_type(lowered.statements[8].value).name == "num"


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
        """collections: .collections

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


def test_typed_ir_tracks_vector_literal_spread_shape() -> None:
    mod = parse_module(
        """values: [: [1,2,3]]
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_values = lowered.statements[0]
    values_t = info.expr_type(bind_values.value)
    assert isinstance(values_t, ast.FixedVectorType)
    assert isinstance(values_t.size, ast.TypeSizeConst)
    assert values_t.size.value == 3
    assert isinstance(values_t.element_type, ast.PrimTypeRef)
    assert values_t.element_type.name == "num"


def test_typed_ir_tracks_tuple_literal_and_spread_shape() -> None:
    mod = parse_module(
        """coords: (1, :[2,3], 4)
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_coords = lowered.statements[0]
    coords_t = info.expr_type(bind_coords.value)
    assert isinstance(coords_t, ast.TupleTypeExpr)
    assert len(coords_t.elements) == 4
    assert all(isinstance(elem, ast.PrimTypeRef) and elem.name == "num" for elem in coords_t.elements)


def test_typed_ir_tracks_tuple_numeric_index_type() -> None:
    mod = parse_module(
        """point: (3, 4)
first: point.0
second: point.1
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_first = lowered.statements[1]
    bind_second = lowered.statements[2]
    assert isinstance(bind_first.value, IndexExpr)
    assert isinstance(bind_second.value, IndexExpr)
    first_t = info.expr_type(bind_first.value)
    second_t = info.expr_type(bind_second.value)
    assert isinstance(first_t, ast.PrimTypeRef)
    assert isinstance(second_t, ast.PrimTypeRef)
    assert first_t.name == "num"
    assert second_t.name == "num"


def test_typed_ir_tracks_finite_range_vector_shape() -> None:
    mod = parse_module(
        """values: [1..5]
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    values_t = info.expr_type(lowered.statements[0].value)
    assert isinstance(values_t, ast.FixedVectorType)
    assert isinstance(values_t.size, ast.TypeSizeConst)
    assert values_t.size.value == 5


def test_typed_ir_tracks_lazy_range_list_shape() -> None:
    mod = parse_module(
        """values: [1..]
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    values_t = info.expr_type(lowered.statements[0].value)
    assert isinstance(values_t, ast.LinkedListValueType)
    assert len(values_t.elements) == 1
    assert isinstance(values_t.elements[0], ast.PrimTypeRef)
    assert values_t.elements[0].name == "num"


def test_typed_ir_tracks_struct_field_rebind_shape() -> None:
    mod = parse_module(
        """point: (x: 3, y: 4)
point.z: 5
out: point
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    out_t = info.expr_type(lowered.statements[2].value)
    assert isinstance(out_t, ast.TypeExpr)
    assert [name for name, _ in out_t.fields] == ["x", "y", "z"]


def test_ir_lowering_can_reach_axis_panel_example_past_tuple_literals() -> None:
    src = Path("examples/100_axis_4_panel.vkf").read_text(encoding="utf-8")
    mod = parse_module(src, filename="examples/100_axis_4_panel.vkf")
    lowered = lower_module(mod)
    assert lowered.statements


def test_ir_lowering_can_reach_resource_rebind_examples() -> None:
    for name in [
        "examples/20_struct_field_rebind.vkf",
        "examples/21_vector_index_rebind.vkf",
        "examples/24_immutable_values_mutable_resources.vkf",
        "examples/91_shared_buffer_pattern.vkf",
    ]:
        src = Path(name).read_text(encoding="utf-8")
        mod = parse_module(src, filename=name)
        lowered = lower_module(mod)
        assert lowered.statements


def test_ir_lowering_can_reach_ranges_example() -> None:
    src = Path("examples/15_ranges.vkf").read_text(encoding="utf-8")
    mod = parse_module(src, filename="examples/15_ranges.vkf")
    lowered = lower_module(mod)
    assert lowered.statements


def test_typed_ir_tracks_scope_expr_result_and_scope_identity_shape() -> None:
    mod = parse_module(
        """
outer: 3
message:
    name: "Ada"
    "hello $name"

snapshot:
    inner: 7
    :
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    message_t = info.expr_type(lowered.statements[1].value)
    snapshot_t = info.expr_type(lowered.statements[2].value)
    assert isinstance(message_t, ast.PrimTypeRef)
    assert message_t.name == "str"
    assert isinstance(snapshot_t, ast.TypeExpr)
    assert [name for name, _ in snapshot_t.fields] == ["outer", "message", "inner"]


def test_ir_lowering_can_reach_scope_and_spill_examples() -> None:
    for name in [
        "examples/03_blocks_return_last.vkf",
        "examples/23_spill_and_override.vkf",
    ]:
        src = Path(name).read_text(encoding="utf-8")
        mod = parse_module(src, filename=name)
        lowered = lower_module(mod)
        assert lowered.statements


def test_typed_ir_tracks_pipe_chain_result_shape() -> None:
    mod = parse_module(
        """
square(x:num) -> num: x * x
out: [1..5] >> square($)
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    out_t = info.expr_type(lowered.statements[1].value)
    assert isinstance(out_t, ast.FixedVectorType)
    assert isinstance(out_t.element_type, ast.PrimTypeRef)
    assert out_t.element_type.name == "num"
    assert isinstance(out_t.size, ast.TypeSizeConst)
    assert out_t.size.value == 5


def test_ir_lowering_can_reach_pipe_examples() -> None:
    for name in [
        "examples/62_pipes.vkf",
        "examples/63_pipe_with_functions.vkf",
    ]:
        src = Path(name).read_text(encoding="utf-8")
        mod = parse_module(src, filename=name)
        lowered = lower_module(mod)
        assert lowered.statements


def test_ir_lowering_can_reach_typeof_and_abs_examples() -> None:
    for name in [
        "examples/53_type_reflection.vkf",
        "examples/73_norm_and_abs.vkf",
    ]:
        src = Path(name).read_text(encoding="utf-8")
        mod = parse_module(src, filename=name)
        lowered = lower_module(mod)
        assert lowered.statements


def test_ir_lowering_can_reach_file_module_import_example() -> None:
    name = "examples/83_file_module.vkf"
    src = Path(name).read_text(encoding="utf-8")
    mod = parse_module(src, filename=name)
    lowered = lower_module(mod)
    assert lowered.statements


def test_typed_ir_tracks_imported_module_function_calls_as_any() -> None:
    mod = parse_module(
        """helpers: ."modules/83_file_module_helpers.vkf"

out: helpers.scale(2, 10)
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_out = lowered.statements[1]
    assert isinstance(bind_out, StoreName)
    assert isinstance(bind_out.value, CallExpr)
    assert isinstance(bind_out.value.func, AttrExpr)
    func_t = info.expr_type(bind_out.value.func)
    out_t = info.expr_type(bind_out.value)
    assert isinstance(func_t, ImportedFunctionType)
    assert func_t.name == "scale"
    assert isinstance(out_t, ast.PrimTypeRef)
    assert out_t.name == "any"


def test_typed_ir_can_annotate_file_module_import_example() -> None:
    name = "examples/83_file_module.vkf"
    src = Path(name).read_text(encoding="utf-8")
    mod = parse_module(src, filename=name)
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    import_stmt = lowered.statements[0]
    print_stmt = lowered.statements[1]
    assert import_stmt.alias == "helpers"
    assert isinstance(print_stmt.value, CallExpr)
    assert isinstance(print_stmt.value.func, AttrExpr)
    assert isinstance(info.expr_type(print_stmt.value.func), ImportedFunctionType)
    assert isinstance(info.expr_type(print_stmt.value), ast.PrimTypeRef)
    assert info.expr_type(print_stmt.value).name == "any"


def test_typed_ir_tracks_record_with_map_and_list_fields() -> None:
    mod = parse_module(
        """collections: .collections

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
        """collections: .collections

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
        """collections: .collections

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
        """collections: .collections

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
        """collections: .collections

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


def test_typed_ir_can_analyze_empty_scene_lists_in_real_example() -> None:
    src = Path("examples/111_mirror_smoke.vkf").read_text(encoding="utf-8")
    mod = parse_module(src, filename="examples/111_mirror_smoke.vkf")
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_scene = lowered.statements[1]
    scene_t = info.expr_type(bind_scene.value)
    assert isinstance(scene_t, ast.TypeExpr)
    fields = dict(scene_t.fields)
    assert isinstance(fields["cubes"], ast.FixedVectorType)
    assert isinstance(fields["cubes"].element_type, ast.PrimTypeRef)
    assert fields["cubes"].element_type.name == "any"
    assert isinstance(fields["cubes"].size, ast.TypeSizeConst)
    assert fields["cubes"].size.value == 0


def test_typed_ir_can_analyze_axis_math_in_real_example() -> None:
    src = Path("examples/110_mirror_showcase.vkf").read_text(encoding="utf-8")
    mod = parse_module(src, filename="examples/110_mirror_showcase.vkf")
    lowered = lower_module(mod)
    info = annotate_module(lowered)

    bind_ell_x = lowered.statements[5]
    ell_x_t = info.expr_type(bind_ell_x.value)
    assert isinstance(ell_x_t, AxisTaggedType)
    assert ell_x_t.axis_key == "uv"
    assert isinstance(ell_x_t.value_type, ast.FixedVectorType)


def test_typed_ir_tracks_stdlib_namespace_alias_bound_collection_constructors() -> None:
    mod = parse_module(
        """collections: .collections

mkmap: collections.map
mklist: collections.list
m: mkmap(a:1, b:true)
L: mklist(:[1,2,3])
out: m.a
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_mkmap = lowered.statements[0]
    bind_mklist = lowered.statements[1]
    bind_m = lowered.statements[2]
    bind_l = lowered.statements[3]
    bind_out = lowered.statements[4]
    assert isinstance(bind_mkmap, StoreName)
    assert isinstance(bind_mklist, StoreName)
    assert isinstance(bind_m, StoreName)
    assert isinstance(bind_l, StoreName)
    assert isinstance(bind_out, StoreName)
    assert info.expr_type(bind_mkmap.value) == StdlibFunctionType("collections", "map")
    assert info.expr_type(bind_mklist.value) == StdlibFunctionType("collections", "list")
    m_t = info.expr_type(bind_m.value)
    l_t = info.expr_type(bind_l.value)
    out_t = info.expr_type(bind_out.value)
    assert isinstance(m_t, ast.MapValueType)
    assert [name for name, _ in m_t.fields] == ["a", "b"]
    assert isinstance(l_t, ast.LinkedListValueType)
    assert len(l_t.elements) == 3
    assert isinstance(out_t, ast.PrimTypeRef)
    assert out_t.name == "num"


def test_typed_ir_tracks_stdlib_namespace_alias_bound_math_and_stat_calls() -> None:
    mod = parse_module(
        """math: .math
stat: .stat

mysin: math.sin
mymean: stat.mean
a: mysin(0)
b: mymean([1,2,3])
""",
        filename="<typed-ir>",
    )
    lowered = lower_module(mod)
    info = annotate_module(lowered)
    bind_mysin = lowered.statements[0]
    bind_mymean = lowered.statements[1]
    bind_a = lowered.statements[2]
    bind_b = lowered.statements[3]
    assert isinstance(bind_mysin, StoreName)
    assert isinstance(bind_mymean, StoreName)
    assert isinstance(bind_a, StoreName)
    assert isinstance(bind_b, StoreName)
    assert info.expr_type(bind_mysin.value) == StdlibFunctionType("math", "sin")
    assert info.expr_type(bind_mymean.value) == StdlibFunctionType("stat", "mean")
    assert info.expr_type(bind_a.value).name == "num"
    assert info.expr_type(bind_b.value).name == "num"
