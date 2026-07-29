from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]


def _compiler() -> str:
    compiler = shutil.which("g++") or shutil.which("clang++")
    if compiler is None:
        pytest.skip("a C++17 compiler is required")
    return compiler


def _compile_harness(tmp_path: Path) -> Path:
    source = tmp_path / "typed_ir_model_harness.cpp"
    executable = tmp_path / "typed_ir_model_harness.exe"
    source.write_text(
        r'''
#include "compiler/native/vkf_wasm_typed_ir.hpp"

#include <iostream>
#include <iterator>
#include <string>

int main() {
    const std::string input(
        std::istreambuf_iterator<char>(std::cin),
        std::istreambuf_iterator<char>()
    );
    try {
        const auto module = vkf::wasm::parse_typed_module(vf::parse_json(input));
        vf::JsonValue::Array aliases;
        for (const auto& alias : module.type_aliases) {
            vf::JsonValue::Object item;
            item["name"] = vf::JsonValue(alias.name);
            item["source_index"] = vf::JsonValue(static_cast<double>(alias.source_index));
            item["type_annotation"] = alias.type_annotation;
            aliases.emplace_back(std::move(item));
        }
        vf::JsonValue::Array functions;
        for (const auto& function : module.functions) {
            vf::JsonValue::Object item;
            item["name"] = vf::JsonValue(function.name);
            item["source_index"] = vf::JsonValue(static_cast<double>(function.source_index));
            item["type"] = vf::JsonValue(function.type);
            functions.emplace_back(std::move(item));
        }
        vf::JsonValue::Array bindings;
        for (const auto& binding : module.runtime_bindings) {
            vf::JsonValue::Object item;
            item["name"] = vf::JsonValue(binding.name);
            item["source_index"] = vf::JsonValue(static_cast<double>(binding.source_index));
            item["type"] = vf::JsonValue(binding.type);
            item["value"] = binding.value;
            bindings.emplace_back(std::move(item));
        }
        vf::JsonValue::Array items;
        for (const auto& item : module.items) {
            vf::JsonValue::Object encoded;
            encoded["category_index"] =
                vf::JsonValue(static_cast<double>(item.category_index));
            encoded["source_index"] =
                vf::JsonValue(static_cast<double>(item.source_index));
            encoded["kind"] = vf::JsonValue(
                item.kind == vkf::wasm::ModuleItemKind::TypeAlias ? "type_alias"
                : item.kind == vkf::wasm::ModuleItemKind::Function ? "function"
                : item.kind == vkf::wasm::ModuleItemKind::RuntimeBinding
                    ? "runtime_binding"
                    : "expression_statement"
            );
            items.emplace_back(std::move(encoded));
        }
        vf::JsonValue::Object output;
        output["type_aliases"] = vf::JsonValue(std::move(aliases));
        output["functions"] = vf::JsonValue(std::move(functions));
        output["runtime_bindings"] = vf::JsonValue(std::move(bindings));
        output["items"] = vf::JsonValue(std::move(items));
        std::cout << vf::json_stringify(vf::JsonValue(std::move(output)), -1);
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what();
        return 2;
    }
}
''',
        encoding="utf-8",
    )
    command = [
        _compiler(),
        "-std=c++17",
        "-I",
        str(REPO_ROOT),
        "-I",
        str(REPO_ROOT / "native/VfOverlay"),
        str(source),
        str(REPO_ROOT / "native/VfOverlay/vf/json.cpp"),
        "-o",
        str(executable),
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)
    return executable


@pytest.fixture(scope="module")
def typed_ir_model_harness(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return _compile_harness(tmp_path_factory.mktemp("wasm-typed-ir-model"))


def _run(executable: Path, payload: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(executable)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=False,
    )


def test_parses_ordered_typed_module_declarations(
    typed_ir_model_harness: Path,
) -> None:
    payload = {
        "kind": "typed_module",
        "body": [
            {
                "kind": "type_alias",
                "name": "Point",
                "type_annotation": {"kind": "record_type", "fields": []},
            },
            {
                "kind": "store_binding",
                "name": "origin",
                "type": "Point",
                "value": {"kind": "record", "type": "Point", "fields": []},
            },
            {
                "kind": "function",
                "name": "advance",
                "type": "fn(Point)->Point",
                "params": [],
                "body": {"kind": "block", "body": []},
            },
            {
                "kind": "type_alias",
                "name": "Path",
                "type_annotation": "list<Point>",
            },
            {
                "kind": "store_binding",
                "name": "step",
                "type": "num",
                "value": {"kind": "const", "type": "num", "value": 1},
            },
            {
                "kind": "function",
                "name": "measure",
                "type": "fn(Path)->num",
                "params": [],
                "body": {"kind": "block", "body": []},
            },
            {
                "kind": "expr_stmt",
                "expr": {"kind": "const", "type": "num", "value": 0},
            },
        ],
    }

    result = _run(typed_ir_model_harness, payload)

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "type_aliases": [
            {
                "name": "Point",
                "source_index": 0,
                "type_annotation": {"kind": "record_type", "fields": []},
            },
            {"name": "Path", "source_index": 3, "type_annotation": "list<Point>"},
        ],
        "functions": [
            {
                "name": "advance",
                "source_index": 2,
                "type": "fn(Point)->Point",
            },
            {"name": "measure", "source_index": 5, "type": "fn(Path)->num"},
        ],
        "runtime_bindings": [
            {
                "name": "origin",
                "source_index": 1,
                "type": "Point",
                "value": {"kind": "record", "type": "Point", "fields": []},
            },
            {
                "name": "step",
                "source_index": 4,
                "type": "num",
                "value": {"kind": "const", "type": "num", "value": 1},
            },
        ],
        "items": [
            {"kind": "type_alias", "category_index": 0, "source_index": 0},
            {"kind": "runtime_binding", "category_index": 0, "source_index": 1},
            {"kind": "function", "category_index": 0, "source_index": 2},
            {"kind": "type_alias", "category_index": 1, "source_index": 3},
            {"kind": "runtime_binding", "category_index": 1, "source_index": 4},
            {"kind": "function", "category_index": 1, "source_index": 5},
            {
                "kind": "expression_statement",
                "category_index": 0,
                "source_index": 6,
            },
        ],
    }


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"kind": "module", "body": []}, "expected typed_module root"),
        ({"kind": "typed_module", "body": {}}, "expected array"),
        (
            {
                "kind": "typed_module",
                "body": [{"kind": "store_binding", "name": "", "type": "num"}],
            },
            "expected non-empty string field name",
        ),
        (
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "function",
                        "name": "run",
                        "type": "fn()->num",
                    },
                    {
                        "kind": "store_binding",
                        "name": "run",
                        "type": "num",
                        "value": {"kind": "const", "type": "num", "value": 0},
                    },
                ],
            },
            "duplicate runtime name run",
        ),
        (
            {
                "kind": "typed_module",
                "body": [{"kind": "expr_stmt", "expr": {"kind": "const"}}],
            },
            "unsupported top-level typed IR declaration kind expr_stmt",
        ),
    ],
)
def test_rejects_invalid_module_shapes(
    typed_ir_model_harness: Path,
    payload: object,
    message: str,
) -> None:
    result = _run(typed_ir_model_harness, payload)

    assert result.returncode == 2
    assert message in result.stderr
