from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from vektorflow.native_lexer_fixtures import (
    TOKEN_FIXTURE_MANIFEST_SCHEMA,
    TOKEN_FIXTURE_MANIFEST_VERSION,
    TOKEN_FIXTURE_SPECS,
    TokenFixtureSpec,
    declared_fixture_manifest_payload,
)
from tests.token_stream_fixture_helper import TOKEN_FIXTURE_ROOT


def test_declared_fixture_manifest_payload_exposes_pairing_contract_for_checked_in_specs() -> None:
    repo = Path(__file__).resolve().parents[1]
    payload = declared_fixture_manifest_payload(repo_root=repo, fixture_root=TOKEN_FIXTURE_ROOT)
    assert payload["schema"] == TOKEN_FIXTURE_MANIFEST_SCHEMA
    assert payload["version"] == TOKEN_FIXTURE_MANIFEST_VERSION
    assert payload["summary"] == {
        "total": len(TOKEN_FIXTURE_SPECS),
        "source_present": len(TOKEN_FIXTURE_SPECS),
        "fixture_present": len(TOKEN_FIXTURE_SPECS),
        "paired": len(TOKEN_FIXTURE_SPECS),
        "fixture_missing": 0,
        "source_missing": 0,
        "unpaired": 0,
        "external_lexer_contract_usable": len(TOKEN_FIXTURE_SPECS),
        "external_lexer_contract_blocked": 0,
        "with_validation_issues": 0,
        "declared_catalog_issues": 0,
    }
    assert payload["contract_invariants"] == {
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
    }
    assert payload["path_anchors"] == {
        "repo_root": str(repo),
        "fixture_root": str(TOKEN_FIXTURE_ROOT),
        "fixture_path_kind": "absolute",
        "source_path_kind": "absolute",
        "source_rel_kind": "repo-relative-posix",
        "filename_label_kind": "repo-relative-posix",
    }
    assert payload["fixtures_by_pairing_status"] == {
        "paired": [spec.fixture_name for spec in TOKEN_FIXTURE_SPECS]
    }
    assert payload["fixtures_by_contract_usability"] == {
        "blocked": [],
        "usable": [spec.fixture_name for spec in TOKEN_FIXTURE_SPECS],
    }
    assert payload["external_harness_view"] == {
        "usable_contracts": [
            {
                "fixture_name": spec.fixture_name,
                "source_rel": spec.source_rel,
                "canonical_source_rel": spec.source_rel,
                "pairing_status": "paired",
                "source_path": str(repo / spec.source_rel),
                "filename_label": spec.source_rel,
                "fixture_path": str(TOKEN_FIXTURE_ROOT / spec.fixture_name),
            }
            for spec in TOKEN_FIXTURE_SPECS
        ],
        "blocked_contracts": [],
    }
    assert payload["runnable_fixture_set"] == {
        "fixture_names": [spec.fixture_name for spec in TOKEN_FIXTURE_SPECS],
        "blocked_fixture_names": [],
        "count": len(TOKEN_FIXTURE_SPECS),
        "blocked_count": 0,
        "all_runnable": True,
        "bundle_sha256": payload["runnable_fixture_set"]["bundle_sha256"],
    }
    assert len(payload["runnable_fixture_set"]["bundle_sha256"]) == 64
    assert payload["runnable_fixture_set_comparison"] == {
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
        "runnable_fixture_names": sorted(spec.fixture_name for spec in TOKEN_FIXTURE_SPECS),
        "blocked_fixture_names": [],
        "comparison_sha256": payload["runnable_fixture_set_comparison"]["comparison_sha256"],
    }
    assert len(payload["runnable_fixture_set_comparison"]["comparison_sha256"]) == 64
    assert payload["runnable_contract_set_identity"] == {
        "comparison_sha256": payload["runnable_fixture_set_comparison"]["comparison_sha256"],
        "usable_count": len(TOKEN_FIXTURE_SPECS),
        "blocked_count": 0,
        "all_runnable": True,
        "equality_rule": "same runnable contract set iff comparison_sha256 matches",
        "comparison_source": "runnable_fixture_set_comparison",
    }
    assert payload["runnable_contract_set_validation"] == {
        "identity_consistent": True,
        "usable_count_matches": True,
        "blocked_count_matches": True,
        "all_runnable_matches": True,
        "validation_passed": True,
        "validation_inputs": [
            "runnable_fixture_set",
            "runnable_fixture_set_comparison",
            "runnable_contract_set_identity",
        ],
    }
    assert payload["runnable_contract_readiness"] == {
        "status": "all-runnable",
        "ready": True,
        "readiness_rule": "ready iff validation_passed is true and blocked_count is 0",
        "usable_count": len(TOKEN_FIXTURE_SPECS),
        "blocked_count": 0,
        "blocking_issue_counts": {},
    }
    assert payload["runnable_contract_readiness_validation"] == {
        "ready_matches_status": True,
        "usable_count_matches_identity": True,
        "blocked_count_matches_identity": True,
        "blocking_issue_counts_match_blocked_contracts": True,
        "validation_passed": True,
        "validation_inputs": [
            "runnable_contract_readiness",
            "runnable_contract_set_identity",
            "external_harness_view",
        ],
    }
    for spec, item in zip(TOKEN_FIXTURE_SPECS, payload["fixtures"], strict=True):
        assert item["pairing_status"] == "paired"
        assert item["external_lexer_contract_usable"] is True
        assert item["external_lexer_contract"] == {
            "source_path": str(repo / spec.source_rel),
            "filename_label": spec.source_rel,
            "fixture_path": str(TOKEN_FIXTURE_ROOT / spec.fixture_name),
        }


def test_declared_fixture_manifest_payload_groups_missing_pairings_for_external_tooling(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    out_root.mkdir()
    existing_fixture = out_root / "source_missing_versioned.json"
    existing_fixture.write_text('{"schema":"vektorflow.token_stream","version":1,"tokens":[]}\n', encoding="utf-8")
    specs = (
        TokenFixtureSpec(
            source_rel="examples/native_core/hello_native.vkf",
            fixture_name="hello_native_versioned.json",
        ),
        TokenFixtureSpec(
            source_rel="examples/native_core/missing_source.vkf",
            fixture_name="source_missing_versioned.json",
        ),
        TokenFixtureSpec(
            source_rel="examples/native_core/missing_both.vkf",
            fixture_name="missing_both_versioned.json",
        ),
    )
    payload = declared_fixture_manifest_payload(repo_root=repo, fixture_root=out_root, specs=specs)
    assert payload["summary"] == {
        "total": 3,
        "source_present": 1,
        "fixture_present": 1,
        "paired": 0,
        "fixture_missing": 1,
        "source_missing": 1,
        "unpaired": 1,
        "external_lexer_contract_usable": 0,
        "external_lexer_contract_blocked": 3,
        "with_validation_issues": 3,
        "declared_catalog_issues": 0,
    }
    assert payload["fixtures_by_pairing_status"] == {
        "fixture-missing": ["hello_native_versioned.json"],
        "source-missing": ["source_missing_versioned.json"],
        "unpaired": ["missing_both_versioned.json"],
    }
    assert payload["path_anchors"] == {
        "repo_root": str(repo),
        "fixture_root": str(out_root),
        "fixture_path_kind": "absolute",
        "source_path_kind": "absolute",
        "source_rel_kind": "repo-relative-posix",
        "filename_label_kind": "repo-relative-posix",
    }
    assert payload["fixtures_by_contract_usability"] == {
        "blocked": [
            "hello_native_versioned.json",
            "source_missing_versioned.json",
            "missing_both_versioned.json",
        ],
        "usable": [],
    }
    assert payload["external_harness_view"] == {
        "usable_contracts": [],
        "blocked_contracts": [
            {
                "fixture_name": "hello_native_versioned.json",
                "source_rel": "examples/native_core/hello_native.vkf",
                "canonical_source_rel": "examples/native_core/hello_native.vkf",
                "pairing_status": "fixture-missing",
                "source_path": str(repo / "examples/native_core/hello_native.vkf"),
                "filename_label": "examples/native_core/hello_native.vkf",
                "fixture_path": str(out_root / "hello_native_versioned.json"),
                "validation_issues": ["fixture-missing"],
            },
            {
                "fixture_name": "source_missing_versioned.json",
                "source_rel": "examples/native_core/missing_source.vkf",
                "canonical_source_rel": "examples/native_core/missing_source.vkf",
                "pairing_status": "source-missing",
                "source_path": str(repo / "examples/native_core/missing_source.vkf"),
                "filename_label": "examples/native_core/missing_source.vkf",
                "fixture_path": str(out_root / "source_missing_versioned.json"),
                "validation_issues": ["source-missing"],
            },
            {
                "fixture_name": "missing_both_versioned.json",
                "source_rel": "examples/native_core/missing_both.vkf",
                "canonical_source_rel": "examples/native_core/missing_both.vkf",
                "pairing_status": "unpaired",
                "source_path": str(repo / "examples/native_core/missing_both.vkf"),
                "filename_label": "examples/native_core/missing_both.vkf",
                "fixture_path": str(out_root / "missing_both_versioned.json"),
                "validation_issues": ["source-missing", "fixture-missing"],
            },
        ],
    }
    assert payload["runnable_fixture_set"] == {
        "fixture_names": [],
        "blocked_fixture_names": [
            "hello_native_versioned.json",
            "source_missing_versioned.json",
            "missing_both_versioned.json",
        ],
        "count": 0,
        "blocked_count": 3,
        "all_runnable": False,
        "bundle_sha256": payload["runnable_fixture_set"]["bundle_sha256"],
    }
    assert len(payload["runnable_fixture_set"]["bundle_sha256"]) == 64
    assert payload["runnable_fixture_set_comparison"] == {
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
        "runnable_fixture_names": [],
        "blocked_fixture_names": [
            "hello_native_versioned.json",
            "missing_both_versioned.json",
            "source_missing_versioned.json",
        ],
        "comparison_sha256": payload["runnable_fixture_set_comparison"]["comparison_sha256"],
    }
    assert len(payload["runnable_fixture_set_comparison"]["comparison_sha256"]) == 64
    assert payload["runnable_contract_set_identity"] == {
        "comparison_sha256": payload["runnable_fixture_set_comparison"]["comparison_sha256"],
        "usable_count": 0,
        "blocked_count": 3,
        "all_runnable": False,
        "equality_rule": "same runnable contract set iff comparison_sha256 matches",
        "comparison_source": "runnable_fixture_set_comparison",
    }
    assert payload["runnable_contract_set_validation"] == {
        "identity_consistent": True,
        "usable_count_matches": True,
        "blocked_count_matches": True,
        "all_runnable_matches": True,
        "validation_passed": True,
        "validation_inputs": [
            "runnable_fixture_set",
            "runnable_fixture_set_comparison",
            "runnable_contract_set_identity",
        ],
    }
    assert payload["runnable_contract_readiness"] == {
        "status": "blocked",
        "ready": False,
        "readiness_rule": "ready iff validation_passed is true and blocked_count is 0",
        "usable_count": 0,
        "blocked_count": 3,
        "blocking_issue_counts": {
            "fixture-missing": 2,
            "source-missing": 2,
        },
    }
    assert payload["runnable_contract_readiness_validation"] == {
        "ready_matches_status": True,
        "usable_count_matches_identity": True,
        "blocked_count_matches_identity": True,
        "blocking_issue_counts_match_blocked_contracts": True,
        "validation_passed": True,
        "validation_inputs": [
            "runnable_contract_readiness",
            "runnable_contract_set_identity",
            "external_harness_view",
        ],
    }
    by_name = {item["fixture_name"]: item for item in payload["fixtures"]}
    assert by_name["hello_native_versioned.json"]["pairing_status"] == "fixture-missing"
    assert by_name["hello_native_versioned.json"]["external_lexer_contract_usable"] is False
    assert by_name["hello_native_versioned.json"]["external_lexer_contract"]["filename_label"] == (
        "examples/native_core/hello_native.vkf"
    )
    assert by_name["source_missing_versioned.json"]["pairing_status"] == "source-missing"
    assert by_name["source_missing_versioned.json"]["external_lexer_contract_usable"] is False
    assert by_name["missing_both_versioned.json"]["pairing_status"] == "unpaired"
    assert by_name["missing_both_versioned.json"]["external_lexer_contract_usable"] is False


def test_native_lexer_fixtures_manifest_cli_emits_pairing_contract_summary() -> None:
    repo = Path(__file__).resolve().parents[1]
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "vektorflow.native_lexer_fixtures",
            "--repo-root",
            str(repo),
            "--fixture-root",
            str(TOKEN_FIXTURE_ROOT),
            "--manifest",
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(proc.stdout)
    assert payload["schema"] == TOKEN_FIXTURE_MANIFEST_SCHEMA
    assert payload["version"] == TOKEN_FIXTURE_MANIFEST_VERSION
    assert payload["summary"]["paired"] == len(TOKEN_FIXTURE_SPECS)
    assert payload["summary"]["fixture_missing"] == 0
    assert payload["summary"]["source_missing"] == 0
    assert payload["summary"]["unpaired"] == 0
    assert payload["summary"]["external_lexer_contract_usable"] == len(TOKEN_FIXTURE_SPECS)
    assert payload["summary"]["external_lexer_contract_blocked"] == 0
    assert payload["path_anchors"] == {
        "repo_root": str(repo),
        "fixture_root": str(TOKEN_FIXTURE_ROOT),
        "fixture_path_kind": "absolute",
        "source_path_kind": "absolute",
        "source_rel_kind": "repo-relative-posix",
        "filename_label_kind": "repo-relative-posix",
    }
    assert payload["fixtures_by_pairing_status"] == {
        "paired": [spec.fixture_name for spec in TOKEN_FIXTURE_SPECS]
    }
    assert payload["fixtures_by_contract_usability"] == {
        "blocked": [],
        "usable": [spec.fixture_name for spec in TOKEN_FIXTURE_SPECS],
    }
    assert payload["external_harness_view"] == {
        "usable_contracts": [
            {
                "fixture_name": spec.fixture_name,
                "source_rel": spec.source_rel,
                "canonical_source_rel": spec.source_rel,
                "pairing_status": "paired",
                "source_path": str(repo / spec.source_rel),
                "filename_label": spec.source_rel,
                "fixture_path": str(TOKEN_FIXTURE_ROOT / spec.fixture_name),
            }
            for spec in TOKEN_FIXTURE_SPECS
        ],
        "blocked_contracts": [],
    }
    assert payload["runnable_fixture_set"] == {
        "fixture_names": [spec.fixture_name for spec in TOKEN_FIXTURE_SPECS],
        "blocked_fixture_names": [],
        "count": len(TOKEN_FIXTURE_SPECS),
        "blocked_count": 0,
        "all_runnable": True,
        "bundle_sha256": payload["runnable_fixture_set"]["bundle_sha256"],
    }
    assert len(payload["runnable_fixture_set"]["bundle_sha256"]) == 64
    assert payload["runnable_fixture_set_comparison"] == {
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
        "runnable_fixture_names": sorted(spec.fixture_name for spec in TOKEN_FIXTURE_SPECS),
        "blocked_fixture_names": [],
        "comparison_sha256": payload["runnable_fixture_set_comparison"]["comparison_sha256"],
    }
    assert len(payload["runnable_fixture_set_comparison"]["comparison_sha256"]) == 64
    assert payload["runnable_contract_set_identity"] == {
        "comparison_sha256": payload["runnable_fixture_set_comparison"]["comparison_sha256"],
        "usable_count": len(TOKEN_FIXTURE_SPECS),
        "blocked_count": 0,
        "all_runnable": True,
        "equality_rule": "same runnable contract set iff comparison_sha256 matches",
        "comparison_source": "runnable_fixture_set_comparison",
    }
    assert payload["runnable_contract_set_validation"] == {
        "identity_consistent": True,
        "usable_count_matches": True,
        "blocked_count_matches": True,
        "all_runnable_matches": True,
        "validation_passed": True,
        "validation_inputs": [
            "runnable_fixture_set",
            "runnable_fixture_set_comparison",
            "runnable_contract_set_identity",
        ],
    }
    assert payload["runnable_contract_readiness"] == {
        "status": "all-runnable",
        "ready": True,
        "readiness_rule": "ready iff validation_passed is true and blocked_count is 0",
        "usable_count": len(TOKEN_FIXTURE_SPECS),
        "blocked_count": 0,
        "blocking_issue_counts": {},
    }
    assert payload["runnable_contract_readiness_validation"] == {
        "ready_matches_status": True,
        "usable_count_matches_identity": True,
        "blocked_count_matches_identity": True,
        "blocking_issue_counts_match_blocked_contracts": True,
        "validation_passed": True,
        "validation_inputs": [
            "runnable_contract_readiness",
            "runnable_contract_set_identity",
            "external_harness_view",
        ],
    }
