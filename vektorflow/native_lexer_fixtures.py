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
from pathlib import PurePosixPath
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


@dataclass(frozen=True)
class DeclaredFixtureCatalogIssue:
    issue: str
    value: str
    fixture_names: tuple[str, ...]


TOKEN_FIXTURE_REPORT_SCHEMA = "vektorflow.token_fixture_report"
TOKEN_FIXTURE_REPORT_VERSION = 1
TOKEN_FIXTURE_MANIFEST_SCHEMA = "vektorflow.token_fixture_manifest"
TOKEN_FIXTURE_MANIFEST_VERSION = 1


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


def canonical_source_rel(source_rel: str) -> str:
    return PurePosixPath(source_rel.replace("\\", "/")).as_posix()


def discovered_fixture_names(fixture_root: Path) -> list[str]:
    return sorted(path.name for path in fixture_root.glob("*.json"))


def declared_fixture_names(specs: Sequence[TokenFixtureSpec] | None = None) -> set[str]:
    return {spec.fixture_name for spec in iter_fixture_specs(specs)}


def declared_fixture_inventory(
    *,
    repo_root: Path | None = None,
    fixture_root: Path | None = None,
    specs: Sequence[TokenFixtureSpec] | None = None,
) -> list[dict[str, str]]:
    root = default_repo_root() if repo_root is None else repo_root
    out_root = default_fixture_root(root) if fixture_root is None else fixture_root
    return [
        {
            "source_rel": spec.source_rel,
            "fixture_name": spec.fixture_name,
            "fixture_path": str(out_root / spec.fixture_name),
            "expected_source_label": canonical_source_rel(spec.source_rel),
        }
        for spec in iter_fixture_specs(specs)
    ]


def _declared_pairing_status(*, source_exists: bool, fixture_exists: bool) -> str:
    if source_exists and fixture_exists:
        return "paired"
    if source_exists:
        return "fixture-missing"
    if fixture_exists:
        return "source-missing"
    return "unpaired"


def _external_lexer_contract_usable(*, pairing_status: str, validation_issues: Sequence[str]) -> bool:
    return pairing_status == "paired" and not validation_issues


def declared_fixture_manifest_payload(
    *,
    repo_root: Path | None = None,
    fixture_root: Path | None = None,
    specs: Sequence[TokenFixtureSpec] | None = None,
) -> dict[str, object]:
    root = default_repo_root() if repo_root is None else repo_root
    out_root = default_fixture_root(root) if fixture_root is None else fixture_root
    inventory = declared_fixture_inventory(
        repo_root=root,
        fixture_root=out_root,
        specs=specs,
    )
    catalog_issues = declared_fixture_catalog_issues(specs)
    fixtures: list[dict[str, object]] = []
    for item in inventory:
        source = root / canonical_source_rel(item["source_rel"])
        fixture = out_root / item["fixture_name"]
        source_exists = source.is_file()
        fixture_exists = fixture.is_file()
        pairing_status = _declared_pairing_status(
            source_exists=source_exists,
            fixture_exists=fixture_exists,
        )
        validation_issues: list[str] = []
        if not source_exists:
            validation_issues.append("source-missing")
        if not fixture_exists:
            validation_issues.append("fixture-missing")
        if item["source_rel"] != item["expected_source_label"]:
            validation_issues.append("noncanonical-source-rel")
        external_lexer_contract_usable = _external_lexer_contract_usable(
            pairing_status=pairing_status,
            validation_issues=validation_issues,
        )
        fixtures.append(
            {
                "source_rel": item["source_rel"],
                "canonical_source_rel": canonical_source_rel(item["source_rel"]),
                "fixture_name": item["fixture_name"],
                "expected_source_label": item["expected_source_label"],
                "source_path": str(source),
                "fixture_path": item["fixture_path"],
                "source_exists": source_exists,
                "fixture_exists": fixture_exists,
                "source_sha256": _sha256_path(source) if source_exists else None,
                "fixture_sha256": _sha256_path(fixture) if fixture_exists else None,
                "pairing_status": pairing_status,
                "external_lexer_contract": {
                    "source_path": str(source),
                    "filename_label": item["expected_source_label"],
                    "fixture_path": item["fixture_path"],
                },
                "external_lexer_contract_usable": external_lexer_contract_usable,
                "validation_issues": validation_issues,
            }
        )

    validation_issue_counts: dict[str, int] = {}
    fixtures_with_validation_issues: list[dict[str, object]] = []
    for item in fixtures:
        issues = item["validation_issues"]
        if issues:
            fixtures_with_validation_issues.append(
                {
                    "fixture_name": item["fixture_name"],
                    "issues": list(issues),
                }
            )
        for issue in issues:
            validation_issue_counts[issue] = validation_issue_counts.get(issue, 0) + 1

    external_harness_view = {
        "usable_contracts": [
            {
                "fixture_name": item["fixture_name"],
                "source_rel": item["source_rel"],
                "canonical_source_rel": item["canonical_source_rel"],
                "pairing_status": item["pairing_status"],
                "source_path": item["external_lexer_contract"]["source_path"],
                "filename_label": item["external_lexer_contract"]["filename_label"],
                "fixture_path": item["external_lexer_contract"]["fixture_path"],
            }
            for item in fixtures
            if item["external_lexer_contract_usable"]
        ],
        "blocked_contracts": [
            {
                "fixture_name": item["fixture_name"],
                "source_rel": item["source_rel"],
                "canonical_source_rel": item["canonical_source_rel"],
                "pairing_status": item["pairing_status"],
                "source_path": item["external_lexer_contract"]["source_path"],
                "filename_label": item["external_lexer_contract"]["filename_label"],
                "fixture_path": item["external_lexer_contract"]["fixture_path"],
                "validation_issues": list(item["validation_issues"]),
            }
            for item in fixtures
            if not item["external_lexer_contract_usable"]
        ],
    }
    runnable_fixture_names = [
        item["fixture_name"] for item in fixtures if item["external_lexer_contract_usable"]
    ]
    blocked_fixture_names = [
        item["fixture_name"] for item in fixtures if not item["external_lexer_contract_usable"]
    ]
    runnable_fixture_set = {
        "fixture_names": runnable_fixture_names,
        "blocked_fixture_names": blocked_fixture_names,
        "count": len(runnable_fixture_names),
        "blocked_count": len(blocked_fixture_names),
        "all_runnable": len(blocked_fixture_names) == 0,
        "bundle_sha256": _bundle_sha256(external_harness_view["usable_contracts"]),
    }
    runnable_fixture_set_comparison = {
        "identity_fields": [
            "fixture_name",
            "source_rel",
            "canonical_source_rel",
            "pairing_status",
            "source_path",
            "filename_label",
            "fixture_path",
        ],
        "ordering": "fixture_names sorted ascending",
        "runnable_fixture_names": sorted(runnable_fixture_names),
        "blocked_fixture_names": sorted(blocked_fixture_names),
        "comparison_sha256": _bundle_sha256(
            {
                "runnable_fixture_names": sorted(runnable_fixture_names),
                "blocked_fixture_names": sorted(blocked_fixture_names),
                "usable_contracts": external_harness_view["usable_contracts"],
            }
        ),
    }
    runnable_contract_set_identity = {
        "comparison_sha256": runnable_fixture_set_comparison["comparison_sha256"],
        "usable_count": len(runnable_fixture_names),
        "blocked_count": len(blocked_fixture_names),
        "all_runnable": len(blocked_fixture_names) == 0,
        "equality_rule": "same runnable contract set iff comparison_sha256 matches",
        "comparison_source": "runnable_fixture_set_comparison",
    }
    runnable_contract_set_validation = {
        "identity_consistent": (
            runnable_contract_set_identity["comparison_sha256"]
            == runnable_fixture_set_comparison["comparison_sha256"]
        ),
        "usable_count_matches": (
            runnable_contract_set_identity["usable_count"] == runnable_fixture_set["count"]
        ),
        "blocked_count_matches": (
            runnable_contract_set_identity["blocked_count"] == runnable_fixture_set["blocked_count"]
        ),
        "all_runnable_matches": (
            runnable_contract_set_identity["all_runnable"] == runnable_fixture_set["all_runnable"]
        ),
        "validation_passed": True,
        "validation_inputs": [
            "runnable_fixture_set",
            "runnable_fixture_set_comparison",
            "runnable_contract_set_identity",
        ],
    }
    runnable_contract_set_validation["validation_passed"] = all(
        (
            runnable_contract_set_validation["identity_consistent"],
            runnable_contract_set_validation["usable_count_matches"],
            runnable_contract_set_validation["blocked_count_matches"],
            runnable_contract_set_validation["all_runnable_matches"],
        )
    )
    blocking_issue_counts: dict[str, int] = {}
    for item in external_harness_view["blocked_contracts"]:
        for issue in item["validation_issues"]:
            blocking_issue_counts[issue] = blocking_issue_counts.get(issue, 0) + 1
    if blocked_fixture_names:
        readiness_status = "partially-runnable" if runnable_fixture_names else "blocked"
    else:
        readiness_status = "all-runnable"
    runnable_contract_readiness = {
        "status": readiness_status,
        "ready": (
            runnable_contract_set_validation["validation_passed"]
            and runnable_contract_set_identity["all_runnable"]
        ),
        "readiness_rule": "ready iff validation_passed is true and blocked_count is 0",
        "usable_count": runnable_contract_set_identity["usable_count"],
        "blocked_count": runnable_contract_set_identity["blocked_count"],
        "blocking_issue_counts": {
            key: blocking_issue_counts[key] for key in sorted(blocking_issue_counts)
        },
    }
    runnable_contract_readiness_validation = {
        "ready_matches_status": runnable_contract_readiness["ready"] == (
            runnable_contract_readiness["status"] == "all-runnable"
        ),
        "usable_count_matches_identity": (
            runnable_contract_readiness["usable_count"]
            == runnable_contract_set_identity["usable_count"]
        ),
        "blocked_count_matches_identity": (
            runnable_contract_readiness["blocked_count"]
            == runnable_contract_set_identity["blocked_count"]
        ),
        "blocking_issue_counts_match_blocked_contracts": (
            runnable_contract_readiness["blocking_issue_counts"]
            == {key: blocking_issue_counts[key] for key in sorted(blocking_issue_counts)}
        ),
        "validation_passed": True,
        "validation_inputs": [
            "runnable_contract_readiness",
            "runnable_contract_set_identity",
            "external_harness_view",
        ],
    }
    runnable_contract_readiness_validation["validation_passed"] = all(
        (
            runnable_contract_readiness_validation["ready_matches_status"],
            runnable_contract_readiness_validation["usable_count_matches_identity"],
            runnable_contract_readiness_validation["blocked_count_matches_identity"],
            runnable_contract_readiness_validation["blocking_issue_counts_match_blocked_contracts"],
        )
    )
    runnable_contract_readiness_identity = {
        "status": runnable_contract_readiness["status"],
        "ready": runnable_contract_readiness["ready"],
        "usable_count": runnable_contract_readiness["usable_count"],
        "blocked_count": runnable_contract_readiness["blocked_count"],
        "blocking_issue_counts": runnable_contract_readiness["blocking_issue_counts"],
        "readiness_sha256": _bundle_sha256(
            {
                "status": runnable_contract_readiness["status"],
                "ready": runnable_contract_readiness["ready"],
                "usable_count": runnable_contract_readiness["usable_count"],
                "blocked_count": runnable_contract_readiness["blocked_count"],
                "blocking_issue_counts": runnable_contract_readiness["blocking_issue_counts"],
                "validation_passed": runnable_contract_readiness_validation["validation_passed"],
            }
        ),
        "equality_rule": "same readiness state iff readiness_sha256 matches",
        "validation_source": "runnable_contract_readiness_validation",
    }
    runnable_contract_state = {
        "status": runnable_contract_readiness["status"],
        "ready": runnable_contract_readiness["ready"],
        "validation_passed": runnable_contract_readiness_validation["validation_passed"],
        "usable_count": runnable_contract_readiness_identity["usable_count"],
        "blocked_count": runnable_contract_readiness_identity["blocked_count"],
        "comparison_sha256": runnable_contract_set_identity["comparison_sha256"],
        "readiness_sha256": runnable_contract_readiness_identity["readiness_sha256"],
        "state_sha256": _bundle_sha256(
            {
                "status": runnable_contract_readiness["status"],
                "ready": runnable_contract_readiness["ready"],
                "validation_passed": runnable_contract_readiness_validation["validation_passed"],
                "usable_count": runnable_contract_readiness_identity["usable_count"],
                "blocked_count": runnable_contract_readiness_identity["blocked_count"],
                "comparison_sha256": runnable_contract_set_identity["comparison_sha256"],
                "readiness_sha256": runnable_contract_readiness_identity["readiness_sha256"],
            }
        ),
        "consumption_rule": "consume readiness from this object; compare manifests by comparison_sha256 and readiness_sha256",
        "identity_sources": [
            "runnable_contract_set_identity",
            "runnable_contract_readiness_identity",
            "runnable_contract_readiness_validation",
        ],
    }

    return {
        "schema": TOKEN_FIXTURE_MANIFEST_SCHEMA,
        "version": TOKEN_FIXTURE_MANIFEST_VERSION,
        "path_anchors": {
            "repo_root": str(root),
            "fixture_root": str(out_root),
            "fixture_path_kind": "absolute",
            "source_path_kind": "absolute",
            "source_rel_kind": "repo-relative-posix",
            "filename_label_kind": "repo-relative-posix",
        },
        "fixtures": fixtures,
        "declared_catalog_issues": [
            {
                "issue": item.issue,
                "value": item.value,
                "fixture_names": list(item.fixture_names),
            }
            for item in catalog_issues
        ],
        "validation_issue_counts": {
            key: validation_issue_counts[key] for key in sorted(validation_issue_counts)
        },
        "fixtures_with_validation_issues": fixtures_with_validation_issues,
        "fixtures_by_pairing_status": {
            key: [
                item["fixture_name"]
                for item in fixtures
                if item["pairing_status"] == key
            ]
            for key in sorted({item["pairing_status"] for item in fixtures})
        },
        "contract_invariants": {
            "usable_requires_pairing_status": "paired",
            "usable_requires_validation_issues": [],
            "required_external_lexer_contract_fields": [
                "source_path",
                "filename_label",
                "fixture_path",
            ],
            "external_lexer_contract_field_meanings": {
                "source_path": "Absolute path to the declared VKF source file on disk.",
                "filename_label": "Canonical repo-relative POSIX label that the external lexer should emit in token locations.",
                "fixture_path": "Absolute path to the canonical token fixture JSON for this declaration.",
            },
        },
        "fixtures_by_contract_usability": {
            "blocked": [
                item["fixture_name"]
                for item in fixtures
                if not item["external_lexer_contract_usable"]
            ],
            "usable": [
                item["fixture_name"]
                for item in fixtures
                if item["external_lexer_contract_usable"]
            ],
        },
        "external_harness_view": external_harness_view,
        "runnable_fixture_set": runnable_fixture_set,
        "runnable_fixture_set_comparison": runnable_fixture_set_comparison,
        "runnable_contract_set_identity": runnable_contract_set_identity,
        "runnable_contract_set_validation": runnable_contract_set_validation,
        "runnable_contract_readiness": runnable_contract_readiness,
        "runnable_contract_readiness_validation": runnable_contract_readiness_validation,
        "runnable_contract_readiness_identity": runnable_contract_readiness_identity,
        "runnable_contract_state": runnable_contract_state,
        "bundle_sha256": _bundle_sha256(
            [
                {
                    "source_rel": item["source_rel"],
                    "canonical_source_rel": item["canonical_source_rel"],
                    "fixture_name": item["fixture_name"],
                    "expected_source_label": item["expected_source_label"],
                    "source_sha256": item["source_sha256"],
                    "fixture_sha256": item["fixture_sha256"],
                    "pairing_status": item["pairing_status"],
                    "external_lexer_contract": item["external_lexer_contract"],
                    "external_lexer_contract_usable": item["external_lexer_contract_usable"],
                    "validation_issues": item["validation_issues"],
                }
                for item in fixtures
            ]
            + [
                {
                    "external_harness_view": external_harness_view,
                    "runnable_fixture_set": runnable_fixture_set,
                    "runnable_fixture_set_comparison": runnable_fixture_set_comparison,
                    "runnable_contract_set_identity": runnable_contract_set_identity,
                    "runnable_contract_set_validation": runnable_contract_set_validation,
                    "runnable_contract_readiness": runnable_contract_readiness,
                    "runnable_contract_readiness_validation": runnable_contract_readiness_validation,
                    "runnable_contract_readiness_identity": runnable_contract_readiness_identity,
                    "runnable_contract_state": runnable_contract_state,
                }
            ]
        ),
        "summary": {
            "total": len(fixtures),
            "source_present": sum(1 for item in fixtures if item["source_exists"]),
            "fixture_present": sum(1 for item in fixtures if item["fixture_exists"]),
            "paired": sum(1 for item in fixtures if item["pairing_status"] == "paired"),
            "fixture_missing": sum(1 for item in fixtures if item["pairing_status"] == "fixture-missing"),
            "source_missing": sum(1 for item in fixtures if item["pairing_status"] == "source-missing"),
            "unpaired": sum(1 for item in fixtures if item["pairing_status"] == "unpaired"),
            "external_lexer_contract_usable": sum(
                1 for item in fixtures if item["external_lexer_contract_usable"]
            ),
            "external_lexer_contract_blocked": sum(
                1 for item in fixtures if not item["external_lexer_contract_usable"]
            ),
            "with_validation_issues": sum(1 for item in fixtures if item["validation_issues"]),
            "declared_catalog_issues": len(catalog_issues),
        },
    }


def declared_fixture_catalog_issues(
    specs: Sequence[TokenFixtureSpec] | None = None,
) -> list[DeclaredFixtureCatalogIssue]:
    by_source_rel: dict[str, list[str]] = {}
    by_fixture_name: dict[str, list[str]] = {}
    noncanonical_source_rels: dict[str, list[str]] = {}
    for spec in iter_fixture_specs(specs):
        canonical_rel = canonical_source_rel(spec.source_rel)
        by_source_rel.setdefault(canonical_rel, []).append(spec.fixture_name)
        by_fixture_name.setdefault(spec.fixture_name, []).append(spec.source_rel)
        if spec.source_rel != canonical_rel:
            noncanonical_source_rels.setdefault(canonical_rel, []).append(spec.source_rel)

    issues: list[DeclaredFixtureCatalogIssue] = []
    for source_rel, fixture_names in sorted(by_source_rel.items()):
        if len(fixture_names) > 1:
            issues.append(
                DeclaredFixtureCatalogIssue(
                    issue="duplicate-source-rel",
                    value=source_rel,
                    fixture_names=tuple(sorted(fixture_names)),
                )
            )
    for fixture_name, source_rels in sorted(by_fixture_name.items()):
        if len(source_rels) > 1:
            issues.append(
                DeclaredFixtureCatalogIssue(
                    issue="duplicate-fixture-name",
                    value=fixture_name,
                    fixture_names=tuple(sorted(source_rels)),
                )
            )
    for canonical_rel, source_rels in sorted(noncanonical_source_rels.items()):
        issues.append(
            DeclaredFixtureCatalogIssue(
                issue="noncanonical-source-rel",
                value=canonical_rel,
                fixture_names=tuple(sorted(source_rels)),
            )
        )
    return issues


def unmanaged_fixture_names(
    *,
    fixture_root: Path,
    specs: Sequence[TokenFixtureSpec] | None = None,
) -> list[str]:
    declared = declared_fixture_names(specs)
    return [name for name in discovered_fixture_names(fixture_root) if name not in declared]


def canonical_fixture_text(spec: TokenFixtureSpec, *, repo_root: Path | None = None) -> str:
    root = default_repo_root() if repo_root is None else repo_root
    payload = lex_file_to_payload(root / canonical_source_rel(spec.source_rel), root=root)
    return token_stream_to_json_payload(payload)


def token_stream_to_json_payload(payload: dict[str, object]) -> str:
    return json.dumps(payload, indent=2)


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha256_path(path: Path) -> str:
    return _sha256_text(path.read_text(encoding="utf-8"))


def _bundle_sha256(value: object) -> str:
    return _sha256_text(json.dumps(value, sort_keys=True, separators=(",", ":")))


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


def _group_managed_fixtures_by_status(
    statuses: Sequence[TokenFixtureStatus],
) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for item in statuses:
        grouped.setdefault(item.status, []).append(item.fixture_name)
    return {key: sorted(value) for key, value in sorted(grouped.items())}


def _group_discovered_fixtures_by_envelope_kind(
    discovered: Sequence[DiscoveredFixtureStatus],
) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for item in discovered:
        grouped.setdefault(item.envelope_kind, []).append(item.fixture_name)
    return {key: sorted(value) for key, value in sorted(grouped.items())}


def _group_discovered_fixtures_by_pairing_mode(
    discovered: Sequence[DiscoveredFixtureStatus],
) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for item in discovered:
        grouped.setdefault(item.pairing_mode, []).append(item.fixture_name)
    return {key: sorted(value) for key, value in sorted(grouped.items())}


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
        source = root / canonical_source_rel(spec.source_rel)
        fixture = out_root / spec.fixture_name
        source_exists = source.is_file()
        fixture_exists = fixture.is_file()
        payload = _read_fixture_payload(fixture)
        expected_source_label = canonical_source_rel(spec.source_rel)
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
    catalog_issues = declared_fixture_catalog_issues(specs)
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
        "declared_catalog_issues": len(catalog_issues),
    }
    return {
        "schema": TOKEN_FIXTURE_REPORT_SCHEMA,
        "version": TOKEN_FIXTURE_REPORT_VERSION,
        "declared_specs": declared_fixture_inventory(
            repo_root=root,
            fixture_root=out_root,
            specs=specs,
        ),
        "declared_catalog_issues": [
            {
                "issue": item.issue,
                "value": item.value,
                "fixture_names": list(item.fixture_names),
            }
            for item in catalog_issues
        ],
        "discovered_fixture_names": discovered_fixture_names(out_root),
        "unmanaged_fixtures": unmanaged,
        "managed_fixtures_by_status": _group_managed_fixtures_by_status(statuses),
        "discovered_fixtures_by_envelope_kind": _group_discovered_fixtures_by_envelope_kind(discovered),
        "discovered_fixtures_by_pairing_mode": _group_discovered_fixtures_by_pairing_mode(discovered),
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
        "bundle_sha256": {
            "declared_specs": _bundle_sha256(
                [
                    {
                        "source_rel": spec["source_rel"],
                        "fixture_name": spec["fixture_name"],
                        "expected_source_label": spec["expected_source_label"],
                    }
                    for spec in declared_fixture_inventory(
                        repo_root=root,
                        fixture_root=out_root,
                        specs=specs,
                    )
                ]
            ),
            "managed_fixtures": _bundle_sha256(
                [
                    {
                        "source_rel": item.source_rel,
                        "fixture_name": item.fixture_name,
                        "status": item.status,
                        "source_sha256": item.source_sha256,
                        "payload_sha256": item.payload_sha256,
                    }
                    for item in statuses
                ]
            ),
            "discovered_fixtures": _bundle_sha256(
                [
                    {
                        "fixture_name": item.fixture_name,
                        "managed": item.managed,
                        "envelope_kind": item.envelope_kind,
                        "canonical_versioned": item.canonical_versioned,
                        "payload_sha256": item.payload_sha256,
                        "validation_issues": list(item.validation_issues),
                    }
                    for item in discovered
                ]
            ),
            "declared_catalog_issues": _bundle_sha256(
                [
                    {
                        "issue": item.issue,
                        "value": item.value,
                        "fixture_names": list(item.fixture_names),
                    }
                    for item in catalog_issues
                ]
            ),
            "validation_issues": _bundle_sha256(_fixtures_with_validation_issues(discovered)),
        },
        "summary": counts,
    }


def fixture_drift_report(
    *,
    repo_root: Path | None = None,
    fixture_root: Path | None = None,
    specs: Sequence[TokenFixtureSpec] | None = None,
) -> list[str]:
    drifted = [
        f"{item.issue}: {item.value} -> {', '.join(item.fixture_names)}"
        for item in declared_fixture_catalog_issues(specs)
    ]
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
        source = root / canonical_source_rel(spec.source_rel)
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
    parser.add_argument(
        "--manifest",
        action="store_true",
        help="Print the declared fixture manifest JSON without rewriting files.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    if args.manifest:
        sys.stdout.write(
            json.dumps(
                declared_fixture_manifest_payload(
                    repo_root=args.repo_root,
                    fixture_root=args.fixture_root,
                ),
                indent=2,
            )
        )
        sys.stdout.write("\n")
        return 0
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
