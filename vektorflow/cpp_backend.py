from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import ast, ir
from .cpp_dynamic import (
    DynamicEmitHooks,
    cpp_dynamic_value_supported,
    emit_dynamic_any as _dyn_emit_dynamic_any,
    emit_linked_list_concat as _dyn_emit_linked_list_concat,
    emit_map_attr_access as _dyn_emit_map_attr_access,
    emit_linked_list_coercion as _dyn_emit_linked_list_coercion,
    emit_linked_list_literal as _dyn_emit_linked_list_literal,
    emit_map_coercion as _dyn_emit_map_coercion,
    emit_map_literal as _dyn_emit_map_literal,
    require_cpp_dynamic_value_supported,
)
from .optimize_ir import eliminate_noop_coercions, optimize_module
from .slot_ir import lower_slots
from .typed_ir import TypedIRError, annotate_module, TypedModuleInfo


class CppEmitError(Exception):
    pass


@dataclass(frozen=True)
class CppCompiler:
    kind: str
    path: str


@dataclass
class EmitState:
    struct_defs: dict[str, ast.TypeExpr]
    current_name_map: dict[str, str] | None

    def __init__(self) -> None:
        self.struct_defs = {}
        self.current_name_map = None


@dataclass(frozen=True)
class PreparedNativeModule:
    module: ir.Module
    typed: TypedModuleInfo
    functions: dict[str, ir.FunctionDef]


@dataclass(frozen=True)
class RuntimeFeatures:
    uses_arrays: bool = False
    uses_multisets: bool = False
    uses_dynamic: bool = False
    uses_match: bool = False


def _annotate_or_raise(module: ir.Module) -> TypedModuleInfo:
    try:
        return annotate_module(module)
    except TypedIRError as exc:
        raise CppEmitError(str(exc)) from exc


def _prepare_native_module(module: ir.Module) -> PreparedNativeModule:
    module = optimize_module(module)
    typed = _annotate_or_raise(module)
    module = lower_slots(module, typed)
    typed = _annotate_or_raise(module)
    module = eliminate_noop_coercions(module, typed)
    typed = _annotate_or_raise(module)
    functions = {stmt.name: stmt for stmt in module.statements if isinstance(stmt, ir.FunctionDef)}
    return PreparedNativeModule(module=module, typed=typed, functions=functions)


def _collect_runtime_features(module: ir.Module, typed: TypedModuleInfo) -> RuntimeFeatures:
    uses_arrays = False
    uses_multisets = False
    uses_dynamic = False
    uses_match = False

    def visit_type(t: Any) -> None:
        nonlocal uses_arrays, uses_multisets, uses_dynamic
        t = _normalize_type(t)
        if isinstance(t, ast.FixedVectorType):
            uses_arrays = True
            visit_type(t.element_type)
            return
        if isinstance(t, ast.MultisetType):
            uses_multisets = True
            visit_type(t.element_type)
            return
        if isinstance(t, ast.MapValueType):
            uses_dynamic = True
            for _, inner in t.fields:
                visit_type(inner)
            return
        if isinstance(t, ast.LinkedListValueType):
            uses_dynamic = True
            for inner in t.elements:
                visit_type(inner)
            return
        if isinstance(t, ast.TypeExpr):
            for _, inner in t.fields:
                visit_type(inner)
            return
        if isinstance(t, ast.TupleTypeExpr):
            for inner in t.elements:
                visit_type(inner)
            return
        if isinstance(t, ast.FuncType):
            visit_type(t.domain)
            visit_type(t.codomain)

    def visit_stmt(stmt: Any) -> None:
        nonlocal uses_match
        if isinstance(stmt, ir.FunctionDef):
            for ptype in stmt.param_types:
                if ptype is not None:
                    visit_type(ptype)
            if stmt.return_type is not None:
                visit_type(stmt.return_type)
            visit_block(stmt.body)
        elif isinstance(stmt, ir.IfStmt):
            visit_block(stmt.body)
        elif isinstance(stmt, ir.WhileStmt):
            visit_block(stmt.body)
        elif isinstance(stmt, ir.MatchStmt):
            uses_match = True
            for arm in stmt.arms:
                visit_block(arm.body)

    def visit_block(block: ir.Block) -> None:
        for inner in block.statements:
            visit_stmt(inner)

    for expr_type in typed.expr_types.values():
        visit_type(expr_type)
    for stmt in module.statements:
        visit_stmt(stmt)
    return RuntimeFeatures(
        uses_arrays=uses_arrays,
        uses_multisets=uses_multisets,
        uses_dynamic=uses_dynamic,
        uses_match=uses_match,
    )


def _emit_runtime_headers(features: RuntimeFeatures) -> list[str]:
    headers = [
        "#include <cmath>",
        "#include <iomanip>",
        "#include <iostream>",
        "#include <sstream>",
        "#include <stdexcept>",
        "#include <string>",
    ]
    if features.uses_arrays:
        headers.insert(0, "#include <array>")
    if features.uses_multisets or features.uses_dynamic:
        headers.insert(0, "#include <map>")
    if features.uses_dynamic:
        headers.insert(0, "#include <list>")
        headers.insert(0, "#include <any>")
    if features.uses_multisets:
        headers.insert(0, "#include <algorithm>")
    headers.append("")
    return headers


def _emit_runtime_support(features: RuntimeFeatures) -> list[str]:
    lines = [
        "static std::string vf_format_num(double v) {",
        "    if (std::floor(v) == v) {",
        "        std::ostringstream oss;",
        "        oss << static_cast<long long>(v);",
        "        return oss.str();",
        "    }",
        "    std::ostringstream oss;",
        "    oss << std::setprecision(15) << v;",
        "    return oss.str();",
        "}",
        "template <typename T>",
        "static std::string vf_format_value(const T& v) {",
        "    std::ostringstream oss;",
        "    oss << v;",
        "    return oss.str();",
        "}",
        "template <>",
        "inline std::string vf_format_value<bool>(const bool& v) {",
        '    return v ? "true" : "false";',
        "}",
        "template <>",
        "inline std::string vf_format_value<double>(const double& v) {",
        "    return vf_format_num(v);",
        "}",
    ]
    if features.uses_match:
        lines.extend(
            [
                "template <typename A, typename B>",
                "static int vf_match_specificity(const A& a, const B& b) {",
                "    return (a == b) ? 0 : -1;",
                "}",
                "static int vf_match_specificity(const long long& exact_code, const long long& pattern_code) {",
                "    const long long base_mask = 0xFFFLL;",
                "    const long long frame_shift = 12LL;",
                "    const long long frame_mask = 0x3FFLL;",
                "    const long long widget_shift = 22LL;",
                "    const long long widget_mask = 0xFFLL;",
                "    const long long mode_shift = 30LL;",
                "    const long long mode_mask = 0x3LL;",
                "    const long long mode_exact = 0LL;",
                "    const long long mode_ui = 1LL;",
                "    const long long mode_frame = 2LL;",
                "    const long long mode_widget = 3LL;",
                "    if (exact_code == pattern_code) return 3;",
                "    const long long pmode = (pattern_code >> mode_shift) & mode_mask;",
                "    if (pmode == mode_exact) return exact_code == pattern_code ? 3 : -1;",
                "    if (pmode == mode_ui) return ((exact_code & base_mask) == (pattern_code & base_mask)) ? 0 : -1;",
                "    if (pmode == mode_frame) {",
                "        const long long em = exact_code & (base_mask | (frame_mask << frame_shift));",
                "        const long long pm = pattern_code & (base_mask | (frame_mask << frame_shift));",
                "        return em == pm ? 1 : -1;",
                "    }",
                "    if (pmode == mode_widget) {",
                "        const long long em = exact_code & (base_mask | (widget_mask << widget_shift));",
                "        const long long pm = pattern_code & (base_mask | (widget_mask << widget_shift));",
                "        return em == pm ? 2 : -1;",
                "    }",
                "    return -1;",
                "}",
            ]
        )
    if features.uses_arrays:
        lines.extend(
            [
                "template <typename T, std::size_t N>",
                "static std::string vf_format_value(const std::array<T, N>& v) {",
                "    std::ostringstream oss;",
                '    oss << "[";',
                "    for (std::size_t i = 0; i < N; ++i) {",
                '        if (i) oss << ", ";',
                "        oss << vf_format_value(v[i]);",
                "    }",
                '    oss << "]";',
                "    return oss.str();",
                "}",
            ]
        )
    if features.uses_multisets:
        lines.extend(
            [
                "template <typename T>",
                "static std::string vf_format_value(const std::map<T, long long>& v) {",
                "    std::ostringstream oss;",
                '    oss << "{";',
                "    bool first = true;",
                "    for (const auto& kv : v) {",
                '        if (!first) oss << ", ";',
                "        first = false;",
                '        oss << vf_format_value(kv.first) << ":" << kv.second;',
                "    }",
                '    oss << "}";',
                "    return oss.str();",
                "}",
            ]
        )
    if features.uses_dynamic:
        lines.extend(
            [
                "static std::string vf_format_any(const std::any& v);",
                "static std::string vf_format_value(const std::map<std::string, std::any>& v) {",
                "    std::ostringstream oss;",
                '    oss << "{";',
                "    bool first = true;",
                "    for (const auto& kv : v) {",
                '        if (!first) oss << ", ";',
                "        first = false;",
                '        oss << kv.first << ":" << vf_format_any(kv.second);',
                "    }",
                '    oss << "}";',
                "    return oss.str();",
                "}",
                "static std::string vf_format_value(const std::list<std::any>& v) {",
                "    std::ostringstream oss;",
                '    oss << "[";',
                "    bool first = true;",
                "    for (const auto& item : v) {",
                '        if (!first) oss << ", ";',
                "        first = false;",
                "        oss << vf_format_any(item);",
                "    }",
                '    oss << "]";',
                "    return oss.str();",
                "}",
                "static std::string vf_format_any(const std::any& v) {",
                "    if (v.type() == typeid(bool)) return vf_format_value(std::any_cast<bool>(v));",
                "    if (v.type() == typeid(long long)) return vf_format_value(std::any_cast<long long>(v));",
                "    if (v.type() == typeid(double)) return vf_format_value(std::any_cast<double>(v));",
                "    if (v.type() == typeid(std::string)) return vf_format_value(std::any_cast<std::string>(v));",
                "    if (v.type() == typeid(std::map<std::string, std::any>)) return vf_format_value(std::any_cast<const std::map<std::string, std::any>&>(v));",
                "    if (v.type() == typeid(std::list<std::any>)) return vf_format_value(std::any_cast<const std::list<std::any>&>(v));",
                "    throw std::runtime_error(\"unsupported dynamic value type\");",
                "}",
            ]
        )
    lines.extend(
        [
            "static double vf_to_num(double v) { return v; }",
            "static double vf_to_num(long long v) { return static_cast<double>(v); }",
            "static double vf_to_num(bool v) { return v ? 1.0 : 0.0; }",
            "static long long vf_to_int(long long v) { return v; }",
            "static long long vf_to_int(bool v) { return v ? 1LL : 0LL; }",
            "static long long vf_to_int(double v) {",
            "    if (std::floor(v) != v) throw std::runtime_error(\"int cast requires integer-valued number\");",
            "    return static_cast<long long>(v);",
            "}",
            "static bool vf_to_bool(bool v) { return v; }",
            "static std::string vf_to_str(const std::string& v) { return v; }",
        ]
    )
    if features.uses_arrays:
        lines.extend(
            [
                "template <typename T, std::size_t N, typename U>",
                "static std::array<T, N> vf_array_cast(const std::array<U, N>& src) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) {",
                "        out[i] = static_cast<T>(src[i]);",
                "    }",
                "    return out;",
                "}",
                "template <typename T, std::size_t A, std::size_t B>",
                "static std::array<T, A + B> vf_array_cat(const std::array<T, A>& left, const std::array<T, B>& right) {",
                "    std::array<T, A + B> out{};",
                "    for (std::size_t i = 0; i < A; ++i) out[i] = left[i];",
                "    for (std::size_t i = 0; i < B; ++i) out[A + i] = right[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static std::array<T, N> vf_array_add(const std::array<T, N>& left, const std::array<T, N>& right) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = left[i] + right[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static std::array<T, N> vf_array_sub(const std::array<T, N>& left, const std::array<T, N>& right) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = left[i] - right[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static std::array<T, N> vf_array_mul(const std::array<T, N>& left, const std::array<T, N>& right) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = left[i] * right[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N>",
                "static std::array<T, N> vf_array_div(const std::array<T, N>& left, const std::array<T, N>& right) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = left[i] / right[i];",
                "    return out;",
                "}",
                "template <typename T, std::size_t N, typename S>",
                "static std::array<T, N> vf_array_scale(const std::array<T, N>& arr, const S& scalar) {",
                "    std::array<T, N> out{};",
                "    for (std::size_t i = 0; i < N; ++i) out[i] = arr[i] * static_cast<T>(scalar);",
                "    return out;",
                "}",
            ]
        )
    if features.uses_multisets:
        lines.extend(
            [
                "template <typename T>",
                "static std::map<T, long long> vf_mset_make(std::initializer_list<std::pair<T, long long>> items) {",
                "    std::map<T, long long> out;",
                "    for (const auto& kv : items) {",
                "        if (kv.second > 0) out[kv.first] += kv.second;",
                "    }",
                "    return out;",
                "}",
                "template <typename T>",
                "static std::map<T, long long> vf_mset_union(const std::map<T, long long>& left, const std::map<T, long long>& right) {",
                "    std::map<T, long long> out = left;",
                "    for (const auto& kv : right) out[kv.first] += kv.second;",
                "    return out;",
                "}",
                "template <typename T>",
                "static std::map<T, long long> vf_mset_difference(const std::map<T, long long>& left, const std::map<T, long long>& right) {",
                "    std::map<T, long long> out = left;",
                "    for (const auto& kv : right) {",
                "        auto it = out.find(kv.first);",
                "        if (it == out.end()) continue;",
                "        it->second -= kv.second;",
                "        if (it->second <= 0) out.erase(it);",
                "    }",
                "    return out;",
                "}",
                "template <typename T>",
                "static std::map<T, long long> vf_mset_intersection(const std::map<T, long long>& left, const std::map<T, long long>& right) {",
                "    std::map<T, long long> out;",
                "    for (const auto& kv : left) {",
                "        auto it = right.find(kv.first);",
                "        if (it == right.end()) continue;",
                "        long long count = std::min(kv.second, it->second);",
                "        if (count > 0) out[kv.first] = count;",
                "    }",
                "    return out;",
                "}",
                "template <typename T>",
                "static std::map<T, long long> vf_mset_symdiff(const std::map<T, long long>& left, const std::map<T, long long>& right) {",
                "    return vf_mset_union(vf_mset_difference(left, right), vf_mset_difference(right, left));",
                "}",
            ]
        )
    if features.uses_dynamic:
        lines.extend(
            [
                "static std::map<std::string, std::any> vf_map_make(std::initializer_list<std::pair<std::string, std::any>> items) {",
                "    std::map<std::string, std::any> out;",
                "    for (const auto& kv : items) out.emplace(kv.first, kv.second);",
                "    return out;",
                "}",
                "static std::list<std::any> vf_list_make(std::initializer_list<std::any> items) {",
                "    return std::list<std::any>(items.begin(), items.end());",
                "}",
                "template <typename T, std::size_t N>",
                "static std::list<std::any> vf_list_from_array(const std::array<T, N>& src) {",
                "    std::list<std::any> out;",
                "    for (const auto& item : src) out.emplace_back(item);",
                "    return out;",
                "}",
                "static std::list<std::any> vf_list_cat(const std::list<std::any>& left, const std::list<std::any>& right) {",
                "    std::list<std::any> out = left;",
                "    out.insert(out.end(), right.begin(), right.end());",
                "    return out;",
                "}",
            ]
        )
    lines.append("")
    return lines


def discover_cpp_compiler() -> CppCompiler | None:
    for name in ("clang++", "g++", "cl"):
        path = shutil.which(name)
        if path:
            return CppCompiler(name, path)
    fallback_candidates = (
        ("clang++", Path(r"C:\Program Files\LLVM\bin\clang++.exe")),
        ("clang++", Path(r"C:\Program Files (x86)\LLVM\bin\clang++.exe")),
    )
    for kind, path in fallback_candidates:
        if path.is_file():
            return CppCompiler(kind, str(path))
    return None


def compile_cpp_source(source: str, out_dir: Path, exe_name: str = "vf_program") -> Path:
    compiler = discover_cpp_compiler()
    if compiler is None:
        raise CppEmitError("no C++ compiler found on PATH")
    out_dir.mkdir(parents=True, exist_ok=True)
    cpp_path = out_dir / f"{exe_name}.cpp"
    exe_path = out_dir / (f"{exe_name}.exe" if compiler.kind == "cl" else exe_name)
    cpp_path.write_text(source, encoding="utf-8")
    if compiler.kind == "cl":
        raise CppEmitError("cl.exe is not yet supported by the automated compiler runner")
    cmd = [compiler.path, "-std=c++20", "-O2", str(cpp_path), "-o", str(exe_path)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise CppEmitError(res.stderr.strip() or res.stdout.strip() or "C++ compilation failed")
    return exe_path


def run_cpp_executable(exe_path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([str(exe_path)], capture_output=True, text=True)


def _normalize_type(t: Any) -> Any:
    if isinstance(t, ast.NamedTypeSpec):
        return _normalize_type(t.type_expr)
    return t


def _type_key(t: Any) -> str:
    t = _normalize_type(t)
    if isinstance(t, ast.PrimTypeRef):
        return f"prim:{t.name}"
    if isinstance(t, ast.FixedVectorType):
        return f"vec[{_type_key(t.element_type)}:{_size_key(t.size)}]"
    if isinstance(t, ast.TypeExpr):
        inner = ",".join(f"{name}:{_type_key(inner)}" for name, inner in t.fields)
        return f"record({inner})"
    if isinstance(t, ast.MultisetType):
        return f"mset{{{_type_key(t.element_type)}}}"
    if isinstance(t, ast.MapValueType):
        inner = ",".join(f"{name}:{_type_key(inner)}" for name, inner in t.fields)
        return f"map({inner})"
    if isinstance(t, ast.LinkedListValueType):
        return f"list({','.join(_type_key(e) for e in t.elements)})"
    if isinstance(t, ast.TupleTypeExpr):
        return f"tuple({','.join(_type_key(e) for e in t.elements)})"
    if isinstance(t, ast.FuncType):
        return f"func({_type_key(t.domain)})->{_type_key(t.codomain)}"
    raise CppEmitError(f"unsupported type key for {type(t).__name__}")


def _size_key(size: Any) -> str:
    if isinstance(size, ast.TypeSizeConst):
        return str(size.value)
    if isinstance(size, ast.TypeSizeVar):
        return size.name
    if isinstance(size, ast.TypeSizeBinOp):
        return f"({_size_key(size.left)}{size.op}{_size_key(size.right)})"
    raise CppEmitError(f"unsupported size key for {type(size).__name__}")


def _struct_name(t: ast.TypeExpr) -> str:
    key = _type_key(t)
    return f"VfRecord_{abs(hash(key)) & 0xFFFFFFFF:08x}"


def _register_type(t: Any, state: EmitState) -> None:
    t = _normalize_type(t)
    if isinstance(t, ast.TypeExpr):
        name = _struct_name(t)
        if name not in state.struct_defs:
            state.struct_defs[name] = t
        for _, inner in t.fields:
            _register_type(inner, state)
        return
    if isinstance(t, ast.FixedVectorType):
        _register_type(t.element_type, state)
        return
    if isinstance(t, ast.MultisetType):
        _register_type(t.element_type, state)
        return
    if isinstance(t, ast.MapValueType):
        for _, inner in t.fields:
            _register_type(inner, state)
        return
    if isinstance(t, ast.LinkedListValueType):
        for inner in t.elements:
            _register_type(inner, state)
        return
    if isinstance(t, ast.TupleTypeExpr):
        for inner in t.elements:
            _register_type(inner, state)
        return
    if isinstance(t, ast.FuncType):
        _register_type(t.domain, state)
        _register_type(t.codomain, state)
        return


def _emit_size_expr(size: Any) -> str:
    if isinstance(size, ast.TypeSizeConst):
        return str(size.value)
    if isinstance(size, ast.TypeSizeVar):
        return size.name
    if isinstance(size, ast.TypeSizeBinOp):
        op_map = {
            "PLUS": "+",
            "MINUS": "-",
            "STAR": "*",
            "SLASH": "/",
            "+": "+",
            "-": "-",
            "*": "*",
            "/": "/",
        }
        if size.op not in op_map:
            raise CppEmitError(f"unsupported size-expression op {size.op}")
        left = _emit_size_expr(size.left)
        right = _emit_size_expr(size.right)
        return f"({left} {op_map[size.op]} {right})"
    raise CppEmitError(f"unsupported size expression {type(size).__name__}")


def _collect_size_vars(type_expr: Any, out: set[str]) -> None:
    type_expr = _normalize_type(type_expr)
    if isinstance(type_expr, ast.FixedVectorType):
        _collect_size_vars_from_size(type_expr.size, out)
        _collect_size_vars(type_expr.element_type, out)
    elif isinstance(type_expr, ast.TypeExpr):
        for _, inner in type_expr.fields:
            _collect_size_vars(inner, out)
    elif isinstance(type_expr, ast.TupleTypeExpr):
        for inner in type_expr.elements:
            _collect_size_vars(inner, out)
    elif isinstance(type_expr, ast.MultisetType):
        _collect_size_vars(type_expr.element_type, out)
    elif isinstance(type_expr, ast.FuncType):
        _collect_size_vars(type_expr.domain, out)
        _collect_size_vars(type_expr.codomain, out)


def _collect_size_vars_from_size(size: Any, out: set[str]) -> None:
    if isinstance(size, ast.TypeSizeVar):
        out.add(size.name)
    elif isinstance(size, ast.TypeSizeBinOp):
        _collect_size_vars_from_size(size.left, out)
        _collect_size_vars_from_size(size.right, out)


def _cpp_multiset_key_supported(t: Any) -> bool:
    t = _normalize_type(t)
    return isinstance(t, ast.PrimTypeRef) and t.name in {"bool", "int", "num", "str"}


def _cpp_dynamic_value_supported(t: Any) -> bool:
    return cpp_dynamic_value_supported(t, _normalize_type)


def _require_cpp_dynamic_value_supported(t: Any, context: str) -> Any:
    return require_cpp_dynamic_value_supported(t, _normalize_type, CppEmitError, context)


def _dynamic_hooks() -> DynamicEmitHooks:
    return DynamicEmitHooks(
        normalize_type=_normalize_type,
        expr_type=_expr_type,
        emit_expr=_emit_expr,
        emit_const=_emit_const,
        cpp_type=_cpp_type,
    )


def _cpp_type(t: Any, state: EmitState | None = None) -> str:
    t = _normalize_type(t)
    if isinstance(t, ast.PrimTypeRef):
        if t.name == "int":
            return "long long"
        if t.name == "num":
            return "double"
        if t.name == "bool":
            return "bool"
        if t.name == "str":
            return "std::string"
    if isinstance(t, ast.TypeExpr):
        if state is not None:
            _register_type(t, state)
        return _struct_name(t)
    if isinstance(t, ast.FixedVectorType):
        return f"std::array<{_cpp_type(t.element_type, state)}, {_emit_size_expr(t.size)}>"
    if isinstance(t, ast.MultisetType):
        # Multisets are defined as sorted collections, so the native subset
        # uses std::map and currently limits keys to builtins with a clear order.
        if not _cpp_multiset_key_supported(t.element_type):
            raise CppEmitError("compiled multisets currently require primitive ordered key types")
        return f"std::map<{_cpp_type(t.element_type, state)}, long long>"
    if isinstance(t, ast.MapValueType):
        for _, inner in t.fields:
            _require_cpp_dynamic_value_supported(inner, "compiled maps")
        return "std::map<std::string, std::any>"
    if isinstance(t, ast.LinkedListValueType):
        for inner in t.elements:
            _require_cpp_dynamic_value_supported(inner, "compiled lists")
        return "std::list<std::any>"
    raise CppEmitError(f"unsupported C++ type emission for {type(t).__name__}")


def _const_type(value: Any) -> Any:
    if isinstance(value, bool):
        return ast.PrimTypeRef("bool")
    if value is None:
        raise CppEmitError("null is not yet supported in C++ emission")
    if isinstance(value, (int, float)):
        return ast.PrimTypeRef("num")
    if isinstance(value, str):
        return ast.PrimTypeRef("str")
    raise CppEmitError(f"unsupported constant type {type(value).__name__}")


def _promote_numeric(a: Any, b: Any) -> Any:
    a = _normalize_type(a)
    b = _normalize_type(b)
    if not isinstance(a, ast.PrimTypeRef) or not isinstance(b, ast.PrimTypeRef):
        raise CppEmitError("unsupported non-primitive numeric promotion")
    if a.name == "num" or b.name == "num":
        return ast.PrimTypeRef("num")
    if a.name == "int" and b.name == "int":
        return ast.PrimTypeRef("int")
    if a.name == "bool" and b.name == "bool":
        return ast.PrimTypeRef("bool")
    if {a.name, b.name} <= {"bool", "int"}:
        return ast.PrimTypeRef("int")
    raise CppEmitError(f"unsupported numeric promotion {a.name} vs {b.name}")


def _same_primitive_name(a: Any, b: Any) -> bool:
    a = _normalize_type(a)
    b = _normalize_type(b)
    return isinstance(a, ast.PrimTypeRef) and isinstance(b, ast.PrimTypeRef) and a.name == b.name


def _is_scalar_numeric_type(t: Any) -> bool:
    t = _normalize_type(t)
    return isinstance(t, ast.PrimTypeRef) and t.name in {"bool", "int", "num"}


def _expr_type(node: Any, typed: TypedModuleInfo) -> Any:
    return _normalize_type(typed.expr_type(node))


def _cpp_name(name: str, state: EmitState) -> str:
    if state.current_name_map is None:
        return name
    return state.current_name_map.get(name, name)


def _infer_expr_type(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef]) -> Any:
    if isinstance(node, ir.Const):
        return _const_type(node.value)
    if isinstance(node, ir.LoadName):
        if node.name not in env:
            raise CppEmitError(f"unknown name in C++ emitter: {node.name}")
        return env[node.name]
    if isinstance(node, ir.CoerceExpr):
        return _normalize_type(node.target_type)
    if isinstance(node, ir.ListExpr):
        if not node.elements:
            raise CppEmitError("empty list literals are not yet supported in C++ emission")
        elem_types = [_infer_expr_type(e, env, functions) for e in node.elements]
        cur = elem_types[0]
        for nxt in elem_types[1:]:
            cur = _promote_numeric(cur, nxt)
        return ast.FixedVectorType(cur, ast.TypeSizeConst(len(node.elements)))
    if isinstance(node, ir.MultisetExpr):
        if not node.pairs:
            raise CppEmitError("empty multiset literals are not yet supported in C++ emission")
        elem_types = [_infer_expr_type(value, env, functions) for value, _ in node.pairs]
        cur = elem_types[0]
        for nxt in elem_types[1:]:
            if isinstance(_normalize_type(cur), ast.PrimTypeRef) and isinstance(_normalize_type(nxt), ast.PrimTypeRef):
                cur = _promote_numeric(cur, nxt)
            elif _normalize_type(cur) != _normalize_type(nxt):
                raise CppEmitError("multiset literal requires compatible element types")
        return ast.MultisetType(cur)
    if isinstance(node, ir.MapExpr):
        return ast.MapValueType([(name, _infer_expr_type(value, env, functions)) for name, value in node.fields])
    if isinstance(node, ir.LinkedListExpr):
        if node.spread is not None:
            spread_t = _normalize_type(_infer_expr_type(node.spread, env, functions))
            if isinstance(spread_t, ast.FixedVectorType):
                if not isinstance(spread_t.size, ast.TypeSizeConst):
                    raise CppEmitError("linked-list spread requires a resolved source size in C++ emission")
                return ast.LinkedListValueType([spread_t.element_type] * spread_t.size.value)
            if isinstance(spread_t, ast.LinkedListValueType):
                return spread_t
            raise CppEmitError("linked-list spread requires a vector or linked-list source")
        return ast.LinkedListValueType([_infer_expr_type(elem, env, functions) for elem in node.elements])
    if isinstance(node, ir.StructExpr):
        return ast.TypeExpr([(name, _infer_expr_type(value, env, functions)) for name, value in node.fields])
    if isinstance(node, ir.AttrExpr):
        base_t = _normalize_type(_infer_expr_type(node.value, env, functions))
        if not isinstance(base_t, ast.TypeExpr):
            if isinstance(base_t, ast.MapValueType):
                for name, inner in base_t.fields:
                    if name == node.name:
                        return inner
                raise CppEmitError(f"missing field {node.name!r} in map value")
            raise CppEmitError("attribute access requires a struct or map type in C++ emission")
        for name, inner in base_t.fields:
            if name == node.name:
                return inner
        raise CppEmitError(f"missing field {node.name!r} in struct type")
    if isinstance(node, ir.IndexExpr):
        current_t = _normalize_type(_infer_expr_type(node.value, env, functions))
        for idx in node.indices:
            idx_t = _normalize_type(_infer_expr_type(idx, env, functions))
            if not _is_scalar_numeric_type(idx_t):
                raise CppEmitError("index access requires a numeric index in C++ emission")
            if isinstance(current_t, ast.FixedVectorType):
                current_t = _normalize_type(current_t.element_type)
                continue
            raise CppEmitError("index access currently requires a fixed-vector type in C++ emission")
        return current_t
    if isinstance(node, ir.UnaryExpr):
        t = _infer_expr_type(node.operand, env, functions)
        if node.op == "NOT":
            return ast.PrimTypeRef("bool")
        return t
    if isinstance(node, ir.BinaryExpr):
        lt = _infer_expr_type(node.left, env, functions)
        rt = _infer_expr_type(node.right, env, functions)
        if node.op == "AMPERSAND":
            lt_n = _normalize_type(lt)
            rt_n = _normalize_type(rt)
            if isinstance(lt_n, ast.FixedVectorType) and isinstance(rt_n, ast.FixedVectorType):
                if not _same_primitive_name(lt_n.element_type, rt_n.element_type):
                    raise CppEmitError("vector concat requires matching element types")
                return ast.FixedVectorType(
                    lt_n.element_type,
                    ast.TypeSizeBinOp("PLUS", lt_n.size, rt_n.size),
                )
            if isinstance(lt_n, ast.LinkedListValueType) and isinstance(rt_n, ast.LinkedListValueType):
                return ast.LinkedListValueType(list(lt_n.elements) + list(rt_n.elements))
        if node.op in ("PLUS", "MINUS", "STAR", "SLASH", "PERCENT", "CARET"):
            lt_n = _normalize_type(lt)
            rt_n = _normalize_type(rt)
            if isinstance(lt_n, ast.FixedVectorType) and isinstance(rt_n, ast.FixedVectorType):
                if node.op not in ("PLUS", "MINUS", "STAR", "SLASH"):
                    raise CppEmitError(f"unsupported vector op for C++ emitter: {node.op}")
                if not _same_primitive_name(lt_n.element_type, rt_n.element_type):
                    raise CppEmitError("vector arithmetic requires matching element types")
                return lt_n
                if node.op == "STAR":
                    if isinstance(lt_n, ast.FixedVectorType) and _is_scalar_numeric_type(rt_n):
                        return lt_n
                    if isinstance(rt_n, ast.FixedVectorType) and _is_scalar_numeric_type(lt_n):
                        return rt_n
                if isinstance(lt_n, ast.MultisetType) and isinstance(rt_n, ast.MultisetType):
                    if lt_n.element_type != rt_n.element_type:
                        raise CppEmitError("multiset arithmetic requires matching element types")
                    return lt_n
            return _promote_numeric(lt, rt)
        if node.op in ("EQ", "NEQ", "LT", "LE", "GT", "GE", "AND", "OR", "XOR"):
            return ast.PrimTypeRef("bool")
        if node.op == "AMPERSAND":
            if isinstance(_normalize_type(lt), ast.PrimTypeRef) and _normalize_type(lt).name == "str":
                return ast.PrimTypeRef("str")
            if isinstance(_normalize_type(rt), ast.PrimTypeRef) and _normalize_type(rt).name == "str":
                return ast.PrimTypeRef("str")
        raise CppEmitError(f"unsupported binary op for C++ emitter: {node.op}")
    if isinstance(node, ir.CallExpr):
        if isinstance(node.func, ir.LoadName):
            fname = node.func.name
            if fname in ("int", "num", "bool", "str"):
                return ast.PrimTypeRef(fname)
            if fname in functions:
                r = functions[fname].return_type
                if r is None:
                    raise CppEmitError(f"function {fname} missing return type for C++ emission")
                return _normalize_type(r)
        raise CppEmitError("unsupported call target for C++ emitter")
    raise CppEmitError(f"unsupported IR expr type {type(node).__name__}")


def _emit_const(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, str):
        escaped = value.encode("unicode_escape").decode("ascii").replace('"', '\\"')
        return f'"{escaped}"'
    raise CppEmitError(f"unsupported constant for C++ emission: {type(value).__name__}")


def _emit_vector_coercion(node: ir.CoerceExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    target = _normalize_type(node.target_type)
    if not isinstance(target, ast.FixedVectorType):
        raise CppEmitError("internal: vector coercion helper needs a fixed-vector target")
    if isinstance(node.expr, ir.ListExpr):
        elems = [_emit_expr(ir.CoerceExpr(elem, target.element_type), env, functions, state, typed) for elem in node.expr.elements]
        return f"{_cpp_type(target, state)}{{{', '.join(elems)}}}"
    inner = _emit_expr(node.expr, env, functions, state, typed)
    return f"vf_array_cast<{_cpp_type(target.element_type, state)}, {_emit_size_expr(target.size)}>({inner})"


def _emit_multiset_coercion(node: ir.CoerceExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    target = _normalize_type(node.target_type)
    if not isinstance(target, ast.MultisetType):
        raise CppEmitError("internal: multiset coercion helper needs a multiset target")
    if isinstance(node.expr, ir.MultisetExpr):
        pairs = []
        for value, count in node.expr.pairs:
            elem = _emit_expr(ir.CoerceExpr(value, target.element_type), env, functions, state, typed)
            cnt = _emit_expr(ir.CoerceExpr(count, ast.PrimTypeRef("int")), env, functions, state, typed)
            pairs.append(f"{{{elem}, static_cast<long long>({cnt})}}")
        return f"vf_mset_make<{_cpp_type(target.element_type, state)}>({{{', '.join(pairs)}}})"
    return _emit_expr(node.expr, env, functions, state, typed)


def _emit_map_coercion(node: ir.CoerceExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_map_coercion(
        node,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _emit_linked_list_coercion(node: ir.CoerceExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_linked_list_coercion(
        node,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _emit_record_coercion(node: ir.CoerceExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    target = _normalize_type(node.target_type)
    if not isinstance(target, ast.TypeExpr):
        raise CppEmitError("internal: record coercion helper needs a record target")
    if isinstance(node.expr, ir.StructExpr):
        _register_type(target, state)
        value_map = {name: value for name, value in node.expr.fields}
        elems = []
        for fname, ftype in target.fields:
            if fname not in value_map:
                raise CppEmitError(f"missing field {fname!r} for struct coercion")
            elems.append(_emit_expr(ir.CoerceExpr(value_map[fname], ftype), env, functions, state, typed))
        return f"{_cpp_type(target, state)}{{{', '.join(elems)}}}"
    return _emit_expr(node.expr, env, functions, state, typed)


def _emit_list_literal(node: ir.ListExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    inferred = _expr_type(node, typed)
    if not isinstance(inferred, ast.FixedVectorType):
        raise CppEmitError("list literal did not infer a fixed-vector type")
    elems = [_emit_expr(ir.CoerceExpr(elem, inferred.element_type), env, functions, state, typed) for elem in node.elements]
    return f"{_cpp_type(inferred, state)}{{{', '.join(elems)}}}"


def _emit_multiset_literal(node: ir.MultisetExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    inferred = _expr_type(node, typed)
    if not isinstance(inferred, ast.MultisetType):
        raise CppEmitError("multiset literal did not infer a multiset type")
    return _emit_multiset_coercion(ir.CoerceExpr(node, inferred), env, functions, state, typed)


def _emit_dynamic_any(expr: Any, expr_type: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_dynamic_any(
        expr,
        expr_type,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _emit_map_literal(node: ir.MapExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_map_literal(
        node,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _emit_linked_list_literal(node: ir.LinkedListExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_linked_list_literal(
        node,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _emit_map_attr_access(node: ir.AttrExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    return _dyn_emit_map_attr_access(
        node,
        env,
        functions,
        state,
        typed,
        hooks=_dynamic_hooks(),
        error_type=CppEmitError,
    )


def _emit_dynamic_collection_binary(node: ir.BinaryExpr, left: str, right: str, left_type: Any, right_type: Any) -> str | None:
    if node.op == "AMPERSAND":
        return _dyn_emit_linked_list_concat(
            left,
            right,
            left_type,
            right_type,
            hooks=_dynamic_hooks(),
            error_type=CppEmitError,
        )
    return None


def _emit_fused_array_expr(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str | None:
    node_type = _normalize_type(_expr_type(node, typed))
    if not isinstance(node_type, ast.FixedVectorType):
        return None
    scalar_expr = _emit_fused_array_scalar(node, "vf_i", env, functions, state, typed)
    if scalar_expr is None:
        return None
    elem_cpp = _cpp_type(node_type.element_type, state)
    arr_cpp = _cpp_type(node_type, state)
    size_cpp = _emit_size_expr(node_type.size)
    return (
        "([&]() { "
        f"{arr_cpp} vf_out{{}}; "
        f"for (std::size_t vf_i = 0; vf_i < {size_cpp}; ++vf_i) "
        f"vf_out[vf_i] = static_cast<{elem_cpp}>({scalar_expr}); "
        "return vf_out; "
        "}())"
    )


def _emit_fused_array_scalar(node: Any, idx_name: str, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str | None:
    node_type = _normalize_type(_expr_type(node, typed))
    if not isinstance(node_type, ast.FixedVectorType):
        return None
    if isinstance(node, (ir.LoadName, ir.LoadSlot)):
        return f"{_emit_expr(node, env, functions, state, typed)}[{idx_name}]"
    if isinstance(node, ir.AttrExpr):
        base_type = _normalize_type(_expr_type(node.value, typed))
        if isinstance(base_type, ast.TypeExpr):
            return f"{_emit_expr(node, env, functions, state, typed)}[{idx_name}]"
        return None
    if isinstance(node, ir.CoerceExpr) and isinstance(_normalize_type(node.target_type), ast.FixedVectorType):
        return _emit_fused_array_scalar(node.expr, idx_name, env, functions, state, typed)
    if isinstance(node, ir.BinaryExpr):
        left_type = _normalize_type(_expr_type(node.left, typed))
        right_type = _normalize_type(_expr_type(node.right, typed))
        op_map = {
            "PLUS": "+",
            "MINUS": "-",
            "STAR": "*",
            "SLASH": "/",
        }
        if node.op in op_map:
            if isinstance(left_type, ast.FixedVectorType) and isinstance(right_type, ast.FixedVectorType):
                left = _emit_fused_array_scalar(node.left, idx_name, env, functions, state, typed)
                right = _emit_fused_array_scalar(node.right, idx_name, env, functions, state, typed)
                if left is None or right is None:
                    return None
                return f"({left} {op_map[node.op]} {right})"
            if node.op == "STAR":
                if isinstance(left_type, ast.FixedVectorType) and _is_scalar_numeric_type(right_type):
                    left = _emit_fused_array_scalar(node.left, idx_name, env, functions, state, typed)
                    if left is None:
                        return None
                    right = _emit_expr(node.right, env, functions, state, typed)
                    return f"({left} * {right})"
                if isinstance(right_type, ast.FixedVectorType) and _is_scalar_numeric_type(left_type):
                    right = _emit_fused_array_scalar(node.right, idx_name, env, functions, state, typed)
                    if right is None:
                        return None
                    left = _emit_expr(node.left, env, functions, state, typed)
                    return f"({left} * {right})"
    return None


def _emit_struct_literal(node: ir.StructExpr, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    inferred = _expr_type(node, typed)
    if not isinstance(inferred, ast.TypeExpr):
        raise CppEmitError("struct literal did not infer a record type")
    return _emit_record_coercion(ir.CoerceExpr(node, inferred), env, functions, state, typed)


def _emit_collection_binary(
    node: ir.BinaryExpr,
    left: str,
    right: str,
    left_type: Any,
    right_type: Any,
    env: dict[str, Any],
    functions: dict[str, ir.FunctionDef],
    state: EmitState,
    typed: TypedModuleInfo,
) -> str | None:
    if isinstance(left_type, ast.MultisetType) or isinstance(right_type, ast.MultisetType):
        if not isinstance(left_type, ast.MultisetType) or not isinstance(right_type, ast.MultisetType):
            raise CppEmitError(f"unsupported mixed multiset expression for C++ emitter: {node.op}")
        suffix = {
            "PLUS": "union",
            "MINUS": "difference",
            "STAR": "intersection",
            "SLASH": "symdiff",
        }.get(node.op)
        if suffix is None:
            raise CppEmitError(f"unsupported multiset expression for C++ emitter: {node.op}")
        return f"vf_mset_{suffix}({left}, {right})"
    if isinstance(left_type, ast.FixedVectorType) or isinstance(right_type, ast.FixedVectorType):
        fused = _emit_fused_array_expr(node, env, functions, state, typed)
        if fused is not None:
            return fused
        if node.op == "AMPERSAND":
            return f"vf_array_cat({left}, {right})"
        if node.op in ("PLUS", "MINUS", "STAR", "SLASH"):
            if isinstance(left_type, ast.FixedVectorType) and isinstance(right_type, ast.FixedVectorType):
                suffix = {
                    "PLUS": "add",
                    "MINUS": "sub",
                    "STAR": "mul",
                    "SLASH": "div",
                }[node.op]
                return f"vf_array_{suffix}({left}, {right})"
            if node.op == "STAR":
                if isinstance(left_type, ast.FixedVectorType):
                    return f"vf_array_scale({left}, {right})"
                if isinstance(right_type, ast.FixedVectorType):
                    return f"vf_array_scale({right}, {left})"
        raise CppEmitError(f"unsupported vector expression for C++ emitter: {node.op}")
    dyn = _emit_dynamic_collection_binary(node, left, right, left_type, right_type)
    if dyn is not None:
        return dyn
    if isinstance(left_type, ast.LinkedListValueType) or isinstance(right_type, ast.LinkedListValueType):
        raise CppEmitError(f"unsupported linked-list expression for C++ emitter: {node.op}")
    return None


def _emit_expr(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    if isinstance(node, ir.Const):
        return _emit_const(node.value)
    if isinstance(node, ir.LoadName):
        return _cpp_name(node.name, state)
    if isinstance(node, ir.LoadSlot):
        return _cpp_name(node.name, state)
    if isinstance(node, ir.CoerceExpr):
        inner = _emit_expr(node.expr, env, functions, state, typed)
        t = _normalize_type(node.target_type)
        if isinstance(t, ast.FixedVectorType):
            return _emit_vector_coercion(node, env, functions, state, typed)
        if isinstance(t, ast.MultisetType):
            return _emit_multiset_coercion(node, env, functions, state, typed)
        if isinstance(t, ast.MapValueType):
            return _emit_map_coercion(node, env, functions, state, typed)
        if isinstance(t, ast.LinkedListValueType):
            return _emit_linked_list_coercion(node, env, functions, state, typed)
        if isinstance(t, ast.TypeExpr):
            if isinstance(node.expr, ir.StructExpr):
                return _emit_record_coercion(node, env, functions, state, typed)
            return inner
        if not isinstance(t, ast.PrimTypeRef):
            raise CppEmitError("only primitive coercions are supported in C++ emission")
        if t.name == "num":
            return f"vf_to_num({inner})"
        if t.name == "int":
            return f"vf_to_int({inner})"
        if t.name == "bool":
            return f"vf_to_bool({inner})"
        if t.name == "str":
            return f"vf_to_str({inner})"
        raise CppEmitError(f"unsupported coercion target {t.name}")
    if isinstance(node, ir.ListExpr):
        return _emit_list_literal(node, env, functions, state, typed)
    if isinstance(node, ir.MapExpr):
        return _emit_map_literal(node, env, functions, state, typed)
    if isinstance(node, ir.LinkedListExpr):
        return _emit_linked_list_literal(node, env, functions, state, typed)
    if isinstance(node, ir.MultisetExpr):
        return _emit_multiset_literal(node, env, functions, state, typed)
    if isinstance(node, ir.StructExpr):
        return _emit_struct_literal(node, env, functions, state, typed)
    if isinstance(node, ir.AttrExpr):
        base_type = _normalize_type(_expr_type(node.value, typed))
        if isinstance(base_type, ast.MapValueType):
            return _emit_map_attr_access(node, env, functions, state, typed)
        base_expr = _emit_expr(node.value, env, functions, state, typed)
        return f"{base_expr}.{node.name}"
    if isinstance(node, ir.IndexExpr):
        base_type = _normalize_type(_expr_type(node.value, typed))
        if not isinstance(base_type, ast.FixedVectorType):
            raise CppEmitError("index access currently requires a fixed-vector type in C++ emission")
        expr = _emit_expr(node.value, env, functions, state, typed)
        current_t = base_type
        for idx in node.indices:
            idx_expr = _emit_expr(idx, env, functions, state, typed)
            expr = f"{expr}[static_cast<std::size_t>({idx_expr})]"
            current_t = _normalize_type(current_t.element_type) if isinstance(current_t, ast.FixedVectorType) else current_t
        return expr
    if isinstance(node, ir.UnaryExpr):
        inner = _emit_expr(node.operand, env, functions, state, typed)
        if node.op == "MINUS":
            return f"(-{inner})"
        if node.op == "NOT":
            return f"(!{inner})"
        raise CppEmitError(f"unsupported unary op {node.op}")
    if isinstance(node, ir.BinaryExpr):
        left = _emit_expr(node.left, env, functions, state, typed)
        right = _emit_expr(node.right, env, functions, state, typed)
        left_type = _expr_type(node.left, typed)
        right_type = _expr_type(node.right, typed)
        coll = _emit_collection_binary(node, left, right, left_type, right_type, env, functions, state, typed)
        if coll is not None:
            return coll
        if node.op == "CARET":
            return f"std::pow({left}, {right})"
        op_map = {
            "PLUS": "+",
            "MINUS": "-",
            "STAR": "*",
            "SLASH": "/",
            "PERCENT": "%",
            "EQ": "==",
            "NEQ": "!=",
            "LT": "<",
            "LE": "<=",
            "GT": ">",
            "GE": ">=",
            "AND": "&&",
            "OR": "||",
        }
        if node.op == "XOR":
            return f"(static_cast<bool>({left}) != static_cast<bool>({right}))"
        if node.op == "AMPERSAND":
            return f"({left} + {right})"
        if node.op not in op_map:
            raise CppEmitError(f"unsupported binary op {node.op}")
        return f"({left} {op_map[node.op]} {right})"
    if isinstance(node, ir.CallExpr):
        if not isinstance(node.func, ir.LoadName):
            raise CppEmitError("only direct named calls are supported in C++ emission")
        fname = _cpp_name(node.func.name, state) if node.func.name not in functions and node.func.name not in {"int", "num", "bool", "str"} else node.func.name
        args = ", ".join(_emit_expr(a, env, functions, state, typed) for a in node.args)
        if fname == "int":
            return f"vf_to_int({args})"
        if fname == "num":
            return f"vf_to_num({args})"
        if fname == "bool":
            return f"vf_to_bool({args})"
        if fname == "str":
            return f"vf_to_str({args})"
        return f"{fname}({args})"
    raise CppEmitError(f"unsupported expression emission for {type(node).__name__}")


def _emit_print(expr: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState, typed: TypedModuleInfo) -> str:
    t = _expr_type(expr, typed)
    code = _emit_expr(expr, env, functions, state, typed)
    if isinstance(t, (ast.FixedVectorType, ast.TypeExpr, ast.MultisetType, ast.MapValueType, ast.LinkedListValueType)):
        return f"std::cout << vf_format_value({code}) << \"\\n\";"
    if not isinstance(t, ast.PrimTypeRef):
        raise CppEmitError("only primitive print values are supported in C++ emission")
    if t.name == "bool":
        return f'std::cout << ({code} ? "true" : "false") << "\\n";'
    if t.name == "int":
        return f"std::cout << {code} << \"\\n\";"
    if t.name == "num":
        return f"std::cout << vf_format_num({code}) << \"\\n\";"
    if t.name == "str":
        return f"std::cout << {code} << \"\\n\";"
    raise CppEmitError(f"unsupported print type {t.name}")


def _emit_stmt(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], indent: str, state: EmitState, typed: TypedModuleInfo) -> tuple[list[str], dict[str, Any]]:
    lines: list[str] = []
    env = dict(env)
    if isinstance(node, ir.StoreName):
        expr_type = _expr_type(node.value, typed)
        declared = _normalize_type(node.declared_type) if node.declared_type is not None else None
        final_type = declared if declared is not None else expr_type
        cpp_name = _cpp_name(node.name, state)
        if node.name in env:
            lines.append(f"{indent}{cpp_name} = {_emit_expr(node.value, env, functions, state, typed)};")
        else:
            lines.append(f"{indent}{_cpp_type(final_type, state)} {cpp_name} = {_emit_expr(node.value, env, functions, state, typed)};")
        env[node.name] = final_type
        return lines, env
    if isinstance(node, ir.StoreSlot):
        expr_type = _expr_type(node.value, typed)
        declared = _normalize_type(node.declared_type) if node.declared_type is not None else None
        final_type = declared if declared is not None else expr_type
        cpp_name = _cpp_name(node.name, state)
        if node.name in env:
            lines.append(f"{indent}{cpp_name} = {_emit_expr(node.value, env, functions, state, typed)};")
        else:
            lines.append(f"{indent}{_cpp_type(final_type, state)} {cpp_name} = {_emit_expr(node.value, env, functions, state, typed)};")
        env[node.name] = final_type
        return lines, env
    if isinstance(node, ir.PrintStmt):
        lines.append(indent + _emit_print(node.value, env, functions, state, typed))
        return lines, env
    if isinstance(node, ir.ExprStmt):
        lines.append(f"{indent}{_emit_expr(node.expr, env, functions, state, typed)};")
        return lines, env
    if isinstance(node, ir.IfStmt):
        cond = _emit_expr(node.condition, env, functions, state, typed)
        lines.append(f"{indent}if ({cond}) {{")
        body_lines, _ = _emit_block(node.body, env, functions, indent + "    ", function_mode=False, state=state, typed=typed)
        lines.extend(body_lines)
        lines.append(f"{indent}}}")
        return lines, env
    if isinstance(node, ir.WhileStmt):
        cond = _emit_expr(node.condition, env, functions, state, typed)
        lines.append(f"{indent}while ({cond}) {{")
        body_lines, _ = _emit_block(node.body, env, functions, indent + "    ", function_mode=False, state=state, typed=typed)
        lines.extend(body_lines)
        lines.append(f"{indent}}}")
        return lines, env
    if isinstance(node, ir.MatchStmt):
        if node.loop:
            lines.append(f"{indent}while (true) {{")
            inner_lines = _emit_match_body(node, env, functions, indent + "    ", state, typed)
            lines.extend(inner_lines)
            lines.append(f"{indent}}}")
            return lines, env
        lines.extend(_emit_match_body(node, env, functions, indent, state, typed))
        return lines, env
    if isinstance(node, ir.ContinueStmt):
        lines.append(f"{indent}continue;")
        return lines, env
    if isinstance(node, ir.BreakStmt):
        lines.append(f"{indent}break;")
        return lines, env
    if isinstance(node, ir.ReturnStmt):
        if node.value is None:
            lines.append(f"{indent}return;")
        else:
            lines.append(f"{indent}return {_emit_expr(node.value, env, functions, state, typed)};")
        return lines, env
    raise CppEmitError(f"unsupported statement emission for {type(node).__name__}")


def _emit_block(block: ir.Block, env: dict[str, Any], functions: dict[str, ir.FunctionDef], indent: str, *, function_mode: bool, state: EmitState, typed: TypedModuleInfo) -> tuple[list[str], dict[str, Any]]:
    lines: list[str] = []
    cur_env = dict(env)
    for idx, stmt in enumerate(block.statements):
        if function_mode and idx == len(block.statements) - 1 and isinstance(stmt, ir.ExprStmt):
            lines.append(f"{indent}return {_emit_expr(stmt.expr, cur_env, functions, state, typed)};")
            continue
        emitted, cur_env = _emit_stmt(stmt, cur_env, functions, indent, state, typed)
        lines.extend(emitted)
    return lines, cur_env


def _emit_match_body(node: ir.MatchStmt, env: dict[str, Any], functions: dict[str, ir.FunctionDef], indent: str, state: EmitState, typed: TypedModuleInfo) -> list[str]:
    lines: list[str] = []
    disc_name = f"vf_match_{abs(hash((id(node), indent))) & 0xFFFFFFFF:08x}"
    lines.append(f"{indent}auto {disc_name} = {_emit_expr(node.discriminant, env, functions, state, typed)};")
    best_name = f"{disc_name}_best"
    chosen_name = f"{disc_name}_chosen"
    default_name = f"{disc_name}_default"
    lines.append(f"{indent}int {best_name} = -1;")
    lines.append(f"{indent}int {chosen_name} = -1;")
    lines.append(f"{indent}int {default_name} = -1;")
    for idx, arm in enumerate(node.arms):
        if arm.condition is None:
            lines.append(f"{indent}{default_name} = {idx};")
            continue
        cond_name = f"{disc_name}_arm_{idx}"
        cond_expr = _emit_expr(arm.condition, env, functions, state, typed)
        cond_type = _expr_type(arm.condition, typed)
        lines.append(f"{indent}{_cpp_type(cond_type, state)} {cond_name} = {cond_expr};")
        lines.append(f"{indent}{{")
        lines.append(f"{indent}    int vf_spec = vf_match_specificity({disc_name}, {cond_name});")
        lines.append(f"{indent}    if (vf_spec < 0) vf_spec = vf_match_specificity({cond_name}, {disc_name});")
        lines.append(f"{indent}    if (vf_spec > {best_name}) {{")
        lines.append(f"{indent}        {best_name} = vf_spec;")
        lines.append(f"{indent}        {chosen_name} = {idx};")
        lines.append(f"{indent}    }}")
        lines.append(f"{indent}}}")
    lines.append(f"{indent}if ({chosen_name} < 0) {chosen_name} = {default_name};")
    if node.loop:
        lines.append(f"{indent}if ({chosen_name} < 0) break;")
    first = True
    for idx, arm in enumerate(node.arms):
        kw = "if" if first else "else if"
        lines.append(f"{indent}{kw} ({chosen_name} == {idx}) {{")
        body_lines, _ = _emit_block(arm.body, env, functions, indent + "    ", function_mode=False, state=state, typed=typed)
        lines.extend(body_lines)
        lines.append(f"{indent}}}")
        first = False
    return lines


def _collect_types_from_expr(node: Any, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState) -> Any:
    t = _infer_expr_type(node, env, functions)
    _register_type(t, state)
    if isinstance(node, ir.CoerceExpr):
        _register_type(node.target_type, state)
        _collect_types_from_expr(node.expr, env, functions, state)
    elif isinstance(node, ir.CallExpr):
        for arg in node.args:
            _collect_types_from_expr(arg, env, functions, state)
    elif isinstance(node, ir.ListExpr):
        for elem in node.elements:
            _collect_types_from_expr(elem, env, functions, state)
    elif isinstance(node, ir.MapExpr):
        for _, value in node.fields:
            _collect_types_from_expr(value, env, functions, state)
    elif isinstance(node, ir.LinkedListExpr):
        for elem in node.elements:
            _collect_types_from_expr(elem, env, functions, state)
        if node.spread is not None:
            _collect_types_from_expr(node.spread, env, functions, state)
    elif isinstance(node, ir.MultisetExpr):
        for value, count in node.pairs:
            _collect_types_from_expr(value, env, functions, state)
            _collect_types_from_expr(count, env, functions, state)
    elif isinstance(node, ir.StructExpr):
        for _, value in node.fields:
            _collect_types_from_expr(value, env, functions, state)
    elif isinstance(node, ir.AttrExpr):
        _collect_types_from_expr(node.value, env, functions, state)
    elif isinstance(node, ir.IndexExpr):
        _collect_types_from_expr(node.value, env, functions, state)
        for idx in node.indices:
            _collect_types_from_expr(idx, env, functions, state)
    elif isinstance(node, ir.UnaryExpr):
        _collect_types_from_expr(node.operand, env, functions, state)
    elif isinstance(node, ir.BinaryExpr):
        _collect_types_from_expr(node.left, env, functions, state)
        _collect_types_from_expr(node.right, env, functions, state)
    return t


def _collect_types_from_block(block: ir.Block, env: dict[str, Any], functions: dict[str, ir.FunctionDef], state: EmitState) -> dict[str, Any]:
    cur_env = dict(env)
    for stmt in block.statements:
        if isinstance(stmt, ir.StoreName):
            expr_t = _collect_types_from_expr(stmt.value, cur_env, functions, state)
            final_t = _normalize_type(stmt.declared_type) if stmt.declared_type is not None else expr_t
            _register_type(final_t, state)
            cur_env[stmt.name] = final_t
        elif isinstance(stmt, ir.PrintStmt):
            _collect_types_from_expr(stmt.value, cur_env, functions, state)
        elif isinstance(stmt, ir.ExprStmt):
            _collect_types_from_expr(stmt.expr, cur_env, functions, state)
        elif isinstance(stmt, ir.IfStmt):
            _collect_types_from_expr(stmt.condition, cur_env, functions, state)
            _collect_types_from_block(stmt.body, cur_env, functions, state)
        elif isinstance(stmt, ir.WhileStmt):
            _collect_types_from_expr(stmt.condition, cur_env, functions, state)
            _collect_types_from_block(stmt.body, cur_env, functions, state)
        elif isinstance(stmt, ir.MatchStmt):
            _collect_types_from_expr(stmt.discriminant, cur_env, functions, state)
            for arm in stmt.arms:
                if arm.condition is not None:
                    _collect_types_from_expr(arm.condition, cur_env, functions, state)
                _collect_types_from_block(arm.body, cur_env, functions, state)
        elif isinstance(stmt, ir.ReturnStmt) and stmt.value is not None:
            _collect_types_from_expr(stmt.value, cur_env, functions, state)
    return cur_env


def _emit_struct_def(name: str, type_expr: ast.TypeExpr, state: EmitState) -> list[str]:
    lines = [f"struct {name} {{"]
    for fname, ftype in type_expr.fields:
        lines.append(f"    {_cpp_type(ftype, state)} {fname};")
    lines.append("};")
    lines.append(f"static std::string vf_format_value(const {name}& v) {{")
    lines.append("    std::ostringstream oss;")
    lines.append('    oss << "(";')
    for idx, (fname, _) in enumerate(type_expr.fields):
        prefix = '    ' if idx == 0 else '    '
        if idx > 0:
            lines.append('    oss << ", ";')
        lines.append(f'    oss << "{fname}:" << vf_format_value(v.{fname});')
    lines.append('    oss << ")";')
    lines.append("    return oss.str();")
    lines.append("}")
    lines.append("")
    return lines


def _emit_struct_defs_in_order(state: EmitState) -> list[str]:
    out: list[str] = []
    emitted: set[str] = set()

    def visit_type(t: Any) -> None:
        t = _normalize_type(t)
        if isinstance(t, ast.TypeExpr):
            name = _struct_name(t)
            if name in emitted:
                return
            for _, inner in t.fields:
                visit_type(inner)
            out.extend(_emit_struct_def(name, t, state))
            emitted.add(name)
            return
        if isinstance(t, ast.FixedVectorType):
            visit_type(t.element_type)
            return
        if isinstance(t, ast.MultisetType):
            visit_type(t.element_type)
            return
        if isinstance(t, ast.MapValueType):
            for _, inner in t.fields:
                visit_type(inner)
            return
        if isinstance(t, ast.LinkedListValueType):
            for inner in t.elements:
                visit_type(inner)
            return
        if isinstance(t, ast.TupleTypeExpr):
            for inner in t.elements:
                visit_type(inner)
            return

    for name in list(state.struct_defs):
        visit_type(state.struct_defs[name])
    return out


def emit_cpp_module(module: ir.Module) -> str:
    prepared = _prepare_native_module(module)
    module = prepared.module
    typed = prepared.typed
    features = _collect_runtime_features(module, typed)
    state = EmitState()
    functions = prepared.functions
    for typ in typed.expr_types.values():
        _register_type(typ, state)
    for fn in module.statements:
        if not isinstance(fn, ir.FunctionDef):
            continue
        for ptype in fn.param_types:
            if ptype is not None:
                _register_type(ptype, state)
        if fn.return_type is not None:
            _register_type(fn.return_type, state)
    headers = _emit_runtime_headers(features) + _emit_runtime_support(features)
    struct_lines = _emit_struct_defs_in_order(state)
    fn_lines: list[str] = []
    for fn in module.statements:
        if not isinstance(fn, ir.FunctionDef):
            continue
        if fn.return_type is None:
            raise CppEmitError(f"function {fn.name} needs an explicit return type for C++ emission")
        size_vars: set[str] = set()
        for ptype in fn.param_types:
            if ptype is not None:
                _collect_size_vars(ptype, size_vars)
        _collect_size_vars(fn.return_type, size_vars)
        if size_vars:
            fn_lines.append(
                "template <" + ", ".join(f"std::size_t {name}" for name in sorted(size_vars)) + ">"
            )
        ret_cpp = _cpp_type(fn.return_type, state)
        param_bits: list[str] = []
        local_env: dict[str, Any] = {}
        for name, ptype in zip(fn.params, fn.param_types):
            if ptype is None:
                raise CppEmitError(f"function {fn.name} parameter {name} needs an explicit type for C++ emission")
            cpp_t = _cpp_type(ptype, state)
            param_bits.append(f"{cpp_t} {name}")
            local_env[name] = _normalize_type(ptype)
        old_name_map = state.current_name_map
        fn_name_map: dict[str, str] = {name: name for name in fn.params}
        for name, slot in typed.function_slots.get(fn.name, {}).items():
            if name in fn_name_map:
                continue
            fn_name_map[name] = f"vf_s{slot}_{name}"
        state.current_name_map = fn_name_map
        fn_lines.append(f"{ret_cpp} {fn.name}({', '.join(param_bits)}) {{")
        body_lines, _ = _emit_block(fn.body, local_env, functions, "    ", function_mode=True, state=state, typed=typed)
        fn_lines.extend(body_lines)
        fn_lines.append("}")
        fn_lines.append("")
        state.current_name_map = old_name_map
    main_lines = ["int main() {"] 
    env: dict[str, Any] = {}
    for stmt in module.statements:
        if isinstance(stmt, ir.FunctionDef):
            continue
        emitted, env = _emit_stmt(stmt, env, functions, "    ", state, typed)
        main_lines.extend(emitted)
    main_lines.append("    return 0;")
    main_lines.append("}")
    return "\n".join(headers + struct_lines + fn_lines + main_lines) + "\n"


def emit_cpp_from_source_file(path: Path) -> str:
    from .parser import parse_module
    from .ir import lower_module

    mod = parse_module(path.read_text(encoding="utf-8"), filename=str(path))
    lowered = lower_module(mod)
    return emit_cpp_module(lowered)


def compile_and_run_module(module: ir.Module) -> subprocess.CompletedProcess[str]:
    source = emit_cpp_module(module)
    with tempfile.TemporaryDirectory(prefix="vf_cpp_") as td:
        exe = compile_cpp_source(source, Path(td))
        return run_cpp_executable(exe)
