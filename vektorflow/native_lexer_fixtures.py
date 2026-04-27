"""Helpers for maintaining versioned token-stream sample fixtures.

These fixtures are part of the foreign-lexer contract: a non-Python lexer can
target the same versioned payload shape and verify itself against real VKF
examples without needing parser or CLI changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

from .native_lexer_proto import write_fixture_for_source


@dataclass(frozen=True)
class TokenFixtureSpec:
    source_rel: str
    fixture_name: str


TOKEN_FIXTURE_SPECS: tuple[TokenFixtureSpec, ...] = (
    TokenFixtureSpec(
        source_rel="examples/native_core/hello_native.vkf",
        fixture_name="hello_native_versioned.json",
    ),
    TokenFixtureSpec(
        source_rel="examples/native_core/vectors_native.vkf",
        fixture_name="vectors_native_versioned.json",
    ),
    TokenFixtureSpec(
        source_rel="examples/native_core/numeric_native.vkf",
        fixture_name="numeric_native_versioned.json",
    ),
)


def default_repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def default_fixture_root(repo_root: Path | None = None) -> Path:
    root = default_repo_root() if repo_root is None else repo_root
    return root / "tests" / "fixtures" / "token_stream"


def iter_fixture_specs(specs: Sequence[TokenFixtureSpec] | None = None) -> Iterable[TokenFixtureSpec]:
    return TOKEN_FIXTURE_SPECS if specs is None else specs


def regenerate_token_fixtures(
    *,
    repo_root: Path | None = None,
    fixture_root: Path | None = None,
    specs: Sequence[TokenFixtureSpec] | None = None,
) -> list[Path]:
    root = default_repo_root() if repo_root is None else repo_root
    out_root = default_fixture_root(root) if fixture_root is None else fixture_root
    out_root.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    for spec in iter_fixture_specs(specs):
        source = root / spec.source_rel
        out = out_root / spec.fixture_name
        write_fixture_for_source(source, out, root=root)
        written.append(out)
    return written

