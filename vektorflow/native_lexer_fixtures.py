"""Helpers for maintaining versioned token-stream sample fixtures.

These fixtures are part of the foreign-lexer contract: a non-Python lexer can
target the same versioned payload shape and verify itself against real VKF
examples without needing parser or CLI changes.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from typing import Iterable, Sequence
import sys

from .native_lexer_proto import lex_file_to_payload, write_fixture_for_source


@dataclass(frozen=True)
class TokenFixtureSpec:
    source_rel: str
    fixture_name: str


@dataclass(frozen=True)
class TokenFixtureStatus:
    source_rel: str
    fixture_name: str
    fixture_path: str
    source_exists: bool
    fixture_exists: bool
    expected_source_label: str
    declared_source_label: str | None
    source_label_matches: bool
    token_count: int
    payload_sha256: str | None
    status: str


TOKEN_FIXTURE_REPORT_SCHEMA = "vektorflow.token_fixture_report"
TOKEN_FIXTURE_REPORT_VERSION = 1


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


def discovered_fixture_names(fixture_root: Path) -> list[str]:
    return sorted(path.name for path in fixture_root.glob("*.json"))


def declared_fixture_names(specs: Sequence[TokenFixtureSpec] | None = None) -> set[str]:
    return {spec.fixture_name for spec in iter_fixture_specs(specs)}


def unmanaged_fixture_names(
    *,
    fixture_root: Path,
    specs: Sequence[TokenFixtureSpec] | None = None,
) -> list[str]:
    declared = declared_fixture_names(specs)
    return [name for name in discovered_fixture_names(fixture_root) if name not in declared]


def canonical_fixture_text(spec: TokenFixtureSpec, *, repo_root: Path | None = None) -> str:
    root = default_repo_root() if repo_root is None else repo_root
    payload = lex_file_to_payload(root / spec.source_rel, root=root)
    return token_stream_to_json_payload(payload)


def token_stream_to_json_payload(payload: dict[str, object]) -> str:
    return json.dumps(payload, indent=2)


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _read_fixture_payload(path: Path) -> dict[str, object] | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _declared_source_label(payload: dict[str, object]) -> str | None:
    tokens = payload.get("tokens")
    if not isinstance(tokens, list) or not tokens:
        return None
    first = tokens[0]
    if not isinstance(first, dict):
        return None
    location = first.get("location")
    if not isinstance(location, dict):
        return None
    label = location.get("file")
    return label if isinstance(label, str) and label else None


def _payload_token_count(payload: dict[str, object]) -> int:
    tokens = payload.get("tokens")
    return len(tokens) if isinstance(tokens, list) else 0


def fixture_status_report(
    *,
    repo_root: Path | None = None,
    fixture_root: Path | None = None,
    specs: Sequence[TokenFixtureSpec] | None = None,
) -> list[TokenFixtureStatus]:
    root = default_repo_root() if repo_root is None else repo_root
    out_root = default_fixture_root(root) if fixture_root is None else fixture_root
    statuses: list[TokenFixtureStatus] = []
    for spec in iter_fixture_specs(specs):
        source = root / spec.source_rel
        fixture = out_root / spec.fixture_name
        source_exists = source.is_file()
        fixture_exists = fixture.is_file()
        payload = _read_fixture_payload(fixture)
        expected_source_label = spec.source_rel.replace("\\", "/")
        declared_source_label = _declared_source_label(payload) if payload is not None else None
        source_label_matches = declared_source_label == expected_source_label
        token_count = _payload_token_count(payload) if payload is not None else 0
        payload_sha256 = _sha256_text(fixture.read_text(encoding="utf-8")) if fixture_exists else None
        if not source_exists:
            status = "source-missing"
        elif not fixture_exists:
            status = "missing"
        else:
            expected = canonical_fixture_text(spec, repo_root=root)
            actual = fixture.read_text(encoding="utf-8")
            status = "current" if actual == expected else "stale"
        statuses.append(
            TokenFixtureStatus(
                source_rel=spec.source_rel,
                fixture_name=spec.fixture_name,
                fixture_path=str(fixture),
                source_exists=source_exists,
                fixture_exists=fixture_exists,
                expected_source_label=expected_source_label,
                declared_source_label=declared_source_label,
                source_label_matches=source_label_matches,
                token_count=token_count,
                payload_sha256=payload_sha256,
                status=status,
            )
        )
    return statuses


def fixture_status_payload(
    *,
    repo_root: Path | None = None,
    fixture_root: Path | None = None,
    specs: Sequence[TokenFixtureSpec] | None = None,
) -> dict[str, object]:
    root = default_repo_root() if repo_root is None else repo_root
    out_root = default_fixture_root(root) if fixture_root is None else fixture_root
    statuses = fixture_status_report(
        repo_root=root,
        fixture_root=out_root,
        specs=specs,
    )
    unmanaged = unmanaged_fixture_names(fixture_root=out_root, specs=specs)
    counts = {
        "total": len(statuses),
        "current": sum(1 for item in statuses if item.status == "current"),
        "missing": sum(1 for item in statuses if item.status == "missing"),
        "stale": sum(1 for item in statuses if item.status == "stale"),
        "source_missing": sum(1 for item in statuses if item.status == "source-missing"),
        "unmanaged": len(unmanaged),
    }
    return {
        "schema": TOKEN_FIXTURE_REPORT_SCHEMA,
        "version": TOKEN_FIXTURE_REPORT_VERSION,
        "declared_specs": [
            {
                "source_rel": spec.source_rel,
                "fixture_name": spec.fixture_name,
            }
            for spec in iter_fixture_specs(specs)
        ],
        "discovered_fixture_names": discovered_fixture_names(out_root),
        "unmanaged_fixtures": unmanaged,
        "fixtures": [
            {
                "source_rel": item.source_rel,
                "fixture_name": item.fixture_name,
                "fixture_path": item.fixture_path,
                "source_exists": item.source_exists,
                "fixture_exists": item.fixture_exists,
                "expected_source_label": item.expected_source_label,
                "declared_source_label": item.declared_source_label,
                "source_label_matches": item.source_label_matches,
                "token_count": item.token_count,
                "payload_sha256": item.payload_sha256,
                "status": item.status,
            }
            for item in statuses
        ],
        "summary": counts,
    }


def fixture_drift_report(
    *,
    repo_root: Path | None = None,
    fixture_root: Path | None = None,
    specs: Sequence[TokenFixtureSpec] | None = None,
) -> list[str]:
    drifted: list[str] = []
    for item in fixture_status_report(
        repo_root=repo_root,
        fixture_root=fixture_root,
        specs=specs,
    ):
        if item.status == "missing":
            drifted.append(f"{item.fixture_name}: missing")
        elif item.status == "stale":
            drifted.append(f"{item.fixture_name}: stale")
        elif item.status == "source-missing":
            drifted.append(f"{item.fixture_name}: source-missing")
    return drifted


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


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m vektorflow.native_lexer_fixtures",
        description="Regenerate or verify checked-in versioned token-stream fixtures.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Repository root. Defaults to the current vektorflow repo root.",
    )
    parser.add_argument(
        "--fixture-root",
        type=Path,
        default=None,
        help="Output directory for generated token fixtures.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify that checked-in fixtures are current without rewriting them.",
    )
    parser.add_argument(
        "--report",
        action="store_true",
        help="Print a JSON fixture coverage/parity report without rewriting files.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    if args.report:
        sys.stdout.write(
            json.dumps(
                fixture_status_payload(
                    repo_root=args.repo_root,
                    fixture_root=args.fixture_root,
                ),
                indent=2,
            )
        )
        sys.stdout.write("\n")
        return 0
    if args.check:
        drifted = fixture_drift_report(
            repo_root=args.repo_root,
            fixture_root=args.fixture_root,
        )
        for line in drifted:
            sys.stdout.write(line)
            sys.stdout.write("\n")
        return 1 if drifted else 0
    written = regenerate_token_fixtures(
        repo_root=args.repo_root,
        fixture_root=args.fixture_root,
    )
    for path in written:
        sys.stdout.write(str(path))
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
