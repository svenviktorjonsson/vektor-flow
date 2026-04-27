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
        "with_validation_issues": 0,
        "declared_catalog_issues": 0,
    }
    assert payload["fixtures_by_pairing_status"] == {
        "paired": [spec.fixture_name for spec in TOKEN_FIXTURE_SPECS]
    }
    for spec, item in zip(TOKEN_FIXTURE_SPECS, payload["fixtures"], strict=True):
        assert item["pairing_status"] == "paired"
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
        "with_validation_issues": 3,
        "declared_catalog_issues": 0,
    }
    assert payload["fixtures_by_pairing_status"] == {
        "fixture-missing": ["hello_native_versioned.json"],
        "source-missing": ["source_missing_versioned.json"],
        "unpaired": ["missing_both_versioned.json"],
    }
    by_name = {item["fixture_name"]: item for item in payload["fixtures"]}
    assert by_name["hello_native_versioned.json"]["pairing_status"] == "fixture-missing"
    assert by_name["hello_native_versioned.json"]["external_lexer_contract"]["filename_label"] == (
        "examples/native_core/hello_native.vkf"
    )
    assert by_name["source_missing_versioned.json"]["pairing_status"] == "source-missing"
    assert by_name["missing_both_versioned.json"]["pairing_status"] == "unpaired"


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
    assert payload["fixtures_by_pairing_status"] == {
        "paired": [spec.fixture_name for spec in TOKEN_FIXTURE_SPECS]
    }
