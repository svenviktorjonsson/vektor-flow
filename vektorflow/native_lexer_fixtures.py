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
    source_path: str
    fixture_name: str
    fixture_path: str
    source_exists: bool
    fixture_exists: bool
    expected_source_label: str
    declared_source_label: str | None
    source_label_matches: bool
    source_sha256: str | None
    token_count: int
    payload_sha256: str | None
    status: str


@dataclass(frozen=True)
class DiscoveredFixtureStatus:
    fixture_name: str
    fixture_path: str
    managed: bool
    parseable_json: bool
    envelope_kind: str
    canonical_versioned: bool
    declared_source_label: str | None
    pairing_mode: str
    paired_source_path: str | None
    paired_source_exists: bool
    paired_source_sha256: str | None
    token_count: int
    payload_sha256: str
    validation_issues: tuple[str, ...]


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


def _sha256_path(path: Path) -> str:
    return _sha256_text(path.read_text(encoding="utf-8"))


def _read_fixture_payload(path: Path) -> dict[str, object] | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _read_fixture_payload_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


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


def _is_canonical_versioned_payload(payload: dict[str, object]) -> bool:
    return (
        payload.get("schema") == "vektorflow.token_stream"
        and payload.get("version") == 1
        and isinstance(payload.get("tokens"), list)
    )


def _envelope_kind(payload: object) -> str:
    if not isinstance(payload, dict):
        return "invalid-shape"
    if payload.get("schema") == "vektorflow.token_stream" and payload.get("version") == 1:
        return "versioned" if isinstance(payload.get("tokens"), list) else "invalid-shape"
    if "schema" not in payload and "version" not in payload and isinstance(payload.get("tokens"), list):
        return "legacy"
    return "other"


def _paired_source_path_for_label(label: str | None, *, repo_root: Path) -> Path | None:
    if not label:
        return None
    candidate = repo_root / Path(label)
    return candidate


def _paired_source_path_for_fixture(
    fixture_path: Path,
    *,
    declared_source_label: str | None,
    repo_root: Path,
) -> Path | None:
    sibling = fixture_path.with_suffix(".vkf")
    if sibling.is_file():
        return sibling
    return _paired_source_path_for_label(declared_source_label, repo_root=repo_root)


def _paired_source_info_for_fixture(
    fixture_path: Path,
    *,
    declared_source_label: str | None,
    repo_root: Path,
) -> tuple[str, Path | None]:
    sibling = fixture_path.with_suffix(".vkf")
    if sibling.is_file():
        return "sibling-vkf", sibling
    declared = _paired_source_path_for_label(declared_source_label, repo_root=repo_root)
    if declared is not None:
        return "declared-label", declared
    return "none", None


def _validation_issues_for_discovered_fixture(
    *,
    parseable_json: bool,
    envelope_kind: str,
    canonical_versioned: bool,
    declared_source_label: str | None,
    paired_source_exists: bool,
    token_count: int,
) -> tuple[str, ...]:
    issues: list[str] = []
    if not parseable_json:
        issues.append("invalid-json")
    elif envelope_kind == "invalid-shape":
        issues.append("invalid-shape")
    elif envelope_kind == "other":
        issues.append("nonstandard-envelope")
    elif envelope_kind == "legacy":
        issues.append("legacy-envelope")
    if declared_source_label is None:
        issues.append("missing-source-label")
    if not paired_source_exists:
        issues.append("missing-paired-source")
    if token_count == 0:
        issues.append("empty-token-list")
    if parseable_json and not canonical_versioned:
        issues.append("not-canonical-versioned")
    return tuple(issues)


def _validation_issue_counts(
    discovered: Sequence[DiscoveredFixtureStatus],
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in discovered:
        for issue in item.validation_issues:
            counts[issue] = counts.get(issue, 0) + 1
    return {key: counts[key] for key in sorted(counts)}


def _fixtures_with_validation_issues(
    discovered: Sequence[DiscoveredFixtureStatus],
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for item in discovered:
        if item.validation_issues:
            rows.append(
                {
                    "fixture_name": item.fixture_name,
                    "issues": list(item.validation_issues),
                }
            )
    return rows


def discovered_fixture_report(
    *,
    repo_root: Path | None = None,
    fixture_root: Path | None = None,
    specs: Sequence[TokenFixtureSpec] | None = None,
) -> list[DiscoveredFixtureStatus]:
    root = default_repo_root() if repo_root is None else repo_root
    out_root = default_fixture_root(root) if fixture_root is None else fixture_root
    managed = declared_fixture_names(specs)
    items: list[DiscoveredFixtureStatus] = []
    for name in discovered_fixture_names(out_root):
        path = out_root / name
        text = _read_fixture_payload_text(path)
        try:
            payload_obj: object = json.loads(text)
            parseable_json = True
        except json.JSONDecodeError:
            payload_obj = None
            parseable_json = False
        envelope_kind = _envelope_kind(payload_obj) if parseable_json else "invalid-json"
        payload = payload_obj if isinstance(payload_obj, dict) else None
        declared_source_label = _declared_source_label(payload) if payload is not None else None
        pairing_mode, paired_source_path = _paired_source_info_for_fixture(
            path,
            declared_source_label=declared_source_label,
            repo_root=root,
        )
        paired_source_exists = bool(paired_source_path and paired_source_path.is_file())
        canonical_versioned = _is_canonical_versioned_payload(payload) if payload is not None else False
        token_count = _payload_token_count(payload) if payload is not None else 0
        items.append(
            DiscoveredFixtureStatus(
                fixture_name=name,
                fixture_path=str(path),
                managed=name in managed,
                parseable_json=parseable_json,
                envelope_kind=envelope_kind,
                canonical_versioned=canonical_versioned,
                declared_source_label=declared_source_label,
                pairing_mode=pairing_mode,
                paired_source_path=str(paired_source_path) if paired_source_path is not None else None,
                paired_source_exists=paired_source_exists,
                paired_source_sha256=_sha256_path(paired_source_path)
                if paired_source_exists and paired_source_path is not None
                else None,
                token_count=token_count,
                payload_sha256=_sha256_text(text),
                validation_issues=_validation_issues_for_discovered_fixture(
                    parseable_json=parseable_json,
                    envelope_kind=envelope_kind,
                    canonical_versioned=canonical_versioned,
                    declared_source_label=declared_source_label,
                    paired_source_exists=paired_source_exists,
                    token_count=token_count,
                ),
            )
        )
    return items


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
                source_path=str(source),
                fixture_name=spec.fixture_name,
                fixture_path=str(fixture),
                source_exists=source_exists,
                fixture_exists=fixture_exists,
                expected_source_label=expected_source_label,
                declared_source_label=declared_source_label,
                source_label_matches=source_label_matches,
                source_sha256=_sha256_path(source) if source_exists else None,
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
    discovered = discovered_fixture_report(
        repo_root=root,
        fixture_root=out_root,
        specs=specs,
    )
    unmanaged = [item.fixture_name for item in discovered if not item.managed]
    counts = {
        "total": len(statuses),
        "current": sum(1 for item in statuses if item.status == "current"),
        "missing": sum(1 for item in statuses if item.status == "missing"),
        "stale": sum(1 for item in statuses if item.status == "stale"),
        "source_missing": sum(1 for item in statuses if item.status == "source-missing"),
        "unmanaged": len(unmanaged),
        "discovered": len(discovered),
        "canonical_versioned": sum(1 for item in discovered if item.canonical_versioned),
        "versioned_envelopes": sum(1 for item in discovered if item.envelope_kind == "versioned"),
        "legacy_envelopes": sum(1 for item in discovered if item.envelope_kind == "legacy"),
        "other_envelopes": sum(1 for item in discovered if item.envelope_kind == "other"),
        "invalid_json": sum(1 for item in discovered if item.envelope_kind == "invalid-json"),
        "invalid_shape": sum(1 for item in discovered if item.envelope_kind == "invalid-shape"),
        "with_validation_issues": sum(1 for item in discovered if item.validation_issues),
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
        "validation_issue_counts": _validation_issue_counts(discovered),
        "fixtures_with_validation_issues": _fixtures_with_validation_issues(discovered),
        "discovered_fixtures": [
            {
                "fixture_name": item.fixture_name,
                "fixture_path": item.fixture_path,
                "managed": item.managed,
                "parseable_json": item.parseable_json,
                "envelope_kind": item.envelope_kind,
                "canonical_versioned": item.canonical_versioned,
                "declared_source_label": item.declared_source_label,
                "pairing_mode": item.pairing_mode,
                "paired_source_path": item.paired_source_path,
                "paired_source_exists": item.paired_source_exists,
                "paired_source_sha256": item.paired_source_sha256,
                "token_count": item.token_count,
                "payload_sha256": item.payload_sha256,
                "validation_issues": list(item.validation_issues),
            }
            for item in discovered
        ],
        "fixtures": [
            {
                "source_rel": item.source_rel,
                "source_path": item.source_path,
                "fixture_name": item.fixture_name,
                "fixture_path": item.fixture_path,
                "source_exists": item.source_exists,
                "fixture_exists": item.fixture_exists,
                "expected_source_label": item.expected_source_label,
                "declared_source_label": item.declared_source_label,
                "source_label_matches": item.source_label_matches,
                "source_sha256": item.source_sha256,
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
