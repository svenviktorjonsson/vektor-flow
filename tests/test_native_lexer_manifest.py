from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from vektorflow.native_lexer_fixtures import (
    DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS,
    TEXTUAL_TOKEN_FAMILIES,
    declared_fixture_contract_summary,
    TOKEN_FIXTURE_MANIFEST_SCHEMA,
    TOKEN_FIXTURE_MANIFEST_VERSION,
    TOKEN_FIXTURE_SPECS,
    TokenFixtureSpec,
    declared_fixture_manifest_payload,
)
from vektorflow.native_frontend import native_subset_capabilities
from tests.token_stream_fixture_helper import TOKEN_FIXTURE_ROOT


NATIVE_LEXER_CONTRACT_SOURCE = Path("compiler/native/vkf_lexer_cursor_smoke.cpp")


def _native_lexer_compiler_command(source: Path, output: Path, repo: Path) -> list[str] | None:
    for compiler in ("clang++", "g++", "c++"):
        path = shutil.which(compiler)
        if path is not None:
            return [
                path,
                "-std=c++17",
                "-I",
                str(repo),
                str(source),
                "-o",
                str(output),
            ]

    cl = shutil.which("cl")
    if cl is not None:
        return [
            cl,
            "/nologo",
            "/EHsc",
            "/std:c++17",
            f"/I{repo}",
            str(source),
            f"/Fe:{output}",
        ]

    return None


def _compile_native_lexer_contract(repo: Path, tmp_path: Path) -> Path:
    source = repo / NATIVE_LEXER_CONTRACT_SOURCE
    output = tmp_path / "vkf_native_lexer_contract.exe"
    command = _native_lexer_compiler_command(source, output, repo)
    if command is None:
        pytest.skip("no C++ compiler found")
    subprocess.run(command, cwd=repo, check=True, capture_output=True, text=True)
    return output


def _run_native_lexer_contract(exe: Path, source: str, filename_label: str) -> dict[str, object]:
    proc = subprocess.run(
        [str(exe), source, filename_label],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(proc.stdout)


def _without_native_raw_number_metadata(payload: dict[str, object]) -> dict[str, object]:
    clone = json.loads(json.dumps(payload))
    for token in clone.get("tokens", []):
        token.pop("raw", None)
    return clone


def _sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_text(encoding="utf-8").encode("utf-8")).hexdigest()


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
            "source_sha256",
            "fixture_sha256",
        ],
        "external_lexer_contract_field_meanings": {
            "source_path": "Absolute path to the declared VKF source file on disk.",
            "filename_label": "Canonical repo-relative POSIX label that the external lexer should emit in token locations.",
            "fixture_path": "Absolute path to the canonical token fixture JSON for this declaration.",
            "source_sha256": "SHA-256 of the declared VKF source bytes; compare this to detect source drift even if the path is stable.",
            "fixture_sha256": "SHA-256 of the canonical token fixture JSON bytes; compare this to detect fixture drift even if the path is stable.",
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
                "source_sha256": _sha256_path(repo / spec.source_rel),
                "fixture_sha256": _sha256_path(TOKEN_FIXTURE_ROOT / spec.fixture_name),
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
            "source_sha256",
            "fixture_sha256",
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
    assert payload["runnable_contract_readiness_identity"] == {
        "status": "all-runnable",
        "ready": True,
        "usable_count": len(TOKEN_FIXTURE_SPECS),
        "blocked_count": 0,
        "blocking_issue_counts": {},
        "readiness_sha256": payload["runnable_contract_readiness_identity"]["readiness_sha256"],
        "equality_rule": "same readiness state iff readiness_sha256 matches",
        "validation_source": "runnable_contract_readiness_validation",
    }
    assert len(payload["runnable_contract_readiness_identity"]["readiness_sha256"]) == 64
    assert payload["runnable_contract_state"] == {
        "status": "all-runnable",
        "ready": True,
        "validation_passed": True,
        "usable_count": len(TOKEN_FIXTURE_SPECS),
        "blocked_count": 0,
        "comparison_sha256": payload["runnable_contract_set_identity"]["comparison_sha256"],
        "readiness_sha256": payload["runnable_contract_readiness_identity"]["readiness_sha256"],
        "state_sha256": payload["runnable_contract_state"]["state_sha256"],
        "consumption_rule": "consume readiness from this object; compare manifests by comparison_sha256 and readiness_sha256",
        "identity_sources": [
            "runnable_contract_set_identity",
            "runnable_contract_readiness_identity",
            "runnable_contract_readiness_validation",
        ],
    }
    assert len(payload["runnable_contract_state"]["state_sha256"]) == 64
    assert payload["runnable_contract_state_validation"] == {
        "status_matches_readiness": True,
        "ready_matches_readiness": True,
        "validation_passed_matches_readiness_validation": True,
        "comparison_sha256_matches_set_identity": True,
        "readiness_sha256_matches_readiness_identity": True,
        "validation_passed": True,
        "validation_inputs": [
            "runnable_contract_state",
            "runnable_contract_readiness",
            "runnable_contract_readiness_validation",
            "runnable_contract_set_identity",
            "runnable_contract_readiness_identity",
        ],
    }
    assert payload["external_token_contract_completion"] == {
        "done": True,
        "completion_rule": (
            "done iff runnable contract state is ready, top-level state validation passes, "
            "and declared catalog issues are empty"
        ),
        "blocking_reasons": [],
        "blocking_counts": {
            "declared_catalog_issues": 0,
            "blocked_contracts": 0,
            "state_validation_failures": 0,
        },
        "evidence": {
            "runnable_contract_state": {
                "status": "all-runnable",
                "ready": True,
                "usable_count": len(TOKEN_FIXTURE_SPECS),
                "blocked_count": 0,
            },
            "runnable_contract_state_validation": {
                "validation_passed": True,
            },
            "declared_catalog_issue_count": 0,
        },
    }
    for spec, item in zip(TOKEN_FIXTURE_SPECS, payload["fixtures"], strict=True):
        assert item["pairing_status"] == "paired"
        assert item["external_lexer_contract_usable"] is True
        assert item["external_lexer_contract"] == {
            "source_path": str(repo / spec.source_rel),
            "filename_label": spec.source_rel,
            "fixture_path": str(TOKEN_FIXTURE_ROOT / spec.fixture_name),
            "source_sha256": _sha256_path(repo / spec.source_rel),
            "fixture_sha256": _sha256_path(TOKEN_FIXTURE_ROOT / spec.fixture_name),
        }


def test_native_lexer_contract_artifact_lexes_curated_sources_without_python_lexer(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo = Path(__file__).resolve().parents[1]
    contract_source = repo / NATIVE_LEXER_CONTRACT_SOURCE
    source_text = contract_source.read_text(encoding="utf-8")

    assert "vektorflow.token_stream" in source_text
    assert "Python.h" not in source_text
    assert "Py_Initialize" not in source_text
    assert "python.exe" not in source_text
    assert "tokenize(" not in source_text

    import vektorflow.lexer as python_lexer

    def fail_if_python_lexer_used(*_args, **_kwargs):
        raise AssertionError("native lexer contract path must not call Python lexer")

    monkeypatch.setattr(python_lexer, "tokenize", fail_if_python_lexer_used)

    exe = _compile_native_lexer_contract(repo, tmp_path)

    for spec in TOKEN_FIXTURE_SPECS:
        source_path = repo / spec.source_rel
        payload = _run_native_lexer_contract(
            exe,
            source_path.read_text(encoding="utf-8"),
            spec.source_rel,
        )
        expected = json.loads((TOKEN_FIXTURE_ROOT / spec.fixture_name).read_text(encoding="utf-8"))
        assert _without_native_raw_number_metadata(payload) == expected

    stress_sources = {
        "stress/strings.vkf": '"hi" \'raw\' """a\nb"""',
        "stress/operators.vkf": "@ @: @:: @> @| @! :: -> => .. ... == != ~= <= >= >> /\\ \\/ // >< !?",
        "stress/indent.vkf": "a\n  b\nc",
        "stress/brackets.vkf": "[a\nb]\n(x)->x",
    }

    for filename_label, source in stress_sources.items():
        payload = _run_native_lexer_contract(exe, source, filename_label)
        assert payload["schema"] == "vektorflow.token_stream"
        assert payload["version"] == 1
        assert payload["tokens"]
        assert payload["tokens"][-1]["kind"] == "EOF"
        assert {
            "kind",
            "value",
            "location",
        }.issubset(payload["tokens"][0])
        assert payload["tokens"][0]["location"]["file"] == filename_label


def test_declared_fixture_contract_summary_matches_checked_in_manifest() -> None:
    repo = Path(__file__).resolve().parents[1]
    summary = declared_fixture_contract_summary(repo_root=repo, fixture_root=TOKEN_FIXTURE_ROOT)
    assert summary == {
        "status": "all-runnable",
        "ready": True,
        "validation_passed": True,
        "total": len(TOKEN_FIXTURE_SPECS),
        "usable_count": len(TOKEN_FIXTURE_SPECS),
        "blocked_count": 0,
        "fixture_names": tuple(spec.fixture_name for spec in TOKEN_FIXTURE_SPECS),
        "usable_fixture_names": tuple(spec.fixture_name for spec in TOKEN_FIXTURE_SPECS),
        "blocked_fixture_names": (),
        "covered_token_kinds": (
            "ARROW",
            "COLON",
            "COMMA",
            "DEDENT",
            "DOT",
            "EMIT",
            "EOF",
            "IDENT",
            "INDENT",
            "LBRACKET",
            "LPAREN",
            "NEWLINE",
            "NUMBER",
            "PLUS",
            "RBRACKET",
            "RPAREN",
            "STAR",
        ),
        "covered_token_kind_count": 17,
        "token_family_coverage": tuple(
            {
                "family": family,
                "expected_kinds": tuple(expected_kinds),
                "covered_kinds": (),
                "missing_kinds": tuple(expected_kinds),
                "covered": False,
                "partial": False,
                "covered_kind_count": 0,
                "missing_kind_count": len(expected_kinds),
                "next_missing_kind": expected_kinds[0],
            }
            for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
        ),
        "covered_token_family_count": 0,
        "uncovered_token_family_count": len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS),
        "coverage_blockers": tuple(
            f"{family}:missing={','.join(expected_kinds)}"
            for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
        ),
        "next_coverage_blocker": "dollar_family:missing=DOLLAR",
        "partial_coverage_blockers": (),
        "next_partial_coverage_blocker": None,
        "token_family_status_by_name": {
            family: {
                "covered": False,
                "partial": False,
                "covered_kind_count": 0,
                "missing_kind_count": len(expected_kinds),
                "next_missing_kind": expected_kinds[0],
            }
            for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
        },
        "token_family_frontier": tuple(
            {
                "family": family,
                "partial": False,
                "covered_kind_count": 0,
                "missing_kind_count": len(expected_kinds),
                "next_missing_kind": expected_kinds[0],
                "missing_kinds": tuple(expected_kinds),
            }
            for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
        ),
        "textual_token_family_frontier": tuple(
            {
                "family": family,
                "partial": False,
                "covered_kind_count": 0,
                "missing_kind_count": len(expected_kinds),
                "next_missing_kind": expected_kinds[0],
                "missing_kinds": tuple(expected_kinds),
            }
            for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
            if family in TEXTUAL_TOKEN_FAMILIES
        ),
        "lexer_frontier_overview": {
            "declared_contract": {
                "ready": True,
                "usable_count": len(TOKEN_FIXTURE_SPECS),
                "blocked_count": 0,
                "next_blocker": "dollar_family:missing=DOLLAR",
            },
            "declared_frontier": {
                "ready": False,
                "frontier_count": len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS),
                "next_family": "dollar_family",
                "next_missing_kind": "DOLLAR",
                "next_partial": False,
            },
            "declared_text_frontier": {
                "ready": False,
                "frontier_count": len(TEXTUAL_TOKEN_FAMILIES),
                "next_family": "string_literal_family",
                "next_missing_kind": "STRING",
                "next_partial": False,
            },
            "discovered_frontier": {
                "ready": False,
                "frontier_count": len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS),
                "next_family": "dollar_family",
                "next_missing_kind": "DOLLAR",
                "next_partial": False,
            },
            "discovered_text_frontier": {
                "ready": False,
                "frontier_count": len(TEXTUAL_TOKEN_FAMILIES),
                "next_family": "string_literal_family",
                "next_missing_kind": "STRING",
                "next_partial": False,
            },
        },
        "lexer_operational_status": {
            "ci_declared_ready": True,
            "ci_declared_validation_passed": True,
            "discovered_ahead_of_declared": False,
            "declared_text_ready": False,
            "discovered_text_ready": False,
            "promotion_candidate_ready": False,
            "declared_frontier_count": len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS),
            "discovered_frontier_count": len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS),
            "declared_text_frontier_count": len(TEXTUAL_TOKEN_FAMILIES),
            "discovered_text_frontier_count": len(TEXTUAL_TOKEN_FAMILIES),
            "next_action": "advance-discovered-frontier",
            "next_discovered_family": "dollar_family",
            "next_discovered_kind": "DOLLAR",
            "next_discovered_partial": False,
        },
        "lexer_confidence_signal": {
            "scope": "lexer-support-capability-layer",
            "support_layer_stable": True,
            "support_confidence_percent": 96,
            "support_confidence_label": "high-confidence-not-99",
            "supports_99_confidence_call": False,
            "implementation_frontier_remaining": True,
            "discovered_ahead_of_declared": False,
            "next_remaining_family": "dollar_family",
            "next_remaining_kind": "DOLLAR",
            "next_remaining_partial": False,
        },
        "discovered_covered_token_kinds": (
            "ARROW",
            "COLON",
            "COMMA",
            "DEDENT",
            "DOT",
            "EMIT",
            "EOF",
            "IDENT",
            "INDENT",
            "LBRACKET",
            "LPAREN",
            "NEWLINE",
            "NUMBER",
            "PLUS",
            "RBRACKET",
            "RPAREN",
            "STAR",
        ),
        "discovered_covered_token_kind_count": 17,
        "discovered_token_family_coverage": tuple(
            {
                "family": family,
                "expected_kinds": tuple(expected_kinds),
                "covered_kinds": (),
                "missing_kinds": tuple(expected_kinds),
                "covered": False,
                "partial": False,
                "covered_kind_count": 0,
                "missing_kind_count": len(expected_kinds),
                "next_missing_kind": expected_kinds[0],
            }
            for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
        ),
        "discovered_covered_token_family_count": 0,
        "discovered_uncovered_token_family_count": len(
            DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
        ),
        "discovered_coverage_blockers": tuple(
            f"{family}:missing={','.join(expected_kinds)}"
            for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
        ),
        "next_discovered_coverage_blocker": "dollar_family:missing=DOLLAR",
        "discovered_partial_coverage_blockers": (),
        "next_discovered_partial_coverage_blocker": None,
        "discovered_token_family_status_by_name": {
            family: {
                "covered": False,
                "partial": False,
                "covered_kind_count": 0,
                "missing_kind_count": len(expected_kinds),
                "next_missing_kind": expected_kinds[0],
            }
            for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
        },
        "discovered_token_family_frontier": tuple(
            {
                "family": family,
                "partial": False,
                "covered_kind_count": 0,
                "missing_kind_count": len(expected_kinds),
                "next_missing_kind": expected_kinds[0],
                "missing_kinds": tuple(expected_kinds),
            }
            for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
        ),
        "discovered_textual_token_family_frontier": tuple(
            {
                "family": family,
                "partial": False,
                "covered_kind_count": 0,
                "missing_kind_count": len(expected_kinds),
                "next_missing_kind": expected_kinds[0],
                "missing_kinds": tuple(expected_kinds),
            }
            for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
            if family in TEXTUAL_TOKEN_FAMILIES
        ),
        "completion_done": True,
        "completion_blocking_reasons": (),
        "completion_blocked_contract_count": 0,
        "completion_state_validation_failures": 0,
        "completion_declared_catalog_issue_count": 0,
        "comparison_sha256": summary["comparison_sha256"],
        "readiness_sha256": summary["readiness_sha256"],
        "state_sha256": summary["state_sha256"],
    }
    assert len(summary["comparison_sha256"]) == 64
    assert len(summary["readiness_sha256"]) == 64
    assert len(summary["state_sha256"]) == 64


def test_native_subset_capabilities_expose_declared_fixture_readiness() -> None:
    capabilities = native_subset_capabilities()
    assert capabilities.subset == "native_core"
    assert capabilities.supports_file_lex is True
    assert capabilities.supports_stdin_lex is True
    assert capabilities.declared_token_fixture_status == "all-runnable"
    assert capabilities.declared_token_fixture_ready is True
    assert capabilities.declared_token_fixture_count == len(TOKEN_FIXTURE_SPECS)
    assert capabilities.declared_token_fixture_usable_count == len(TOKEN_FIXTURE_SPECS)
    assert capabilities.declared_token_fixture_blocked_count == 0
    assert capabilities.declared_token_fixture_names == tuple(
        spec.fixture_name for spec in TOKEN_FIXTURE_SPECS
    )
    assert capabilities.declared_token_fixture_usable_names == tuple(
        spec.fixture_name for spec in TOKEN_FIXTURE_SPECS
    )
    assert capabilities.declared_token_fixture_blocked_names == ()
    assert capabilities.declared_token_fixture_covered_token_kinds == (
        "ARROW",
        "COLON",
        "COMMA",
        "DEDENT",
        "DOT",
        "EMIT",
        "EOF",
        "IDENT",
        "INDENT",
        "LBRACKET",
        "LPAREN",
        "NEWLINE",
        "NUMBER",
        "PLUS",
        "RBRACKET",
        "RPAREN",
        "STAR",
    )
    assert capabilities.declared_token_fixture_covered_token_kind_count == 17
    assert capabilities.declared_token_fixture_token_family_coverage == tuple(
        {
            "family": family,
            "expected_kinds": tuple(expected_kinds),
            "covered_kinds": (),
            "missing_kinds": tuple(expected_kinds),
            "covered": False,
            "partial": False,
            "covered_kind_count": 0,
            "missing_kind_count": len(expected_kinds),
            "next_missing_kind": expected_kinds[0],
        }
        for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
    )
    assert capabilities.declared_token_fixture_covered_token_family_count == 0
    assert capabilities.declared_token_fixture_uncovered_token_family_count == len(
        DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
    )
    assert capabilities.declared_token_fixture_coverage_blockers == tuple(
        f"{family}:missing={','.join(expected_kinds)}"
        for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
    )
    assert capabilities.declared_token_fixture_next_coverage_blocker == (
        "dollar_family:missing=DOLLAR"
    )
    assert capabilities.declared_token_fixture_partial_coverage_blockers == ()
    assert capabilities.declared_token_fixture_next_partial_coverage_blocker is None
    assert capabilities.declared_token_fixture_token_family_status_by_name == {
        family: {
            "covered": False,
            "partial": False,
            "covered_kind_count": 0,
            "missing_kind_count": len(expected_kinds),
            "next_missing_kind": expected_kinds[0],
        }
        for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
    }
    assert capabilities.declared_token_fixture_token_family_frontier == tuple(
        {
            "family": family,
            "partial": False,
            "covered_kind_count": 0,
            "missing_kind_count": len(expected_kinds),
            "next_missing_kind": expected_kinds[0],
            "missing_kinds": tuple(expected_kinds),
        }
        for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
    )
    assert capabilities.declared_token_fixture_textual_token_family_frontier == tuple(
        {
            "family": family,
            "partial": False,
            "covered_kind_count": 0,
            "missing_kind_count": len(expected_kinds),
            "next_missing_kind": expected_kinds[0],
            "missing_kinds": tuple(expected_kinds),
        }
        for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
        if family in TEXTUAL_TOKEN_FAMILIES
    )
    assert capabilities.lexer_frontier_overview == {
        "declared_contract": {
            "ready": True,
            "usable_count": len(TOKEN_FIXTURE_SPECS),
            "blocked_count": 0,
            "next_blocker": "dollar_family:missing=DOLLAR",
        },
        "declared_frontier": {
            "ready": False,
            "frontier_count": len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS),
            "next_family": "dollar_family",
            "next_missing_kind": "DOLLAR",
            "next_partial": False,
        },
        "declared_text_frontier": {
            "ready": False,
            "frontier_count": len(TEXTUAL_TOKEN_FAMILIES),
            "next_family": "string_literal_family",
            "next_missing_kind": "STRING",
            "next_partial": False,
        },
        "discovered_frontier": {
            "ready": False,
            "frontier_count": len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS),
            "next_family": "dollar_family",
            "next_missing_kind": "DOLLAR",
            "next_partial": False,
        },
        "discovered_text_frontier": {
            "ready": False,
            "frontier_count": len(TEXTUAL_TOKEN_FAMILIES),
            "next_family": "string_literal_family",
            "next_missing_kind": "STRING",
            "next_partial": False,
        },
    }
    assert capabilities.lexer_operational_status == {
        "ci_declared_ready": True,
        "ci_declared_validation_passed": True,
        "discovered_ahead_of_declared": False,
        "declared_text_ready": False,
        "discovered_text_ready": False,
        "promotion_candidate_ready": False,
        "declared_frontier_count": len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS),
        "discovered_frontier_count": len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS),
        "declared_text_frontier_count": len(TEXTUAL_TOKEN_FAMILIES),
        "discovered_text_frontier_count": len(TEXTUAL_TOKEN_FAMILIES),
        "next_action": "advance-discovered-frontier",
        "next_discovered_family": "dollar_family",
        "next_discovered_kind": "DOLLAR",
        "next_discovered_partial": False,
    }
    assert capabilities.lexer_confidence_signal == {
        "scope": "lexer-support-capability-layer",
        "support_layer_stable": True,
        "support_confidence_percent": 96,
        "support_confidence_label": "high-confidence-not-99",
        "supports_99_confidence_call": False,
        "implementation_frontier_remaining": True,
        "discovered_ahead_of_declared": False,
        "next_remaining_family": "dollar_family",
        "next_remaining_kind": "DOLLAR",
        "next_remaining_partial": False,
    }
    assert capabilities.discovered_token_fixture_covered_token_kinds == (
        "ARROW",
        "COLON",
        "COMMA",
        "DEDENT",
        "DOT",
        "EMIT",
        "EOF",
        "IDENT",
        "INDENT",
        "LBRACKET",
        "LPAREN",
        "NEWLINE",
        "NUMBER",
        "PLUS",
        "RBRACKET",
        "RPAREN",
        "STAR",
    )
    assert capabilities.discovered_token_fixture_covered_token_kind_count == 17
    assert capabilities.discovered_token_fixture_token_family_coverage == tuple(
        {
            "family": family,
            "expected_kinds": tuple(expected_kinds),
            "covered_kinds": (),
            "missing_kinds": tuple(expected_kinds),
            "covered": False,
            "partial": False,
            "covered_kind_count": 0,
            "missing_kind_count": len(expected_kinds),
            "next_missing_kind": expected_kinds[0],
        }
        for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
    )
    assert capabilities.discovered_token_fixture_covered_token_family_count == 0
    assert capabilities.discovered_token_fixture_uncovered_token_family_count == len(
        DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
    )
    assert capabilities.discovered_token_fixture_coverage_blockers == tuple(
        f"{family}:missing={','.join(expected_kinds)}"
        for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
    )
    assert capabilities.discovered_token_fixture_next_coverage_blocker == (
        "dollar_family:missing=DOLLAR"
    )
    assert capabilities.discovered_token_fixture_partial_coverage_blockers == ()
    assert capabilities.discovered_token_fixture_next_partial_coverage_blocker is None
    assert capabilities.discovered_token_fixture_token_family_status_by_name == {
        family: {
            "covered": False,
            "partial": False,
            "covered_kind_count": 0,
            "missing_kind_count": len(expected_kinds),
            "next_missing_kind": expected_kinds[0],
        }
        for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
    }
    assert capabilities.discovered_token_fixture_token_family_frontier == tuple(
        {
            "family": family,
            "partial": False,
            "covered_kind_count": 0,
            "missing_kind_count": len(expected_kinds),
            "next_missing_kind": expected_kinds[0],
            "missing_kinds": tuple(expected_kinds),
        }
        for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
    )
    assert capabilities.discovered_token_fixture_textual_token_family_frontier == tuple(
        {
            "family": family,
            "partial": False,
            "covered_kind_count": 0,
            "missing_kind_count": len(expected_kinds),
            "next_missing_kind": expected_kinds[0],
            "missing_kinds": tuple(expected_kinds),
        }
        for family, expected_kinds in DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS
        if family in TEXTUAL_TOKEN_FAMILIES
    )
    assert capabilities.declared_token_fixture_validation_passed is True
    assert capabilities.declared_token_fixture_completion_done is True
    assert capabilities.declared_token_fixture_completion_blocking_reasons == ()
    assert capabilities.declared_token_fixture_completion_blocked_contract_count == 0
    assert capabilities.declared_token_fixture_completion_state_validation_failures == 0
    assert capabilities.declared_token_fixture_completion_declared_catalog_issue_count == 0
    assert len(capabilities.declared_token_fixture_comparison_sha256) == 64
    assert len(capabilities.declared_token_fixture_readiness_sha256) == 64
    assert len(capabilities.declared_token_fixture_state_sha256) == 64


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
                "source_sha256": _sha256_path(repo / "examples/native_core/hello_native.vkf"),
                "fixture_sha256": None,
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
                "source_sha256": None,
                "fixture_sha256": _sha256_path(existing_fixture),
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
                "source_sha256": None,
                "fixture_sha256": None,
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
            "source_sha256",
            "fixture_sha256",
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
    assert payload["runnable_contract_readiness_identity"] == {
        "status": "blocked",
        "ready": False,
        "usable_count": 0,
        "blocked_count": 3,
        "blocking_issue_counts": {
            "fixture-missing": 2,
            "source-missing": 2,
        },
        "readiness_sha256": payload["runnable_contract_readiness_identity"]["readiness_sha256"],
        "equality_rule": "same readiness state iff readiness_sha256 matches",
        "validation_source": "runnable_contract_readiness_validation",
    }
    assert len(payload["runnable_contract_readiness_identity"]["readiness_sha256"]) == 64
    assert payload["runnable_contract_state"] == {
        "status": "blocked",
        "ready": False,
        "validation_passed": True,
        "usable_count": 0,
        "blocked_count": 3,
        "comparison_sha256": payload["runnable_contract_set_identity"]["comparison_sha256"],
        "readiness_sha256": payload["runnable_contract_readiness_identity"]["readiness_sha256"],
        "state_sha256": payload["runnable_contract_state"]["state_sha256"],
        "consumption_rule": "consume readiness from this object; compare manifests by comparison_sha256 and readiness_sha256",
        "identity_sources": [
            "runnable_contract_set_identity",
            "runnable_contract_readiness_identity",
            "runnable_contract_readiness_validation",
        ],
    }
    assert len(payload["runnable_contract_state"]["state_sha256"]) == 64
    assert payload["runnable_contract_state_validation"] == {
        "status_matches_readiness": True,
        "ready_matches_readiness": True,
        "validation_passed_matches_readiness_validation": True,
        "comparison_sha256_matches_set_identity": True,
        "readiness_sha256_matches_readiness_identity": True,
        "validation_passed": True,
        "validation_inputs": [
            "runnable_contract_state",
            "runnable_contract_readiness",
            "runnable_contract_readiness_validation",
            "runnable_contract_set_identity",
            "runnable_contract_readiness_identity",
        ],
    }
    assert payload["external_token_contract_completion"] == {
        "done": False,
        "completion_rule": (
            "done iff runnable contract state is ready, top-level state validation passes, "
            "and declared catalog issues are empty"
        ),
        "blocking_reasons": ["runnable-contract-not-ready"],
        "blocking_counts": {
            "declared_catalog_issues": 0,
            "blocked_contracts": 3,
            "state_validation_failures": 0,
        },
        "evidence": {
            "runnable_contract_state": {
                "status": "blocked",
                "ready": False,
                "usable_count": 0,
                "blocked_count": 3,
            },
            "runnable_contract_state_validation": {
                "validation_passed": True,
            },
            "declared_catalog_issue_count": 0,
        },
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


def test_declared_fixture_manifest_payload_blocks_paired_invalid_fixture(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    out_root.mkdir()
    (out_root / "hello_native_versioned.json").write_text("{ not json", encoding="utf-8")
    specs = (
        TokenFixtureSpec(
            source_rel="examples/native_core/hello_native.vkf",
            fixture_name="hello_native_versioned.json",
        ),
    )
    payload = declared_fixture_manifest_payload(repo_root=repo, fixture_root=out_root, specs=specs)
    assert payload["summary"]["paired"] == 1
    assert payload["summary"]["external_lexer_contract_usable"] == 0
    assert payload["summary"]["external_lexer_contract_blocked"] == 1
    assert payload["fixtures_by_contract_usability"] == {
        "blocked": ["hello_native_versioned.json"],
        "usable": [],
    }
    item = payload["fixtures"][0]
    assert item["pairing_status"] == "paired"
    assert item["external_lexer_contract_usable"] is False
    assert "invalid-json" in item["validation_issues"]
    assert payload["external_token_contract_completion"]["done"] is False
    assert "runnable-contract-not-ready" in payload["external_token_contract_completion"]["blocking_reasons"]


def test_declared_fixture_contract_summary_reports_broader_discovered_token_coverage(
    tmp_path: Path,
) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    out_root.mkdir()
    for spec in TOKEN_FIXTURE_SPECS:
        fixture_name = Path(spec.fixture_name)
        (out_root / fixture_name.name).write_text(
            (TOKEN_FIXTURE_ROOT / fixture_name.name).read_text(encoding="utf-8"),
            encoding="utf-8",
        )
    (out_root / "dollar_probe_versioned.json").write_text(
        json.dumps(
            {
                "schema": "vektorflow.token_stream",
                "version": 1,
                "tokens": [
                    {
                        "kind": "DOLLAR",
                        "value": "$",
                        "line": 1,
                        "column": 1,
                        "end_line": 1,
                        "end_column": 2,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                    {
                        "kind": "STRING",
                        "value": "hello\\nworld",
                        "line": 1,
                        "column": 2,
                        "end_line": 1,
                        "end_column": 15,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                    {
                        "kind": "STRING_RAW",
                        "value": "rå",
                        "line": 1,
                        "column": 15,
                        "end_line": 1,
                        "end_column": 19,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                    {
                        "kind": "SEMICOLON",
                        "value": ";",
                        "line": 1,
                        "column": 19,
                        "end_line": 1,
                        "end_column": 20,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                    {
                        "kind": "AT",
                        "value": "@",
                        "line": 1,
                        "column": 20,
                        "end_line": 1,
                        "end_column": 21,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                    {
                        "kind": "AT_COLON",
                        "value": "@:",
                        "line": 1,
                        "column": 21,
                        "end_line": 1,
                        "end_column": 23,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                    {
                        "kind": "AT_BAR",
                        "value": "@|",
                        "line": 1,
                        "column": 23,
                        "end_line": 1,
                        "end_column": 25,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                    {
                        "kind": "PERCENT",
                        "value": "%",
                        "line": 1,
                        "column": 25,
                        "end_line": 1,
                        "end_column": 26,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                    {
                        "kind": "NEQ",
                        "value": "!=",
                        "line": 1,
                        "column": 26,
                        "end_line": 1,
                        "end_column": 28,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                    {
                        "kind": "LT",
                        "value": "<",
                        "line": 1,
                        "column": 28,
                        "end_line": 1,
                        "end_column": 29,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                    {
                        "kind": "GT",
                        "value": ">",
                        "line": 1,
                        "column": 29,
                        "end_line": 1,
                        "end_column": 30,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                    {
                        "kind": "EOF",
                        "value": None,
                        "line": 1,
                        "column": 30,
                        "end_line": 1,
                        "end_column": 30,
                        "location": {"file": "examples/native_core/hello_native.vkf"},
                    },
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    summary = declared_fixture_contract_summary(repo_root=repo, fixture_root=out_root)
    assert "DOLLAR" not in summary["covered_token_kinds"]
    assert summary["next_coverage_blocker"] == "dollar_family:missing=DOLLAR"
    assert "DOLLAR" in summary["discovered_covered_token_kinds"]
    assert "SEMICOLON" in summary["discovered_covered_token_kinds"]
    assert "AT" in summary["discovered_covered_token_kinds"]
    assert "AT_COLON" in summary["discovered_covered_token_kinds"]
    assert summary["discovered_covered_token_family_count"] == 7
    assert summary["discovered_uncovered_token_family_count"] == (
        len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS) - 7
    )
    assert summary["discovered_token_family_coverage"][0] == {
        "family": "dollar_family",
        "expected_kinds": ("DOLLAR",),
        "covered_kinds": ("DOLLAR",),
        "missing_kinds": (),
        "covered": True,
        "partial": False,
        "covered_kind_count": 1,
        "missing_kind_count": 0,
        "next_missing_kind": None,
    }
    assert summary["discovered_token_family_status_by_name"]["string_literal_family"] == {
        "covered": True,
        "partial": False,
        "covered_kind_count": 1,
        "missing_kind_count": 0,
        "next_missing_kind": None,
    }
    assert summary["discovered_token_family_status_by_name"]["string_raw_family"] == {
        "covered": True,
        "partial": False,
        "covered_kind_count": 1,
        "missing_kind_count": 0,
        "next_missing_kind": None,
    }
    assert summary["discovered_token_family_coverage"][3] == {
        "family": "semicolon_family",
        "expected_kinds": ("SEMICOLON",),
        "covered_kinds": ("SEMICOLON",),
        "missing_kinds": (),
        "covered": True,
        "partial": False,
        "covered_kind_count": 1,
        "missing_kind_count": 0,
        "next_missing_kind": None,
    }
    assert summary["discovered_token_family_coverage"][4] == {
        "family": "at_family",
        "expected_kinds": ("AT", "AT_COLON", "AT_EMIT", "AT_GT", "AT_BAR", "AT_BANG"),
        "covered_kinds": ("AT", "AT_COLON", "AT_BAR"),
        "missing_kinds": ("AT_EMIT", "AT_GT", "AT_BANG"),
        "covered": False,
        "partial": True,
        "covered_kind_count": 3,
        "missing_kind_count": 3,
        "next_missing_kind": "AT_EMIT",
    }
    assert summary["discovered_token_family_coverage"][5] == {
        "family": "at_flow_family",
        "expected_kinds": ("AT_BAR", "AT_GT", "AT_BANG"),
        "covered_kinds": ("AT_BAR",),
        "missing_kinds": ("AT_GT", "AT_BANG"),
        "covered": False,
        "partial": True,
        "covered_kind_count": 1,
        "missing_kind_count": 2,
        "next_missing_kind": "AT_GT",
    }
    assert summary["discovered_token_family_coverage"][6] == {
        "family": "comparison_family",
        "expected_kinds": ("LT", "GT"),
        "covered_kinds": ("LT", "GT"),
        "missing_kinds": (),
        "covered": True,
        "partial": False,
        "covered_kind_count": 2,
        "missing_kind_count": 0,
        "next_missing_kind": None,
    }
    assert summary["discovered_token_family_coverage"][7] == {
        "family": "remainder_inequality_family",
        "expected_kinds": ("PERCENT", "NEQ"),
        "covered_kinds": ("PERCENT", "NEQ"),
        "missing_kinds": (),
        "covered": True,
        "partial": False,
        "covered_kind_count": 2,
        "missing_kind_count": 0,
        "next_missing_kind": None,
    }
    assert summary["discovered_token_family_coverage"][9] == {
        "family": "at_colon_family",
        "expected_kinds": ("AT_COLON",),
        "covered_kinds": ("AT_COLON",),
        "missing_kinds": (),
        "covered": True,
        "partial": False,
        "covered_kind_count": 1,
        "missing_kind_count": 0,
        "next_missing_kind": None,
    }
    assert summary["next_discovered_coverage_blocker"] == "at_family:missing=AT_EMIT,AT_GT,AT_BANG"
    assert summary["discovered_partial_coverage_blockers"] == (
        "at_family:next=AT_EMIT",
        "at_flow_family:next=AT_GT",
    )
    assert summary["next_discovered_partial_coverage_blocker"] == "at_family:next=AT_EMIT"
    assert summary["token_family_status_by_name"]["at_family"] == {
        "covered": False,
        "partial": False,
        "covered_kind_count": 0,
        "missing_kind_count": 6,
        "next_missing_kind": "AT",
    }
    assert summary["discovered_token_family_status_by_name"]["at_family"] == {
        "covered": False,
        "partial": True,
        "covered_kind_count": 3,
        "missing_kind_count": 3,
        "next_missing_kind": "AT_EMIT",
    }
    assert summary["discovered_token_family_status_by_name"]["at_flow_family"] == {
        "covered": False,
        "partial": True,
        "covered_kind_count": 1,
        "missing_kind_count": 2,
        "next_missing_kind": "AT_GT",
    }
    assert summary["discovered_token_family_status_by_name"]["comparison_family"] == {
        "covered": True,
        "partial": False,
        "covered_kind_count": 2,
        "missing_kind_count": 0,
        "next_missing_kind": None,
    }
    assert summary["discovered_token_family_status_by_name"]["remainder_inequality_family"] == {
        "covered": True,
        "partial": False,
        "covered_kind_count": 2,
        "missing_kind_count": 0,
        "next_missing_kind": None,
    }
    assert summary["discovered_token_family_status_by_name"]["at_colon_family"] == {
        "covered": True,
        "partial": False,
        "covered_kind_count": 1,
        "missing_kind_count": 0,
        "next_missing_kind": None,
    }
    assert summary["token_family_frontier"][0] == {
        "family": "dollar_family",
        "partial": False,
        "covered_kind_count": 0,
        "missing_kind_count": 1,
        "next_missing_kind": "DOLLAR",
        "missing_kinds": ("DOLLAR",),
    }
    assert summary["discovered_token_family_frontier"][0] == {
        "family": "at_family",
        "partial": True,
        "covered_kind_count": 3,
        "missing_kind_count": 3,
        "next_missing_kind": "AT_EMIT",
        "missing_kinds": ("AT_EMIT", "AT_GT", "AT_BANG"),
    }
    assert summary["discovered_token_family_frontier"][1] == {
        "family": "at_flow_family",
        "partial": True,
        "covered_kind_count": 1,
        "missing_kind_count": 2,
        "next_missing_kind": "AT_GT",
        "missing_kinds": ("AT_GT", "AT_BANG"),
    }
    assert summary["textual_token_family_frontier"][0] == {
        "family": "string_literal_family",
        "partial": False,
        "covered_kind_count": 0,
        "missing_kind_count": 1,
        "next_missing_kind": "STRING",
        "missing_kinds": ("STRING",),
    }
    assert summary["textual_token_family_frontier"][1] == {
        "family": "string_raw_family",
        "partial": False,
        "covered_kind_count": 0,
        "missing_kind_count": 1,
        "next_missing_kind": "STRING_RAW",
        "missing_kinds": ("STRING_RAW",),
    }
    assert summary["discovered_textual_token_family_frontier"] == ()
    assert summary["lexer_frontier_overview"] == {
        "declared_contract": {
            "ready": True,
            "usable_count": len(TOKEN_FIXTURE_SPECS),
            "blocked_count": 0,
            "next_blocker": "dollar_family:missing=DOLLAR",
        },
        "declared_frontier": {
            "ready": False,
            "frontier_count": len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS),
            "next_family": "dollar_family",
            "next_missing_kind": "DOLLAR",
            "next_partial": False,
        },
        "declared_text_frontier": {
            "ready": False,
            "frontier_count": len(TEXTUAL_TOKEN_FAMILIES),
            "next_family": "string_literal_family",
            "next_missing_kind": "STRING",
            "next_partial": False,
        },
        "discovered_frontier": {
            "ready": False,
            "frontier_count": 5,
            "next_family": "at_family",
            "next_missing_kind": "AT_EMIT",
            "next_partial": True,
        },
        "discovered_text_frontier": {
            "ready": True,
            "frontier_count": 0,
            "next_family": None,
            "next_missing_kind": None,
            "next_partial": None,
        },
    }
    assert summary["lexer_operational_status"] == {
        "ci_declared_ready": True,
        "ci_declared_validation_passed": True,
        "discovered_ahead_of_declared": True,
        "declared_text_ready": False,
        "discovered_text_ready": True,
        "promotion_candidate_ready": False,
        "declared_frontier_count": len(DECLARED_FIXTURE_TOKEN_FAMILY_EXPECTATIONS),
        "discovered_frontier_count": 5,
        "declared_text_frontier_count": len(TEXTUAL_TOKEN_FAMILIES),
        "discovered_text_frontier_count": 0,
        "next_action": "advance-discovered-frontier",
        "next_discovered_family": "at_family",
        "next_discovered_kind": "AT_EMIT",
        "next_discovered_partial": True,
    }
    assert summary["lexer_confidence_signal"] == {
        "scope": "lexer-support-capability-layer",
        "support_layer_stable": True,
        "support_confidence_percent": 99,
        "support_confidence_label": "confidence-99-ready",
        "supports_99_confidence_call": True,
        "implementation_frontier_remaining": True,
        "discovered_ahead_of_declared": True,
        "next_remaining_family": "at_family",
        "next_remaining_kind": "AT_EMIT",
        "next_remaining_partial": True,
    }


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
                "source_sha256": _sha256_path(repo / spec.source_rel),
                "fixture_sha256": _sha256_path(TOKEN_FIXTURE_ROOT / spec.fixture_name),
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
            "source_sha256",
            "fixture_sha256",
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
    assert payload["runnable_contract_readiness_identity"] == {
        "status": "all-runnable",
        "ready": True,
        "usable_count": len(TOKEN_FIXTURE_SPECS),
        "blocked_count": 0,
        "blocking_issue_counts": {},
        "readiness_sha256": payload["runnable_contract_readiness_identity"]["readiness_sha256"],
        "equality_rule": "same readiness state iff readiness_sha256 matches",
        "validation_source": "runnable_contract_readiness_validation",
    }
    assert len(payload["runnable_contract_readiness_identity"]["readiness_sha256"]) == 64
    assert payload["runnable_contract_state"] == {
        "status": "all-runnable",
        "ready": True,
        "validation_passed": True,
        "usable_count": len(TOKEN_FIXTURE_SPECS),
        "blocked_count": 0,
        "comparison_sha256": payload["runnable_contract_set_identity"]["comparison_sha256"],
        "readiness_sha256": payload["runnable_contract_readiness_identity"]["readiness_sha256"],
        "state_sha256": payload["runnable_contract_state"]["state_sha256"],
        "consumption_rule": "consume readiness from this object; compare manifests by comparison_sha256 and readiness_sha256",
        "identity_sources": [
            "runnable_contract_set_identity",
            "runnable_contract_readiness_identity",
            "runnable_contract_readiness_validation",
        ],
    }
    assert len(payload["runnable_contract_state"]["state_sha256"]) == 64
    assert payload["runnable_contract_state_validation"] == {
        "status_matches_readiness": True,
        "ready_matches_readiness": True,
        "validation_passed_matches_readiness_validation": True,
        "comparison_sha256_matches_set_identity": True,
        "readiness_sha256_matches_readiness_identity": True,
        "validation_passed": True,
        "validation_inputs": [
            "runnable_contract_state",
            "runnable_contract_readiness",
            "runnable_contract_readiness_validation",
            "runnable_contract_set_identity",
            "runnable_contract_readiness_identity",
        ],
    }
    assert payload["external_token_contract_completion"] == {
        "done": True,
        "completion_rule": (
            "done iff runnable contract state is ready, top-level state validation passes, "
            "and declared catalog issues are empty"
        ),
        "blocking_reasons": [],
        "blocking_counts": {
            "declared_catalog_issues": 0,
            "blocked_contracts": 0,
            "state_validation_failures": 0,
        },
        "evidence": {
            "runnable_contract_state": {
                "status": "all-runnable",
                "ready": True,
                "usable_count": len(TOKEN_FIXTURE_SPECS),
                "blocked_count": 0,
            },
            "runnable_contract_state_validation": {
                "validation_passed": True,
            },
            "declared_catalog_issue_count": 0,
        },
    }
