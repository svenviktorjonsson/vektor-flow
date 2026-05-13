from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import ast, ir
from .parser import parse_module, parse_token_stream_json


NATIVE_PROGRAM_ARTIFACT_SCHEMA = "vf-native-program-artifact"
NATIVE_PROGRAM_ARTIFACT_VERSION = 1


@dataclass(frozen=True)
class NativeProgramArtifact:
    origin: str
    module: ir.Module


def emit_native_program_artifact_from_source_file(path: Path) -> str:
    module = parse_module(path.read_text(encoding="utf-8"), filename=path.as_posix())
    lowered = ir.lower_module(module)
    return native_program_artifact_to_json(
        NativeProgramArtifact(origin=path.as_posix(), module=lowered)
    )


def emit_native_program_artifact_from_token_stream_json(
    payload: str,
    *,
    origin: str = "<token-stream>",
) -> str:
    module = parse_token_stream_json(payload)
    lowered = ir.lower_module(module)
    return native_program_artifact_to_json(
        NativeProgramArtifact(origin=origin, module=lowered)
    )


def native_program_artifact_to_json(artifact: NativeProgramArtifact) -> str:
    envelope = {
        "schema": NATIVE_PROGRAM_ARTIFACT_SCHEMA,
        "version": NATIVE_PROGRAM_ARTIFACT_VERSION,
        "origin": artifact.origin,
        "module": _ir_to_data(artifact.module),
    }
    return json.dumps(envelope, ensure_ascii=False, indent=2) + "\n"


def native_program_artifact_from_json(text: str) -> NativeProgramArtifact:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid native program artifact payload: malformed JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("invalid native program artifact payload: expected object envelope")
    if payload.get("schema") != NATIVE_PROGRAM_ARTIFACT_SCHEMA:
        raise ValueError("invalid native program artifact payload: unsupported schema")
    if payload.get("version") != NATIVE_PROGRAM_ARTIFACT_VERSION:
        raise ValueError("invalid native program artifact payload: unsupported version")
    origin = payload.get("origin")
    if not isinstance(origin, str) or not origin:
        raise ValueError("invalid native program artifact payload: missing origin")
    return NativeProgramArtifact(
        origin=origin,
        module=_ir_from_data(payload.get("module")),
    )


def _type_to_data(node: Any) -> Any:
    if node is None:
        return None
    if isinstance(node, ast.PrimTypeRef):
        return {"kind": "PrimTypeRef", "name": node.name}
    if isinstance(node, ast.NamedTypeSpec):
        return {"kind": "NamedTypeSpec", "name": node.name, "type_expr": _type_to_data(node.type_expr)}
    if isinstance(node, ast.TypeExpr):
        return {
            "kind": "TypeExpr",
            "fields": [{"name": name, "type": _type_to_data(inner)} for name, inner in node.fields],
        }
    if isinstance(node, ast.TupleTypeExpr):
        return {"kind": "TupleTypeExpr", "elements": [_type_to_data(inner) for inner in node.elements]}
    if isinstance(node, ast.TypeSizeConst):
        return {"kind": "TypeSizeConst", "value": node.value}
    if isinstance(node, ast.TypeSizeVar):
        return {"kind": "TypeSizeVar", "name": node.name}
    if isinstance(node, ast.TypeSizeBinOp):
        return {
            "kind": "TypeSizeBinOp",
            "op": node.op,
            "left": _type_to_data(node.left),
            "right": _type_to_data(node.right),
        }
    if isinstance(node, ast.FixedVectorType):
        return {
            "kind": "FixedVectorType",
            "element_type": _type_to_data(node.element_type),
            "size": _type_to_data(node.size),
        }
    if isinstance(node, ast.MultisetType):
        return {"kind": "MultisetType", "element_type": _type_to_data(node.element_type)}
    if isinstance(node, ast.MapValueType):
        return {
            "kind": "MapValueType",
            "fields": [{"name": name, "type": _type_to_data(inner)} for name, inner in node.fields],
        }
    if isinstance(node, ast.LinkedListValueType):
        return {"kind": "LinkedListValueType", "elements": [_type_to_data(inner) for inner in node.elements]}
    if isinstance(node, ast.FuncType):
        return {"kind": "FuncType", "domain": _type_to_data(node.domain), "codomain": _type_to_data(node.codomain)}
    if isinstance(node, ast.TypeUnionExpr):
        return {"kind": "TypeUnionExpr", "members": [_type_to_data(inner) for inner in node.members]}
    if isinstance(node, ast.TypeIntersectionExpr):
        return {"kind": "TypeIntersectionExpr", "members": [_type_to_data(inner) for inner in node.members]}
    raise ValueError(f"unsupported native program type node: {type(node).__name__}")


def _type_from_data(node: Any) -> Any:
    if node is None:
        return None
    if not isinstance(node, dict):
        raise ValueError("invalid native program artifact payload: type node must be object")
    kind = node.get("kind")
    if kind == "PrimTypeRef":
        return ast.PrimTypeRef(node["name"])
    if kind == "NamedTypeSpec":
        return ast.NamedTypeSpec(node["name"], _type_from_data(node["type_expr"]))
    if kind == "TypeExpr":
        return ast.TypeExpr([(field["name"], _type_from_data(field["type"])) for field in node["fields"]])
    if kind == "TupleTypeExpr":
        return ast.TupleTypeExpr([_type_from_data(inner) for inner in node["elements"]])
    if kind == "TypeSizeConst":
        return ast.TypeSizeConst(int(node["value"]))
    if kind == "TypeSizeVar":
        return ast.TypeSizeVar(node["name"])
    if kind == "TypeSizeBinOp":
        return ast.TypeSizeBinOp(node["op"], _type_from_data(node["left"]), _type_from_data(node["right"]))
    if kind == "FixedVectorType":
        return ast.FixedVectorType(_type_from_data(node["element_type"]), _type_from_data(node["size"]))
    if kind == "MultisetType":
        return ast.MultisetType(_type_from_data(node["element_type"]))
    if kind == "MapValueType":
        return ast.MapValueType([(field["name"], _type_from_data(field["type"])) for field in node["fields"]])
    if kind == "LinkedListValueType":
        return ast.LinkedListValueType([_type_from_data(inner) for inner in node["elements"]])
    if kind == "FuncType":
        return ast.FuncType(_type_from_data(node["domain"]), _type_from_data(node["codomain"]))
    if kind == "TypeUnionExpr":
        return ast.TypeUnionExpr([_type_from_data(inner) for inner in node["members"]])
    if kind == "TypeIntersectionExpr":
        return ast.TypeIntersectionExpr([_type_from_data(inner) for inner in node["members"]])
    raise ValueError(f"invalid native program artifact payload: unknown type kind {kind!r}")


def _ir_to_data(node: Any) -> Any:
    if isinstance(node, ir.Module):
        return {"kind": "Module", "statements": [_ir_to_data(stmt) for stmt in node.statements]}
    if isinstance(node, ir.Block):
        return {"kind": "Block", "statements": [_ir_to_data(stmt) for stmt in node.statements]}
    if isinstance(node, ir.Const):
        return {"kind": "Const", "value": node.value}
    if isinstance(node, ir.LoadName):
        return {"kind": "LoadName", "name": node.name}
    if isinstance(node, ir.LoadSlot):
        return {"kind": "LoadSlot", "slot": node.slot, "name": node.name}
    if isinstance(node, ir.UnaryExpr):
        return {"kind": "UnaryExpr", "op": node.op, "operand": _ir_to_data(node.operand)}
    if isinstance(node, ir.BinaryExpr):
        return {
            "kind": "BinaryExpr",
            "op": node.op,
            "left": _ir_to_data(node.left),
            "right": _ir_to_data(node.right),
        }
    if isinstance(node, ir.ExprStmt):
        return {"kind": "ExprStmt", "expr": _ir_to_data(node.expr)}
    if isinstance(node, ir.CallExpr):
        return {"kind": "CallExpr", "func": _ir_to_data(node.func), "args": [_ir_to_data(arg) for arg in node.args]}
    if isinstance(node, ir.ListExpr):
        return {"kind": "ListExpr", "elements": [_ir_to_data(elem) for elem in node.elements]}
    if isinstance(node, ir.MultisetExpr):
        return {
            "kind": "MultisetExpr",
            "pairs": [{"value": _ir_to_data(value), "count": _ir_to_data(count)} for value, count in node.pairs],
        }
    if isinstance(node, ir.MapExpr):
        return {
            "kind": "MapExpr",
            "fields": [{"name": name, "value": _ir_to_data(value)} for name, value in node.fields],
        }
    if isinstance(node, ir.LinkedListExpr):
        return {
            "kind": "LinkedListExpr",
            "elements": [_ir_to_data(elem) for elem in node.elements],
            "spread": _ir_to_data(node.spread) if node.spread is not None else None,
        }
    if isinstance(node, ir.StructExpr):
        return {
            "kind": "StructExpr",
            "fields": [{"name": name, "value": _ir_to_data(value)} for name, value in node.fields],
        }
    if isinstance(node, ir.AttrExpr):
        return {"kind": "AttrExpr", "value": _ir_to_data(node.value), "name": node.name}
    if isinstance(node, ir.IndexExpr):
        return {"kind": "IndexExpr", "value": _ir_to_data(node.value), "indices": [_ir_to_data(idx) for idx in node.indices]}
    if isinstance(node, ir.MatchArm):
        return {
            "kind": "MatchArm",
            "condition": _ir_to_data(node.condition) if node.condition is not None else None,
            "body": _ir_to_data(node.body),
        }
    if isinstance(node, ir.CoerceExpr):
        return {"kind": "CoerceExpr", "expr": _ir_to_data(node.expr), "target_type": _type_to_data(node.target_type)}
    if isinstance(node, ir.StoreName):
        return {
            "kind": "StoreName",
            "name": node.name,
            "value": _ir_to_data(node.value),
            "declared_type": _type_to_data(node.declared_type),
        }
    if isinstance(node, ir.StoreSlot):
        return {
            "kind": "StoreSlot",
            "slot": node.slot,
            "name": node.name,
            "value": _ir_to_data(node.value),
            "declared_type": _type_to_data(node.declared_type),
        }
    if isinstance(node, ir.PrintStmt):
        return {"kind": "PrintStmt", "value": _ir_to_data(node.value)}
    if isinstance(node, ir.FunctionDef):
        return {
            "kind": "FunctionDef",
            "name": node.name,
            "params": list(node.params),
            "body": _ir_to_data(node.body),
            "param_types": [_type_to_data(inner) for inner in node.param_types],
            "return_type": _type_to_data(node.return_type),
        }
    if isinstance(node, ir.IfStmt):
        return {"kind": "IfStmt", "condition": _ir_to_data(node.condition), "body": _ir_to_data(node.body)}
    if isinstance(node, ir.WhileStmt):
        return {"kind": "WhileStmt", "condition": _ir_to_data(node.condition), "body": _ir_to_data(node.body)}
    if isinstance(node, ir.MatchStmt):
        return {
            "kind": "MatchStmt",
            "discriminant": _ir_to_data(node.discriminant),
            "arms": [_ir_to_data(arm) for arm in node.arms],
            "loop": node.loop,
        }
    if isinstance(node, ir.ContinueStmt):
        return {"kind": "ContinueStmt"}
    if isinstance(node, ir.BreakStmt):
        return {"kind": "BreakStmt"}
    if isinstance(node, ir.ReturnStmt):
        return {"kind": "ReturnStmt", "value": _ir_to_data(node.value) if node.value is not None else None}
    if isinstance(node, ir.TypeDef):
        return {"kind": "TypeDef", "name": node.name, "type_expr": _type_to_data(node.type_expr)}
    raise ValueError(f"unsupported native program IR node: {type(node).__name__}")


def _ir_from_data(node: Any) -> Any:
    if not isinstance(node, dict):
        raise ValueError("invalid native program artifact payload: IR node must be object")
    kind = node.get("kind")
    if kind == "Module":
        return ir.Module([_ir_from_data(stmt) for stmt in node["statements"]])
    if kind == "Block":
        return ir.Block([_ir_from_data(stmt) for stmt in node["statements"]])
    if kind == "Const":
        return ir.Const(node.get("value"))
    if kind == "LoadName":
        return ir.LoadName(node["name"])
    if kind == "LoadSlot":
        return ir.LoadSlot(int(node["slot"]), node["name"])
    if kind == "UnaryExpr":
        return ir.UnaryExpr(node["op"], _ir_from_data(node["operand"]))
    if kind == "BinaryExpr":
        return ir.BinaryExpr(node["op"], _ir_from_data(node["left"]), _ir_from_data(node["right"]))
    if kind == "ExprStmt":
        return ir.ExprStmt(_ir_from_data(node["expr"]))
    if kind == "CallExpr":
        return ir.CallExpr(_ir_from_data(node["func"]), [_ir_from_data(arg) for arg in node["args"]])
    if kind == "ListExpr":
        return ir.ListExpr([_ir_from_data(elem) for elem in node["elements"]])
    if kind == "MultisetExpr":
        return ir.MultisetExpr([(_ir_from_data(pair["value"]), _ir_from_data(pair["count"])) for pair in node["pairs"]])
    if kind == "MapExpr":
        return ir.MapExpr([(field["name"], _ir_from_data(field["value"])) for field in node["fields"]])
    if kind == "LinkedListExpr":
        spread = node.get("spread")
        return ir.LinkedListExpr(
            [_ir_from_data(elem) for elem in node["elements"]],
            _ir_from_data(spread) if spread is not None else None,
        )
    if kind == "StructExpr":
        return ir.StructExpr([(field["name"], _ir_from_data(field["value"])) for field in node["fields"]])
    if kind == "AttrExpr":
        return ir.AttrExpr(_ir_from_data(node["value"]), node["name"])
    if kind == "IndexExpr":
        return ir.IndexExpr(_ir_from_data(node["value"]), [_ir_from_data(idx) for idx in node["indices"]])
    if kind == "MatchArm":
        condition = node.get("condition")
        return ir.MatchArm(_ir_from_data(condition) if condition is not None else None, _ir_from_data(node["body"]))
    if kind == "CoerceExpr":
        return ir.CoerceExpr(_ir_from_data(node["expr"]), _type_from_data(node["target_type"]))
    if kind == "StoreName":
        return ir.StoreName(node["name"], _ir_from_data(node["value"]), _type_from_data(node.get("declared_type")))
    if kind == "StoreSlot":
        return ir.StoreSlot(int(node["slot"]), node["name"], _ir_from_data(node["value"]), _type_from_data(node.get("declared_type")))
    if kind == "PrintStmt":
        return ir.PrintStmt(_ir_from_data(node["value"]))
    if kind == "FunctionDef":
        return ir.FunctionDef(
            node["name"],
            list(node["params"]),
            _ir_from_data(node["body"]),
            param_types=[_type_from_data(inner) for inner in node["param_types"]],
            return_type=_type_from_data(node.get("return_type")),
        )
    if kind == "IfStmt":
        return ir.IfStmt(_ir_from_data(node["condition"]), _ir_from_data(node["body"]))
    if kind == "WhileStmt":
        return ir.WhileStmt(_ir_from_data(node["condition"]), _ir_from_data(node["body"]))
    if kind == "MatchStmt":
        return ir.MatchStmt(_ir_from_data(node["discriminant"]), [_ir_from_data(arm) for arm in node["arms"]], loop=bool(node.get("loop", False)))
    if kind == "ContinueStmt":
        return ir.ContinueStmt()
    if kind == "BreakStmt":
        return ir.BreakStmt()
    if kind == "ReturnStmt":
        value = node.get("value")
        return ir.ReturnStmt(_ir_from_data(value) if value is not None else None)
    if kind == "TypeDef":
        return ir.TypeDef(node["name"], _type_from_data(node["type_expr"]))
    raise ValueError(f"invalid native program artifact payload: unknown IR kind {kind!r}")
