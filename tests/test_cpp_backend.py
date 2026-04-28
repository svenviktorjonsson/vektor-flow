from __future__ import annotations

from pathlib import Path
import subprocess

import pytest

from vektorflow.cpp_backend import (
    CppEmitError,
    compile_and_run_module,
    compile_cpp_source,
    discover_cpp_compiler,
    emit_cpp_module,
    emit_cpp_from_source_file,
)
from vektorflow.ir import IndexExpr, PrintStmt, TypeDef, lower_module
from vektorflow.parser import parse_module
from vektorflow.stdlib.events import encode_event_code, encode_frame_pattern, encode_ui_pattern, encode_widget_pattern


NATIVE_CORE = Path(__file__).resolve().parent.parent / "examples" / "native_core"


def _compile_native_core_example(tmp_path: Path, filename: str) -> subprocess.CompletedProcess[str]:
    path = NATIVE_CORE / filename
    cpp = emit_cpp_from_source_file(path)
    exe = compile_cpp_source(cpp, tmp_path, exe_name=path.stem)
    proc = subprocess.run([str(exe)], capture_output=True, text=True)
    assert exe.exists()
    return proc


def test_cpp_lowering_includes_print_stmt() -> None:
    mod = parse_module(":: 3", filename="<cpp-test>")
    lowered = lower_module(mod)
    assert isinstance(lowered.statements[0], PrintStmt)


def test_cpp_emits_simple_typed_program() -> None:
    src = """
twice(x:num) -> num:
    x * 2

num a: 3
:: twice(a)
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "double twice(double x)" in cpp
    assert "double a = 3.0;" in cpp
    assert 'std::cout << vf_format_num(twice(a)) << "\\n";' in cpp
    assert "#include <any>" not in cpp
    assert "#include <list>" not in cpp
    assert "#include <map>" not in cpp
    assert "vf_map_make" not in cpp
    assert "vf_list_make" not in cpp
    assert "vf_mset_make" not in cpp


def test_cpp_emits_slot_named_function_locals() -> None:
    src = """
f(x:num) -> num:
    num a: 1
    num b: x + a
    b
    """
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "double vf_s1_a = 1.0;" in cpp
    assert "double vf_s2_b = vf_to_num((x + vf_s1_a));" not in cpp
    assert "return (x + vf_s1_a);" in cpp


def test_cpp_elides_noop_coercion_after_slot_lowering() -> None:
    src = """
id(x:num) -> num:
    num a: x
    a
    """
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "vf_to_num(x)" not in cpp
    assert "double vf_s1_a = x;" not in cpp
    assert "return x;" in cpp


def test_cpp_emits_math_and_stat_intrinsics() -> None:
    src = """
:: math.sin(0)
:: stat.mean([1,2,3,4])
:: stat.std([2,4,4,4,5,5,7,9])
:: stat.count([1,2,3])
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "std::sin(0.0)" in cpp
    assert "vf_array_sum(" in cpp
    assert "vf_array_std(" in cpp
    assert "static_cast<long long>(3)" in cpp


def test_cpp_emits_math_constants_and_extended_stat_intrinsics() -> None:
    src = """
:: math.pi
:: math.e
:: stat.median([1,2,3,4])
:: stat.percentile([1,2,3,4,5], 75)
:: stat.iqr([1,2,3,4,5])
:: stat.zscore([1,2,3])
:: stat.normalize([2,4,6])
:: stat.covariance([1,2,3], [2,4,6])
:: stat.correlation([1,2,3], [2,4,6])
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "3.14159265358979323846" in cpp
    assert "2.71828182845904523536" in cpp
    assert "vf_array_median(" in cpp
    assert "vf_array_percentile(" in cpp
    assert "vf_array_iqr(" in cpp
    assert "vf_array_zscore(" in cpp
    assert "vf_array_normalize(" in cpp
    assert "vf_array_covariance(" in cpp
    assert "vf_array_correlation(" in cpp


def test_cpp_rejects_unsupported_fixed_vector_native_subset() -> None:
    src = """
box(x:(left:num)):
    x
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    with pytest.raises(CppEmitError):
        emit_cpp_module(lowered)


def test_cpp_emits_fixed_vector_program() -> None:
    src = """
[num:2] a: [1,2]
[num:2] b: [3,4]
:: a + b
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "#include <array>" in cpp
    assert "#include <any>" not in cpp
    assert "#include <list>" not in cpp
    assert "std::array<double, 2> a = std::array<double, 2>{vf_to_num(1.0), vf_to_num(2.0)};" in cpp
    assert "std::array<double, 2> b = std::array<double, 2>{vf_to_num(3.0), vf_to_num(4.0)};" in cpp
    assert "for (std::size_t vf_i = 0; vf_i < 2; ++vf_i)" in cpp
    assert 'std::cout << vf_format_value(([' in cpp


def test_cpp_emits_iota_for_large_numeric_progression_vector() -> None:
    src = """
[num:16] xs: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]
:: xs
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "vf_array_iota<double, 16>(0.0, 1.0)" in cpp
    assert "std::array<double, 16>{vf_to_num(0.0)" not in cpp


def test_cpp_fuses_elementwise_vector_chain() -> None:
    src = """
[num:2] a: [1,2]
[num:2] b: [3,4]
:: (a + b) * 0.5
    """
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "vf_array_add(a, b)" not in cpp
    assert "for (std::size_t vf_i = 0; vf_i < 2; ++vf_i)" in cpp
    assert "vf_out[vf_i] = static_cast<double>(((a[vf_i] + b[vf_i]) * 0.5));" in cpp


def test_cpp_updates_existing_vector_in_place_for_fused_chain() -> None:
    src = """
step(v:[num:2], b:[num:2], reps:num) -> [num:2]:
    i: 0
    out: v
    i < reps?>
        out: (out + b) * 0.5
        i: i + 1
    out
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "vf_s4_out = ([&]()" not in cpp
    assert "for (std::size_t vf_i = 0; vf_i < 2; ++vf_i)" in cpp
    assert "vf_s4_out[vf_i] = static_cast<double>(((vf_s4_out[vf_i] + b[vf_i]) * 0.5));" in cpp


def test_cpp_emits_fixed_vector_index_program() -> None:
    src = """
[num:3] xs: [1,2,3]
:: xs.1
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    assert isinstance(lowered.statements[1].value, IndexExpr)
    cpp = emit_cpp_module(lowered)
    assert "xs[static_cast<std::size_t>(1.0)]" in cpp or "xs[static_cast<std::size_t>(1)]" in cpp
    assert 'std::cout << vf_format_num(xs[static_cast<std::size_t>(' in cpp


def test_cpp_emits_symbolic_vector_template_function() -> None:
    src = """
join(x:[num:n], y:[num:m]) -> [num:n+m]:
    x & y

[num:2] a: [1,2]
[num:3] b: [3,4,5]
:: join(a, b)
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "template <std::size_t m, std::size_t n>" in cpp
    assert "std::array<double, (n + m)> join(const std::array<double, n>& x, const std::array<double, m>& y)" in cpp
    assert 'std::cout << vf_format_value(join(a, b)) << "\\n";' in cpp


def test_cpp_emits_struct_program() -> None:
    src = """
(x:num, y:num) p: (x:1, y:2)
:: p.x
:: p
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "struct VfRecord_" in cpp
    assert "double x;" in cpp
    assert "double y;" in cpp
    assert 'std::cout << vf_format_num(p.x) << "\\n";' in cpp
    assert 'std::cout << vf_format_value(p) << "\\n";' in cpp


def test_cpp_lowers_named_record_type_definition_program() -> None:
    src = """
Point : (x:num, y:num)
Point p: (x:1, y:2)
:: p.x
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    assert isinstance(lowered.statements[0], TypeDef)
    cpp = emit_cpp_module(lowered)
    assert "struct VfRecord_" in cpp
    assert "double p = " not in cpp
    assert 'std::cout << vf_format_num(p.x) << "\\n";' in cpp


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_builds_named_record_type_example(tmp_path: Path) -> None:
    proc = _compile_native_core_example(tmp_path, "named_record_native.vkf")
    assert proc.returncode == 0
    assert proc.stdout.strip() == "4\n(x:4, y:6)"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_builds_nested_named_record_type_example(tmp_path: Path) -> None:
    proc = _compile_native_core_example(tmp_path, "named_record_nested_native.vkf")
    assert proc.returncode == 0
    assert proc.stdout.strip() == "4\n(origin:(x:4, y:6), size:(x:10, y:20))"



@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_builds_named_record_collections_type_example(tmp_path: Path) -> None:
    proc = _compile_native_core_example(tmp_path, "named_record_collections_native.vkf")
    assert proc.returncode == 0
    assert proc.stdout.strip() == "[5, 7]\n{3:1, 6:2}\n(pts:[5, 7], bag:{3:1, 6:2}, total:2)"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_builds_named_record_scene_type_example(tmp_path: Path) -> None:
    proc = _compile_native_core_example(tmp_path, "named_record_scene_native.vkf")
    assert proc.returncode == 0
    assert proc.stdout.strip() == "4\n[5, 7]\n{3:1, 6:2}\n(anchor:(x:4, y:6), state:(pts:[5, 7], bag:{3:1, 6:2}, total:2))"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_builds_named_record_scene_chain_type_example(tmp_path: Path) -> None:
    proc = _compile_native_core_example(tmp_path, "named_record_scene_chain_native.vkf")
    assert proc.returncode == 0
    assert proc.stdout.strip() == "7\n3\n(anchor:(x:7, y:10), state:(pts:[6, 8], bag:{3:2, 6:2}, total:3))"

def test_cpp_emits_dynamic_map_and_list_program() -> None:
    src = """
m: collections.map(a:1, b:"hi", c:true)
L: collections.list(:[1,2,3])
:: m
:: m.b
:: L
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "#include <any>" in cpp
    assert "#include <list>" in cpp
    assert "vf_map_make" in cpp
    assert "vf_list_from_array" in cpp
    assert "std::any_cast<std::string>(m.at(\"b\"))" in cpp
    assert 'std::cout << vf_format_value(m) << "\\n";' in cpp
    assert 'std::cout << m.at("b")' not in cpp
    assert 'std::cout << vf_format_value(L) << "\\n";' in cpp


def test_cpp_rejects_dynamic_list_with_unsupported_nested_vector_cell() -> None:
    src = """
v: [1,2,3]
L: collections.list(v)
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    with pytest.raises(CppEmitError):
        emit_cpp_module(lowered)


def test_cpp_emits_record_with_map_and_list_fields() -> None:
    src = """
make() -> (meta:map(name:str, ok:bool), items:list(num, num, num), total:num):
    (meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2,3]), total:3)

:: make()
:: make().meta
:: make().items
:: make().meta.name
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "std::map<std::string, std::any>" in cpp
    assert "std::list<std::any>" in cpp
    assert "vf_map_make" in cpp
    assert "vf_list_from_array" in cpp
    assert 'std::cout << vf_format_value(make()) << "\\n";' in cpp
    assert 'std::cout << vf_format_value(make().meta) << "\\n";' in cpp
    assert 'std::cout << vf_format_value(make().items) << "\\n";' in cpp
    assert 'std::any_cast<std::string>(make().meta.at("name"))' in cpp


def test_cpp_emits_transform_for_record_with_map_and_list_fields() -> None:
    src = """
update(state:(meta:map(name:str, ok:bool), items:list(num, num), total:num)) -> (meta:map(name:str, ok:bool), items:list(num, num, num), total:num):
    (meta:state.meta, items:state.items & collections.list(9), total:state.total + 1)

:: update((meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), total:2))
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "vf_list_cat" in cpp
    assert "vf_map_make" in cpp
    assert 'std::cout << vf_format_value(update(' in cpp


def test_cpp_emits_nested_dynamic_map_and_list_program() -> None:
    src = """
make() -> (payload:map(meta:map(name:str, ok:bool), items:list(num, num), groups:list(map(name:str), map(name:str)))):
    (payload:collections.map(meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), groups:collections.list(collections.map(name:"a"), collections.map(name:"b"))))

:: make()
:: make().payload
:: make().payload.meta
:: make().payload.meta.name
:: make().payload.groups
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "std::map<std::string, std::any>" in cpp
    assert "std::list<std::any>" in cpp
    assert "vf_map_make" in cpp
    assert "vf_list_make" in cpp
    assert 'std::any_cast<std::map<std::string, std::any>>(make().payload.at("meta"))' in cpp
    assert 'std::any_cast<std::string>(std::any_cast<std::map<std::string, std::any>>(make().payload.at("meta")).at("name"))' in cpp


def test_cpp_emits_transform_for_nested_dynamic_map_and_list_record() -> None:
    src = """
update(state:(payload:map(meta:map(name:str, ok:bool), items:list(num, num), groups:list(map(name:str), map(name:str))))) -> (payload:map(meta:map(name:str, ok:bool), items:list(num, num, num), groups:list(map(name:str), map(name:str), map(name:str)))):
    (payload:collections.map(meta:state.payload.meta, items:state.payload.items & collections.list(9), groups:state.payload.groups & collections.list(collections.map(name:"c"))))

:: update((payload:collections.map(meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), groups:collections.list(collections.map(name:"a"), collections.map(name:"b")))))
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "vf_list_cat" in cpp
    assert "vf_map_make" in cpp
    assert 'state.payload.at("items")' in cpp
    assert 'state.payload.at("groups")' in cpp


def test_cpp_emits_transform_for_direct_dynamic_map_payload() -> None:
    src = """
update(payload:map(meta:map(name:str, ok:bool), items:list(num, num), groups:list(map(name:str), map(name:str)))) -> map(meta:map(name:str, ok:bool), items:list(num, num, num), groups:list(map(name:str), map(name:str), map(name:str))):
    collections.map(meta:payload.meta, items:payload.items & collections.list(9), groups:payload.groups & collections.list(collections.map(name:"c")))

:: update(collections.map(meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), groups:collections.list(collections.map(name:"a"), collections.map(name:"b"))))
:: update(collections.map(meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), groups:collections.list(collections.map(name:"a"), collections.map(name:"b")))).meta.name
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "vf_map_make" in cpp
    assert "vf_list_cat" in cpp
    assert 'payload.at("meta")' in cpp
    assert 'payload.at("items")' in cpp
    assert 'payload.at("groups")' in cpp


def test_cpp_emits_mixed_static_and_dynamic_collection_record() -> None:
    src = """
make() -> (pts:[num:2], payload:map(meta:map(name:str), items:list(num, num)), total:num):
    (pts:[1,2], payload:collections.map(meta:collections.map(name:"alice"), items:collections.list(:[3,4])), total:5)

:: make()
:: make().pts
:: make().payload
:: make().payload.meta.name
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "std::array<double, 2>" in cpp
    assert "std::map<std::string, std::any>" in cpp
    assert "std::list<std::any>" in cpp
    assert "vf_map_make" in cpp
    assert "vf_list_from_array" in cpp
    assert 'std::any_cast<std::string>(std::any_cast<std::map<std::string, std::any>>(make().payload.at("meta")).at("name"))' in cpp


def test_cpp_emits_typed_multiset_program() -> None:
    src = """
{num} a: {1:2, 3:1}
{num} b: {3:2}
:: a + b
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "#include <map>" in cpp
    assert "vf_mset_make<double>" in cpp
    assert "vf_mset_union(a, b)" in cpp
    assert 'std::cout << vf_format_value(vf_mset_union(a, b)) << "\\n";' in cpp


def test_cpp_emits_nested_record_with_multiset_field() -> None:
    src = """
make() -> (bag:{num}, total:num):
    (bag:{1:2, 3:1}, total:3)

:: make()
:: make().bag
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "struct VfRecord_" in cpp
    assert "std::map<double, long long>" in cpp
    assert "vf_mset_make<double>" in cpp
    assert 'std::cout << vf_format_value(make()) << "\\n";' in cpp
    assert 'std::cout << vf_format_value(make().bag) << "\\n";' in cpp


def test_cpp_emits_record_with_vector_and_multiset_fields() -> None:
    src = """
make() -> (pts:[num:2], bag:{num}, total:num):
    (pts:[1,2], bag:{3:1, 4:2}, total:3)

:: make()
:: make().pts
:: make().bag
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "struct VfRecord_" in cpp
    assert "std::array<double, 2>" in cpp
    assert "std::map<double, long long>" in cpp
    assert "vf_mset_make<double>" in cpp
    assert 'std::cout << vf_format_value(make()) << "\\n";' in cpp
    assert 'std::cout << vf_format_value(make().pts) << "\\n";' in cpp
    assert 'std::cout << vf_format_value(make().bag) << "\\n";' in cpp


def test_cpp_emits_transform_for_record_with_vector_and_multiset_fields() -> None:
    src = """
update(state:(pts:[num:2], bag:{num}, total:num), extra:[num:2], delta:{num}) -> (pts:[num:2], bag:{num}, total:num):
    (pts:state.pts + extra, bag:state.bag + delta, total:state.total + 2)

:: update((pts:[1,2], bag:{3:1}, total:1), [4,5], {6:2})
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "vf_array_add" in cpp
    assert "vf_mset_union" in cpp
    assert 'std::cout << vf_format_value(update(' in cpp


def test_cpp_fuses_vector_chain_inside_function() -> None:
    src = """
blend(a:[num:4], b:[num:4]) -> [num:4]:
    (a + b) * 0.5

:: blend([1,2,3,4], [5,6,7,8])
    """
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "vf_array_add(a, b)" not in cpp
    assert "for (std::size_t vf_i = 0; vf_i < 4; ++vf_i)" in cpp


def test_cpp_specializes_array_sum_loop_function() -> None:
    src = """
sum_vec(x:[num:4]) -> num:
    i: 0
    acc: 0
    i < 4?>
        acc: acc + x.(i)
        i: i + 1
    acc

:: sum_vec([1,2,3,4])
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "double sum_vec(const std::array<double, 4>& x)" in cpp
    assert "for (std::size_t vf_s1_i = 0; vf_s1_i < static_cast<std::size_t>(4.0); ++vf_s1_i)" in cpp
    assert "vf_s2_acc += x[vf_s1_i];" in cpp


def test_cpp_emits_struct_function_program() -> None:
    src = """
sum(p:(x:num, y:num)) -> num:
    p.x + p.y

(x:num, y:num) p: (x:3, y:4)
:: sum(p)
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "double sum(" in cpp
    assert ".x + " in cpp or ".x +" in cpp
    assert ".y" in cpp


def test_cpp_rejects_multiset_with_non_primitive_orderless_keys() -> None:
    src = """
{(x:num)} bag: {(x:1):1}
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    with pytest.raises(CppEmitError):
        emit_cpp_module(lowered)


def test_cpp_emits_conditional_and_loop_program() -> None:
    src = """
k: 0
k < 3?>
    k: k + 1
    @>
:: k
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "while ((k < 3.0))" in cpp or "while ((k < 3))" in cpp
    assert "continue;" in cpp
    assert 'std::cout << vf_format_num(k) << "\\n";' in cpp


def test_cpp_emits_match_loop_program() -> None:
    src = """
k: 0
k??>
  0 =>
    k: k + 1
    @>
  1 => @|
:: k
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "while (true)" in cpp
    assert "else if" in cpp or "if (" in cpp
    assert "break;" in cpp
    assert "continue;" in cpp


def test_cpp_emits_return_channel_inside_control_flow() -> None:
    src = """
f(x:num) -> num:
    x > 0? @: x + 1
    x??>
        -1 => @: 99
        0 => @|
    num k: 0
    k < 5?>
        k: k + 1
        k = 3? @: k * 10
        @>
    0

:: f(4)
:: f(0)
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "if ((x > 0.0)) {" in cpp or "if ((x > 0)) {" in cpp
    assert "return (x + 1.0);" in cpp or "return (x + 1);" in cpp
    assert "while (true)" in cpp
    assert "return 99.0;" in cpp or "return 99;" in cpp
    assert "while ((vf_s1_k < 5.0))" in cpp or "while ((vf_s1_k < 5))" in cpp
    assert "return (vf_s1_k * 10.0);" in cpp or "return (vf_s1_k * 10);" in cpp


def test_cpp_emits_bitmask_match_specificity() -> None:
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
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "vf_match_specificity" in cpp
    assert "vf_spec" in cpp
    assert "vf_match_" in cpp
    assert "if (vf_spec >" in cpp


def test_cpp_emits_bitmask_match_loop_specificity() -> None:
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
    int({exact}) => out: 3
:: out
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "while (true)" in cpp
    assert "vf_match_specificity" in cpp
    assert "break;" in cpp


def test_cpp_emits_nested_record_vector_program() -> None:
    src = """
make() -> (pts:[num:2], meta:(x:num, y:num)):
    (pts:[1,2], meta:(x:3, y:4))

[num:2] extra: [5,6]
v: make().pts + extra
:: v
:: make().meta
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    cpp = emit_cpp_module(lowered)
    assert "struct VfRecord_" in cpp
    assert "std::array<double, 2>" in cpp
    assert "make().pts" in cpp
    assert "vf_array_add" in cpp
    assert "make().meta" in cpp


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_fixed_vector_index_program() -> None:
    src = """
sum_vec(x:[num:4]) -> num:
    i: 0
    acc: 0
    i < 4?>
        acc: acc + x.(i)
        i: i + 1
    acc

:: sum_vec([1,2,3,4])
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip() == "10"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_simple_program() -> None:
    src = """
twice(x:num) -> num:
    x * 2

num a: 3
:: twice(a)
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip() == "6"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_fixed_vector_program() -> None:
    src = """
join(x:[num:n], y:[num:m]) -> [num:n+m]:
    x & y

[num:2] a: [1,2]
[num:3] b: [3,4,5]
:: join(a, b)
:: a + [num:2]([5,6])
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == ["[1, 2, 3, 4, 5]", "[6, 8]"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_math_and_stat_intrinsics() -> None:
    src = """
:: math.sin(0)
:: stat.mean([1,2,3,4])
:: stat.range([3,1,4,1,5])
:: stat.count([1,2,3])
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.stdout.strip().splitlines() == ["0", "2.5", "4", "3"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_math_constants_and_extended_stats() -> None:
    src = """
:: math.pi
:: math.e
:: stat.median([1,2,3,4])
:: stat.percentile([1,2,3,4,5], 75)
:: stat.iqr([1,2,3,4,5])
:: stat.zscore([1,2,3])
:: stat.normalize([2,4,6])
:: stat.covariance([1,2,3], [2,4,6])
:: stat.correlation([1,2,3], [2,4,6])
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.stdout.strip().splitlines() == [
        "3.14159265358979",
        "2.71828182845905",
        "2.5",
        "4",
        "2",
        "[-1.22474487139159, 0, 1.22474487139159]",
        "[0, 0.5, 1]",
        "1.33333333333333",
        "1",
    ]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_struct_program() -> None:
    src = """
sum(p:(x:num, y:num)) -> num:
    p.x + p.y

(x:num, y:num) p: (x:3, y:4)
:: sum(p)
:: p
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == ["7", "(x:3, y:4)"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_dynamic_map_and_list_program() -> None:
    src = """
m: collections.map(a:1, b:"hi", c:true)
L: collections.list(:[1,2,3])
:: m
:: m.b
:: L
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == ["{a:1, b:hi, c:true}", "hi", "[1, 2, 3]"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_record_with_map_and_list_fields() -> None:
    src = """
make() -> (meta:map(name:str, ok:bool), items:list(num, num, num), total:num):
    (meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2,3]), total:3)

:: make()
:: make().meta
:: make().items
:: make().meta.name
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == [
        "(meta:{name:alice, ok:true}, items:[1, 2, 3], total:3)",
        "{name:alice, ok:true}",
        "[1, 2, 3]",
        "alice",
    ]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_transform_record_with_map_and_list_fields() -> None:
    src = """
update(state:(meta:map(name:str, ok:bool), items:list(num, num), total:num)) -> (meta:map(name:str, ok:bool), items:list(num, num, num), total:num):
    (meta:state.meta, items:state.items & collections.list(9), total:state.total + 1)

:: update((meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), total:2))
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip() == "(meta:{name:alice, ok:true}, items:[1, 2, 9], total:3)"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_nested_dynamic_map_and_list_program() -> None:
    src = """
make() -> (payload:map(meta:map(name:str, ok:bool), items:list(num, num), groups:list(map(name:str), map(name:str)))):
    (payload:collections.map(meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), groups:collections.list(collections.map(name:"a"), collections.map(name:"b"))))

:: make()
:: make().payload
:: make().payload.meta
:: make().payload.meta.name
:: make().payload.groups
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == [
        "(payload:{groups:[{name:a}, {name:b}], items:[1, 2], meta:{name:alice, ok:true}})",
        "{groups:[{name:a}, {name:b}], items:[1, 2], meta:{name:alice, ok:true}}",
        "{name:alice, ok:true}",
        "alice",
        "[{name:a}, {name:b}]",
    ]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_transform_nested_dynamic_map_and_list_record() -> None:
    src = """
update(state:(payload:map(meta:map(name:str, ok:bool), items:list(num, num), groups:list(map(name:str), map(name:str))))) -> (payload:map(meta:map(name:str, ok:bool), items:list(num, num, num), groups:list(map(name:str), map(name:str), map(name:str)))):
    (payload:collections.map(meta:state.payload.meta, items:state.payload.items & collections.list(9), groups:state.payload.groups & collections.list(collections.map(name:"c"))))

:: update((payload:collections.map(meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), groups:collections.list(collections.map(name:"a"), collections.map(name:"b")))))
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip() == "(payload:{groups:[{name:a}, {name:b}, {name:c}], items:[1, 2, 9], meta:{name:alice, ok:true}})"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_transform_direct_dynamic_map_payload() -> None:
    src = """
update(payload:map(meta:map(name:str, ok:bool), items:list(num, num), groups:list(map(name:str), map(name:str)))) -> map(meta:map(name:str, ok:bool), items:list(num, num, num), groups:list(map(name:str), map(name:str), map(name:str))):
    collections.map(meta:payload.meta, items:payload.items & collections.list(9), groups:payload.groups & collections.list(collections.map(name:"c")))

:: update(collections.map(meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), groups:collections.list(collections.map(name:"a"), collections.map(name:"b"))))
:: update(collections.map(meta:collections.map(name:"alice", ok:true), items:collections.list(:[1,2]), groups:collections.list(collections.map(name:"a"), collections.map(name:"b")))).meta.name
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == [
        "{groups:[{name:a}, {name:b}, {name:c}], items:[1, 2, 9], meta:{name:alice, ok:true}}",
        "alice",
    ]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_mixed_static_and_dynamic_collection_record() -> None:
    src = """
make() -> (pts:[num:2], payload:map(meta:map(name:str), items:list(num, num)), total:num):
    (pts:[1,2], payload:collections.map(meta:collections.map(name:"alice"), items:collections.list(:[3,4])), total:5)

:: make()
:: make().pts
:: make().payload
:: make().payload.meta.name
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == [
        "(pts:[1, 2], payload:{items:[3, 4], meta:{name:alice}}, total:5)",
        "[1, 2]",
        "{items:[3, 4], meta:{name:alice}}",
        "alice",
    ]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_loop_program() -> None:
    src = """
k: 0
k < 3?>
    k: k + 1
    @>
flag: 0
flag??>
    0 =>
        flag: 1
        @>
    1 => @|
:: k
:: flag
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == ["3", "1"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_return_channel_inside_control_flow() -> None:
    src = """
f(x:num) -> num:
    x > 0? @: x + 1
    x??>
        -1 => @: 99
        0 => @|
    num k: 0
    k < 5?>
        k: k + 1
        k = 3? @: k * 10
        @>
    0

:: f(4)
:: f(0)
:: f(-1)
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == ["5", "30", "99"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_bitmask_match_specificity() -> None:
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
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip() == "4"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_nested_record_vector_program() -> None:
    src = """
make() -> (pts:[num:2], meta:(x:num, y:num)):
    (pts:[1,2], meta:(x:3, y:4))

[num:2] extra: [5,6]
v: make().pts + extra
:: v
:: make().meta
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == ["[6, 8]", "(x:3, y:4)"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_multiset_program() -> None:
    src = """
merge(a:{num}, b:{num}) -> {num}:
    a + b

:: merge({1:1}, {2:2})
:: ({1:3, 2:1} * {1:1, 2:4})
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == ["{1:1, 2:2}", "{1:1, 2:1}"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_nested_record_with_multiset_field() -> None:
    src = """
make() -> (bag:{num}, total:num):
    (bag:{1:2, 3:1}, total:3)

:: make()
:: make().bag
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == ["(bag:{1:2, 3:1}, total:3)", "{1:2, 3:1}"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_record_with_vector_and_multiset_fields() -> None:
    src = """
make() -> (pts:[num:2], bag:{num}, total:num):
    (pts:[1,2], bag:{3:1, 4:2}, total:3)

:: make()
:: make().pts
:: make().bag
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip().splitlines() == ["(pts:[1, 2], bag:{3:1, 4:2}, total:3)", "[1, 2]", "{3:1, 4:2}"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_compile_and_run_transform_for_record_with_vector_and_multiset_fields() -> None:
    src = """
update(state:(pts:[num:2], bag:{num}, total:num), extra:[num:2], delta:{num}) -> (pts:[num:2], bag:{num}, total:num):
    (pts:state.pts + extra, bag:state.bag + delta, total:state.total + 2)

:: update((pts:[1,2], bag:{3:1}, total:1), [4,5], {6:2})
"""
    lowered = lower_module(parse_module(src, filename="<cpp-test>"))
    res = compile_and_run_module(lowered)
    assert res.returncode == 0
    assert res.stdout.strip() == "(pts:[5, 7], bag:{3:1, 6:2}, total:3)"

