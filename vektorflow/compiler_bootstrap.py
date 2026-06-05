"""Bootstrap manifest helpers for the self-hosted compiler source set."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
from typing import Any


COMPILER_BOOTSTRAP_SCHEMA = "vektor-flow/compiler-bootstrap"
COMPILER_BOOTSTRAP_VERSION = 1
COMPILER_BOOTSTRAP_FILENAME = "vf-compiler-bootstrap.json"

_SOURCE_ORDER = (
    "compiler/self_hosted/lexer.vkf",
    "compiler/self_hosted/parser.vkf",
    "compiler/self_hosted/typed_ir.vkf",
    "compiler/self_hosted/compiler.vkf",
    "compiler/self_hosted/native_scene_compiler.vkf",
    "compiler/self_hosted/stdlib.vkf",
    "compiler/self_hosted/stdlib/math.vkf",
    "compiler/self_hosted/stdlib/io.vkf",
)


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compiler_bootstrap_sources(root: Path) -> tuple[Path, ...]:
    root_dir = Path(root).resolve()
    return tuple(root_dir / rel for rel in _SOURCE_ORDER)


def build_compiler_bootstrap_manifest(root: Path) -> dict[str, Any]:
    root_dir = Path(root).resolve()
    entries: list[dict[str, Any]] = []
    bundle_parts: list[str] = []
    for source_path in compiler_bootstrap_sources(root_dir):
        source_text = source_path.read_text(encoding="utf-8")
        rel = source_path.relative_to(root_dir).as_posix()
        source_sha256 = _sha256_text(source_text)
        entry = {
            "path": rel,
            "source_sha256": source_sha256,
            "parsed_with_native_parser": True,
        }
        entries.append(entry)
        bundle_parts.extend((rel, source_sha256))
    return {
        "schema": COMPILER_BOOTSTRAP_SCHEMA,
        "version": COMPILER_BOOTSTRAP_VERSION,
        "bootstrap_boundary": {
            "parser": "native-bootstrap",
            "scope": "self-hosted compiler source set",
            "handoff_goal": "next compiler change parsed by VKF-owned native compiler path",
        },
        "sources": entries,
        "source_order": [entry["path"] for entry in entries],
        "source_count": len(entries),
        "bundle_sha256": _sha256_text("\n".join(bundle_parts)),
    }


def write_compiler_bootstrap_manifest_text(manifest: dict[str, Any]) -> str:
    return json.dumps(manifest, indent=2) + "\n"


def write_compiler_bootstrap_manifest(root: Path, manifest: dict[str, Any]) -> Path:
    root_dir = Path(root).resolve()
    out = root_dir / "compiler" / "self_hosted" / COMPILER_BOOTSTRAP_FILENAME
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(write_compiler_bootstrap_manifest_text(manifest), encoding="utf-8")
    return out
