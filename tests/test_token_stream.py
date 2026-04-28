from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from vektorflow.lexer import tokenize
from vektorflow.native_lexer_fixtures import (
    DeclaredFixtureCatalogIssue,
    TOKEN_FIXTURE_MANIFEST_SCHEMA,
    TOKEN_FIXTURE_MANIFEST_VERSION,
    TOKEN_FIXTURE_SPECS,
    TOKEN_FIXTURE_REPORT_SCHEMA,
    TOKEN_FIXTURE_REPORT_VERSION,
    TokenFixtureSpec,
    canonical_source_rel,
    declared_fixture_manifest_payload,
    declared_fixture_catalog_issues,
    declared_fixture_inventory,
    declared_fixture_names,
    default_fixture_root,
    discovered_fixture_report,
    discovered_fixture_names,
    fixture_status_payload,
    fixture_status_report,
    fixture_drift_report,
    regenerate_token_fixtures,
    unmanaged_fixture_names,
)
from vektorflow.native_lexer_proto import (
    lex_file_to_payload,
    lex_to_payload,
    stable_source_label,
)
from vektorflow.parser import parse_module, parse_token_stream_json, parse_tokens
from vektorflow.token_stream import (
    TOKEN_STREAM_SCHEMA,
    TOKEN_STREAM_VERSION,
    token_stream_payload_from_json,
    token_stream_to_json,
    tokens_from_json,
    tokens_to_json,
    write_versioned_token_stream,
)
from vektorflow.tokens import EOF, NEWLINE, Token
from vektorflow.errors import SourceLocation
from tests.token_stream_fixture_helper import (
    BAD_TOP_LEVEL_TOKEN_STREAM_CASES,
    INVALID_TOKEN_STREAM_ENVELOPE_CASES,
    MALFORMED_TOKEN_ENTRY_CASES,
    TOKEN_FIXTURE_ROOT,
    assert_fixture_boundary_parity,
    assert_fixture_parses_like_source,
    assert_loader_parser_cli_reject_token_stream,
    assert_loader_rejects_token_stream,
    assert_loader_rejects_token_stream_object,
    assert_loader_parser_cli_reject_token_stream_object,
    loader_rejects_token_stream_object_message,
    parser_surface_rejects_token_stream_object_message,
    assert_parser_surface_rejects_token_stream_object,
    parser_rejects_token_stream_object_message,
    assert_parser_rejects_token_stream,
    assert_parser_rejects_token_stream_object,
    iter_token_fixture_cases,
    native_core_fixture_cases,
    token_fixture_case,
)


def test_token_stream_roundtrip_preserves_dot_adjacency_payload() -> None:
    toks = tokenize("a.true\nx. y: [1,2]\n", filename="<test>")
    payload = tokens_to_json(toks)
    restored = tokens_from_json(payload)
    assert [(t.kind, t.value, t.location.line, t.location.column) for t in restored] == [
        (t.kind, t.value, t.location.line, t.location.column) for t in toks
    ]


def test_parse_tokens_matches_parse_module_for_same_source() -> None:
    src = "v : [1,2]\nv. value: [3,4]\n:: value.\n"
    direct = parse_module(src, filename="<test>")
    via_tokens = parse_tokens(tokenize(src, filename="<test>"))
    assert repr(via_tokens) == repr(direct)


@pytest.mark.parametrize(
    "tokens, expected",
    [
        (
            lambda: [t for t in tokenize(":: 1\n", filename="<bad>") if t.kind != EOF],
            "missing EOF terminator",
        ),
        (
            lambda: [
                *tokenize(":: 1\n", filename="<bad>")[:-1],
                Token(EOF, None, SourceLocation("<bad>", 2, 1)),
                Token(NEWLINE, None, SourceLocation("<bad>", 2, 2)),
            ],
            "EOF must appear exactly once at end of stream",
        ),
        (
            lambda: [
                *tokenize(":: 1\n", filename="<bad>")[:-1],
                Token(EOF, None, SourceLocation("<other>", 1, 6)),
            ],
            "token locations must all use the same file",
        ),
    ],
)
def test_parse_tokens_rejects_invalid_token_sequences(tokens, expected: str) -> None:
    with pytest.raises(ValueError, match=expected):
        parse_tokens(tokens())


def test_token_json_has_stable_top_level_shape() -> None:
    toks = tokenize(":: 3\n", filename="<test>")
    payload = json.loads(tokens_to_json(toks))
    assert list(payload.keys()) == ["tokens"]
    assert payload["tokens"][0]["kind"] == "EMIT"
    assert set(payload["tokens"][0]["location"].keys()) == {"file", "line", "column"}


def test_versioned_token_stream_json_roundtrips_foreign_payload() -> None:
    payload = {
        "schema": TOKEN_STREAM_SCHEMA,
        "version": TOKEN_STREAM_VERSION,
        "tokens": [
            {
                "kind": "IDENT",
                "value": "vec",
                "location": {"file": "<foreign>", "line": 1, "column": 1},
            },
            {
                "kind": "DOT",
                "value": [True, True],
                "location": {"file": "<foreign>", "line": 1, "column": 4},
            },
            {
                "kind": "IDENT",
                "value": "x",
                "location": {"file": "<foreign>", "line": 1, "column": 5},
            },
            {
                "kind": "EOF",
                "value": None,
                "location": {"file": "<foreign>", "line": 1, "column": 6},
            },
        ],
    }
    restored = tokens_from_json(json.dumps(payload))
    assert [(t.kind, t.value, t.location.file) for t in restored] == [
        ("IDENT", "vec", "<foreign>"),
        ("DOT", (True, True), "<foreign>"),
        ("IDENT", "x", "<foreign>"),
        ("EOF", None, "<foreign>"),
    ]


def test_versioned_token_stream_json_includes_schema_metadata() -> None:
    toks = tokenize(":: 3\n", filename="<test>")
    payload = json.loads(token_stream_to_json(toks))
    assert payload["schema"] == TOKEN_STREAM_SCHEMA
    assert payload["version"] == TOKEN_STREAM_VERSION
    assert isinstance(payload["tokens"], list)


@pytest.mark.parametrize("payload, expected", INVALID_TOKEN_STREAM_ENVELOPE_CASES)
def test_token_stream_json_rejects_invalid_envelopes(payload: dict[str, object], expected: str) -> None:
    assert_loader_rejects_token_stream_object(payload, expected)


@pytest.mark.parametrize("payload, expected", INVALID_TOKEN_STREAM_ENVELOPE_CASES)
def test_parse_token_stream_json_rejects_invalid_envelopes(payload: dict[str, object], expected: str) -> None:
    assert_parser_rejects_token_stream_object(payload, expected)


@pytest.mark.parametrize("payload, expected", INVALID_TOKEN_STREAM_ENVELOPE_CASES)
def test_loader_parser_cli_error_surfaces_stay_aligned_for_invalid_envelopes(
    tmp_path: Path, payload: dict[str, object], expected: str
) -> None:
    assert_loader_parser_cli_reject_token_stream_object(
        tmp_path,
        payload,
        loader_expected=expected,
        parser_expected=expected,
    )


@pytest.mark.parametrize(
    "payload_text, expected",
    BAD_TOP_LEVEL_TOKEN_STREAM_CASES,
)
def test_parse_token_stream_json_rejects_bad_top_level_json(payload_text: str, expected: str) -> None:
    assert_parser_rejects_token_stream(payload_text, expected)


@pytest.mark.parametrize(
    "payload_text, expected",
    BAD_TOP_LEVEL_TOKEN_STREAM_CASES,
)
def test_tokens_from_json_rejects_bad_top_level_json(payload_text: str, expected: str) -> None:
    assert_loader_rejects_token_stream(payload_text, expected)


@pytest.mark.parametrize(
    "payload_text, expected",
    BAD_TOP_LEVEL_TOKEN_STREAM_CASES,
)
def test_loader_parser_cli_error_surfaces_stay_aligned_for_bad_top_level_json(
    tmp_path: Path, payload_text: str, expected: str
) -> None:
    assert_loader_parser_cli_reject_token_stream(
        tmp_path,
        payload_text,
        loader_expected=expected,
        parser_expected=expected,
    )


def test_versioned_fixture_parses_like_source_golden() -> None:
    case = token_fixture_case("versioned_loose_dot_bind.json")
    assert_fixture_boundary_parity(case)


def test_legacy_fixture_parses_like_source_golden() -> None:
    case = token_fixture_case("legacy_singleton_tuple_type.json")
    assert_fixture_boundary_parity(case)


@pytest.mark.parametrize("payload, expected", MALFORMED_TOKEN_ENTRY_CASES)
def test_parse_token_stream_json_rejects_malformed_token_entries(
    payload: dict[str, object], expected: str
) -> None:
    assert_parser_rejects_token_stream_object(payload, expected)


@pytest.mark.parametrize("payload, expected", MALFORMED_TOKEN_ENTRY_CASES)
def test_tokens_from_json_rejects_malformed_token_entries(payload: dict[str, object], expected: str) -> None:
    assert_loader_rejects_token_stream_object(payload, "invalid token entry")


@pytest.mark.parametrize("payload, expected", MALFORMED_TOKEN_ENTRY_CASES)
def test_load_tokens_from_json_normalizes_parser_surface_malformed_entries(
    payload: dict[str, object], expected: str
) -> None:
    assert_parser_surface_rejects_token_stream_object(payload, expected)


@pytest.mark.parametrize("payload, _expected", MALFORMED_TOKEN_ENTRY_CASES)
def test_loader_parser_cli_error_surfaces_stay_aligned_for_malformed_entries(
    tmp_path: Path, payload: dict[str, object], _expected: str
) -> None:
    assert_loader_parser_cli_reject_token_stream_object(
        tmp_path,
        payload,
        loader_expected="invalid token entry",
        parser_expected="malformed token entry",
    )


@pytest.mark.parametrize("payload, _expected", MALFORMED_TOKEN_ENTRY_CASES)
def test_parser_surface_strips_loader_prefix_for_malformed_entries(
    payload: dict[str, object], _expected: str
) -> None:
    loader_msg = loader_rejects_token_stream_object_message(payload)
    parser_msg = parser_surface_rejects_token_stream_object_message(payload)
    assert loader_msg.startswith("invalid token entry:")
    assert parser_msg.startswith("malformed token entry:")
    assert "invalid token entry:" not in parser_msg


def test_versioned_payload_helper_matches_json_output() -> None:
    toks = tokenize("v. value: [3,4]\n", filename="<test>")
    payload = lex_to_payload("v. value: [3,4]\n", filename="<test>")
    assert payload["schema"] == TOKEN_STREAM_SCHEMA
    assert payload["version"] == TOKEN_STREAM_VERSION
    assert payload["tokens"] == token_stream_payload_from_json(token_stream_to_json(toks))["tokens"]


def test_write_versioned_token_stream_roundtrips(tmp_path: Path) -> None:
    toks = tokenize(":: 3\n", filename="<test>")
    out = tmp_path / "tokens.json"
    write_versioned_token_stream(toks, out)
    payload = token_stream_payload_from_json(out.read_text(encoding="utf-8"))
    assert payload["schema"] == TOKEN_STREAM_SCHEMA
    assert [(t.kind, t.value) for t in tokens_from_json(out.read_text(encoding="utf-8"))] == [
        (t.kind, t.value) for t in toks
    ]


def test_native_lexer_proto_emits_versioned_payload_from_file(tmp_path: Path) -> None:
    source = tmp_path / "sample.vkf"
    source.write_text("vec.(3+2)\n", encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, "-m", "vektorflow.native_lexer_proto", str(source)],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = token_stream_payload_from_json(proc.stdout)
    assert payload["schema"] == TOKEN_STREAM_SCHEMA
    assert payload["tokens"][0]["kind"] == "IDENT"
    assert payload["tokens"][1]["kind"] == "DOT"


def test_native_lexer_proto_emits_versioned_payload_from_stdin() -> None:
    proc = subprocess.run(
        [sys.executable, "-m", "vektorflow.native_lexer_proto", "-"],
        cwd=Path(__file__).resolve().parents[1],
        input="1.2E+4\n",
        capture_output=True,
        text=True,
        check=True,
    )
    payload = token_stream_payload_from_json(proc.stdout)
    assert payload["schema"] == TOKEN_STREAM_SCHEMA
    assert payload["tokens"][0]["kind"] == "NUMBER"
    assert payload["tokens"][0]["value"] == 1.2e4


def test_native_lexer_proto_accepts_filename_label_for_stdin() -> None:
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "vektorflow.native_lexer_proto",
            "-",
            "--filename-label",
            "examples/native_core/hello_native.vkf",
        ],
        cwd=Path(__file__).resolve().parents[1],
        input=":: 3\n",
        capture_output=True,
        text=True,
        check=True,
    )
    payload = token_stream_payload_from_json(proc.stdout)
    assert payload["tokens"][0]["location"]["file"] == "examples/native_core/hello_native.vkf"


def test_native_lexer_proto_accepts_filename_label_for_file_input(tmp_path: Path) -> None:
    source = tmp_path / "sample.vkf"
    source.write_text("vec.(3+2)\n", encoding="utf-8")
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "vektorflow.native_lexer_proto",
            str(source),
            "--filename-label",
            "fixtures/generated/sample.vkf",
        ],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = token_stream_payload_from_json(proc.stdout)
    assert payload["tokens"][0]["location"]["file"] == "fixtures/generated/sample.vkf"


def test_stable_source_label_prefers_repo_relative_path() -> None:
    repo = Path(__file__).resolve().parents[1]
    source = repo / "examples" / "native_core" / "hello_native.vkf"
    assert stable_source_label(source, root=repo) == "examples/native_core/hello_native.vkf"


@pytest.mark.parametrize("spec", TOKEN_FIXTURE_SPECS)
def test_native_core_fixture_matches_lex_file_payload(spec) -> None:
    repo = Path(__file__).resolve().parents[1]
    source = repo / Path(spec.source_rel)
    payload = lex_file_to_payload(source, root=repo)
    fixture_payload = token_stream_payload_from_json(token_fixture_case(spec.fixture_name).read_payload_text())
    assert payload == fixture_payload


@pytest.mark.parametrize("case", native_core_fixture_cases(), ids=lambda case: case.name)
def test_native_core_fixture_parses_like_source(case) -> None:
    assert_fixture_boundary_parity(case)


def test_all_token_stream_fixtures_with_sources_parse_like_paired_source() -> None:
    for case in iter_token_fixture_cases():
        assert_fixture_boundary_parity(case)


def test_regenerate_token_fixtures_matches_checked_in_samples(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    written = regenerate_token_fixtures(repo_root=repo, fixture_root=out_root)
    assert {path.name for path in written} == {spec.fixture_name for spec in TOKEN_FIXTURE_SPECS}
    assert default_fixture_root(repo) == TOKEN_FIXTURE_ROOT
    for case in native_core_fixture_cases():
        generated = (out_root / case.name).read_text(encoding="utf-8")
        checked_in = case.read_payload_text()
        assert generated == checked_in


def test_fixture_drift_report_is_empty_for_checked_in_samples() -> None:
    repo = Path(__file__).resolve().parents[1]
    assert fixture_drift_report(repo_root=repo, fixture_root=TOKEN_FIXTURE_ROOT) == []


def test_fixture_status_report_marks_checked_in_samples_current() -> None:
    repo = Path(__file__).resolve().parents[1]
    statuses = fixture_status_report(repo_root=repo, fixture_root=TOKEN_FIXTURE_ROOT)
    assert {item.fixture_name for item in statuses} == {spec.fixture_name for spec in TOKEN_FIXTURE_SPECS}
    assert {item.status for item in statuses} == {"current"}
    for item in statuses:
        assert item.expected_source_label == item.source_rel
        assert item.declared_source_label == item.source_rel
        assert item.source_label_matches is True
        assert item.token_count > 0
        assert item.payload_sha256 is not None
        assert len(item.payload_sha256) == 64


def test_fixture_drift_report_detects_stale_and_missing_samples(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    regenerate_token_fixtures(repo_root=repo, fixture_root=out_root)
    stale = out_root / TOKEN_FIXTURE_SPECS[0].fixture_name
    stale.write_text('{"schema":"wrong","version":1,"tokens":[]}\n', encoding="utf-8")
    missing = out_root / TOKEN_FIXTURE_SPECS[1].fixture_name
    missing.unlink()
    drift = fixture_drift_report(repo_root=repo, fixture_root=out_root)
    assert f"{TOKEN_FIXTURE_SPECS[0].fixture_name}: stale" in drift
    assert f"{TOKEN_FIXTURE_SPECS[1].fixture_name}: missing" in drift


def test_fixture_status_payload_summarizes_current_and_drifted_counts(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    regenerate_token_fixtures(repo_root=repo, fixture_root=out_root)
    (out_root / TOKEN_FIXTURE_SPECS[0].fixture_name).write_text(
        '{"schema":"wrong","version":1,"tokens":[]}\n',
        encoding="utf-8",
    )
    (out_root / TOKEN_FIXTURE_SPECS[1].fixture_name).unlink()
    payload = fixture_status_payload(repo_root=repo, fixture_root=out_root)
    assert payload["schema"] == TOKEN_FIXTURE_REPORT_SCHEMA
    assert payload["version"] == TOKEN_FIXTURE_REPORT_VERSION
    assert {key for key in payload["bundle_sha256"]} == {
        "declared_specs",
        "declared_catalog_issues",
        "managed_fixtures",
        "discovered_fixtures",
        "validation_issues",
    }
    assert payload["summary"] == {
        "total": len(TOKEN_FIXTURE_SPECS),
        "current": 1,
        "missing": 1,
        "stale": 1,
        "source_missing": 0,
        "unmanaged": 0,
        "discovered": len(payload["discovered_fixture_names"]),
        "canonical_versioned": 1,
        "versioned_envelopes": 1,
        "legacy_envelopes": 0,
        "other_envelopes": 1,
        "invalid_json": 0,
        "invalid_shape": 0,
        "with_validation_issues": 1,
        "declared_catalog_issues": 0,
    }
    status_by_name = {item["fixture_name"]: item["status"] for item in payload["fixtures"]}
    assert status_by_name[TOKEN_FIXTURE_SPECS[0].fixture_name] == "stale"
    assert status_by_name[TOKEN_FIXTURE_SPECS[1].fixture_name] == "missing"


def test_native_lexer_fixtures_module_regenerates_all_checked_in_samples(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "vektorflow.native_lexer_fixtures",
            "--repo-root",
            str(repo),
            "--fixture-root",
            str(out_root),
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    )
    listed = {Path(line).name for line in proc.stdout.splitlines() if line.strip()}
    assert listed == {spec.fixture_name for spec in TOKEN_FIXTURE_SPECS}
    for case in native_core_fixture_cases():
        generated = (out_root / case.name).read_text(encoding="utf-8")
        checked_in = case.read_payload_text()
        assert generated == checked_in


def test_native_lexer_fixtures_module_defaults_to_canonical_versioned_form(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "vektorflow.native_lexer_fixtures",
            "--repo-root",
            str(repo),
            "--fixture-root",
            str(out_root),
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    )
    for case in native_core_fixture_cases():
        raw = json.loads((out_root / case.name).read_text(encoding="utf-8"))
        assert list(raw.keys()) == ["schema", "version", "tokens"]
        assert raw["schema"] == TOKEN_STREAM_SCHEMA
        assert raw["version"] == TOKEN_STREAM_VERSION


def test_native_lexer_fixtures_module_check_succeeds_for_current_samples() -> None:
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
            "--check",
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0
    assert proc.stdout.strip() == ""


def test_native_lexer_fixtures_module_check_reports_drift(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    regenerate_token_fixtures(repo_root=repo, fixture_root=out_root)
    stale = out_root / TOKEN_FIXTURE_SPECS[0].fixture_name
    stale.write_text('{"schema":"wrong","version":1,"tokens":[]}\n', encoding="utf-8")
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "vektorflow.native_lexer_fixtures",
            "--repo-root",
            str(repo),
            "--fixture-root",
            str(out_root),
            "--check",
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 1
    assert f"{TOKEN_FIXTURE_SPECS[0].fixture_name}: stale" in proc.stdout


def test_native_lexer_fixtures_module_report_emits_json_summary() -> None:
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
            "--report",
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(proc.stdout)
    assert payload["schema"] == TOKEN_FIXTURE_REPORT_SCHEMA
    assert payload["version"] == TOKEN_FIXTURE_REPORT_VERSION
    assert payload["declared_specs"] == [
        {
            "source_rel": spec.source_rel,
            "fixture_name": spec.fixture_name,
            "fixture_path": str(TOKEN_FIXTURE_ROOT / spec.fixture_name),
            "expected_source_label": spec.source_rel,
        }
        for spec in TOKEN_FIXTURE_SPECS
    ]
    assert payload["declared_catalog_issues"] == []
    for value in payload["bundle_sha256"].values():
        assert len(value) == 64
    assert payload["summary"] == {
        "total": len(TOKEN_FIXTURE_SPECS),
        "current": len(TOKEN_FIXTURE_SPECS),
        "missing": 0,
        "stale": 0,
        "source_missing": 0,
        "unmanaged": 2,
        "discovered": len(discovered_fixture_names(TOKEN_FIXTURE_ROOT)),
        "canonical_versioned": len(TOKEN_FIXTURE_SPECS) + 1,
        "versioned_envelopes": len(TOKEN_FIXTURE_SPECS) + 1,
        "legacy_envelopes": 1,
        "other_envelopes": 0,
        "invalid_json": 0,
        "invalid_shape": 0,
        "with_validation_issues": 1,
        "declared_catalog_issues": 0,
    }
    assert {item["fixture_name"] for item in payload["fixtures"]} == {
        spec.fixture_name for spec in TOKEN_FIXTURE_SPECS
    }
    assert payload["discovered_fixture_names"] == discovered_fixture_names(TOKEN_FIXTURE_ROOT)
    assert payload["unmanaged_fixtures"] == unmanaged_fixture_names(fixture_root=TOKEN_FIXTURE_ROOT)
    assert payload["managed_fixtures_by_status"] == {
        "current": sorted(spec.fixture_name for spec in TOKEN_FIXTURE_SPECS)
    }
    assert payload["discovered_fixtures_by_envelope_kind"] == {
        "legacy": ["legacy_singleton_tuple_type.json"],
        "versioned": sorted(
            [
                "hello_native_versioned.json",
                "numeric_native_versioned.json",
                "vectors_native_versioned.json",
                "versioned_loose_dot_bind.json",
            ]
        ),
    }
    assert payload["discovered_fixtures_by_pairing_mode"] == {
        "declared-label": sorted(
            [
                "hello_native_versioned.json",
                "numeric_native_versioned.json",
                "vectors_native_versioned.json",
            ]
        ),
        "sibling-vkf": sorted(
            [
                "legacy_singleton_tuple_type.json",
                "versioned_loose_dot_bind.json",
            ]
        ),
    }
    assert payload["validation_issue_counts"] == {
        "legacy-envelope": 1,
        "not-canonical-versioned": 1,
    }
    assert payload["fixtures_with_validation_issues"] == [
        {
            "fixture_name": "legacy_singleton_tuple_type.json",
            "issues": ["legacy-envelope", "not-canonical-versioned"],
        }
    ]
    discovered_by_name = {item["fixture_name"]: item for item in payload["discovered_fixtures"]}
    assert discovered_by_name["hello_native_versioned.json"]["managed"] is True
    assert discovered_by_name["hello_native_versioned.json"]["parseable_json"] is True
    assert discovered_by_name["hello_native_versioned.json"]["envelope_kind"] == "versioned"
    assert discovered_by_name["hello_native_versioned.json"]["canonical_versioned"] is True
    assert discovered_by_name["hello_native_versioned.json"]["pairing_mode"] == "declared-label"
    assert len(discovered_by_name["hello_native_versioned.json"]["paired_source_sha256"]) == 64
    assert discovered_by_name["hello_native_versioned.json"]["validation_issues"] == []
    assert discovered_by_name["legacy_singleton_tuple_type.json"]["managed"] is False
    assert discovered_by_name["legacy_singleton_tuple_type.json"]["parseable_json"] is True
    assert discovered_by_name["legacy_singleton_tuple_type.json"]["envelope_kind"] == "legacy"
    assert discovered_by_name["legacy_singleton_tuple_type.json"]["canonical_versioned"] is False
    assert discovered_by_name["legacy_singleton_tuple_type.json"]["pairing_mode"] == "sibling-vkf"
    assert discovered_by_name["legacy_singleton_tuple_type.json"]["paired_source_exists"] is True
    assert len(discovered_by_name["legacy_singleton_tuple_type.json"]["paired_source_sha256"]) == 64
    assert discovered_by_name["legacy_singleton_tuple_type.json"]["validation_issues"] == [
        "legacy-envelope",
        "not-canonical-versioned",
    ]
    for item in payload["fixtures"]:
        assert item["source_path"].endswith(item["source_rel"].replace("/", "\\"))
        assert item["expected_source_label"] == item["source_rel"]
        assert item["declared_source_label"] == item["source_rel"]
        assert item["source_label_matches"] is True
        assert len(item["source_sha256"]) == 64
        assert item["token_count"] > 0
        assert len(item["payload_sha256"]) == 64


def test_native_lexer_fixtures_module_report_emits_drifted_statuses(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    regenerate_token_fixtures(repo_root=repo, fixture_root=out_root)
    baseline = fixture_status_payload(repo_root=repo, fixture_root=out_root)
    (out_root / TOKEN_FIXTURE_SPECS[0].fixture_name).write_text(
        '{"schema":"wrong","version":1,"tokens":[]}\n',
        encoding="utf-8",
    )
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "vektorflow.native_lexer_fixtures",
            "--repo-root",
            str(repo),
            "--fixture-root",
            str(out_root),
            "--report",
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(proc.stdout)
    status_by_name = {item["fixture_name"]: item["status"] for item in payload["fixtures"]}
    assert status_by_name[TOKEN_FIXTURE_SPECS[0].fixture_name] == "stale"
    assert payload["managed_fixtures_by_status"] == {
        "current": sorted([TOKEN_FIXTURE_SPECS[1].fixture_name, TOKEN_FIXTURE_SPECS[2].fixture_name]),
        "stale": [TOKEN_FIXTURE_SPECS[0].fixture_name],
    }
    assert (
        payload["bundle_sha256"]["managed_fixtures"]
        != baseline["bundle_sha256"]["managed_fixtures"]
    )
    assert (
        payload["bundle_sha256"]["discovered_fixtures"]
        != baseline["bundle_sha256"]["discovered_fixtures"]
    )
    assert (
        payload["bundle_sha256"]["validation_issues"]
        != baseline["bundle_sha256"]["validation_issues"]
    )


def test_fixture_discovery_helpers_surface_unmanaged_checked_in_fixtures() -> None:
    declared = declared_fixture_names()
    discovered = discovered_fixture_names(TOKEN_FIXTURE_ROOT)
    unmanaged = unmanaged_fixture_names(fixture_root=TOKEN_FIXTURE_ROOT)
    assert {spec.fixture_name for spec in TOKEN_FIXTURE_SPECS} == declared
    assert set(unmanaged).issubset(set(discovered))
    assert "legacy_singleton_tuple_type.json" in unmanaged
    assert "versioned_loose_dot_bind.json" in unmanaged


def test_declared_fixture_inventory_lists_canonical_fixture_targets() -> None:
    inventory = declared_fixture_inventory(fixture_root=TOKEN_FIXTURE_ROOT)
    assert inventory == [
        {
            "source_rel": spec.source_rel,
            "fixture_name": spec.fixture_name,
            "fixture_path": str(TOKEN_FIXTURE_ROOT / spec.fixture_name),
            "expected_source_label": spec.source_rel,
        }
        for spec in TOKEN_FIXTURE_SPECS
    ]


def test_declared_fixture_catalog_issues_detect_duplicate_catalog_entries() -> None:
    specs = (
        TOKEN_FIXTURE_SPECS[0],
        TokenFixtureSpec(
            source_rel=TOKEN_FIXTURE_SPECS[0].source_rel.replace("/", "\\"),
            fixture_name="hello_native_duplicate_versioned.json",
        ),
        TokenFixtureSpec(
            source_rel="examples/native_core/other_source.vkf",
            fixture_name=TOKEN_FIXTURE_SPECS[0].fixture_name,
        ),
    )
    issues = declared_fixture_catalog_issues(specs)
    assert issues == [
        DeclaredFixtureCatalogIssue(
            issue="duplicate-source-rel",
            value=TOKEN_FIXTURE_SPECS[0].source_rel,
            fixture_names=(
                "hello_native_duplicate_versioned.json",
                TOKEN_FIXTURE_SPECS[0].fixture_name,
            ),
        ),
        DeclaredFixtureCatalogIssue(
            issue="duplicate-fixture-name",
            value=TOKEN_FIXTURE_SPECS[0].fixture_name,
            fixture_names=(
                TOKEN_FIXTURE_SPECS[0].source_rel,
                "examples/native_core/other_source.vkf",
            ),
        ),
        DeclaredFixtureCatalogIssue(
            issue="noncanonical-source-rel",
            value=TOKEN_FIXTURE_SPECS[0].source_rel,
            fixture_names=(
                TOKEN_FIXTURE_SPECS[0].source_rel.replace("/", "\\"),
            ),
        ),
    ]


def test_canonical_source_rel_normalizes_manifest_paths() -> None:
    assert canonical_source_rel(r".\examples\native_core\hello_native.vkf") == "examples/native_core/hello_native.vkf"


def test_declared_fixture_inventory_uses_canonical_source_labels_for_noncanonical_specs() -> None:
    inventory = declared_fixture_inventory(
        fixture_root=TOKEN_FIXTURE_ROOT,
        specs=(
            TokenFixtureSpec(
                source_rel=r".\examples\native_core\hello_native.vkf",
                fixture_name="hello_native_versioned.json",
            ),
        ),
    )
    assert inventory == [
        {
            "source_rel": r".\examples\native_core\hello_native.vkf",
            "fixture_name": "hello_native_versioned.json",
            "fixture_path": str(TOKEN_FIXTURE_ROOT / "hello_native_versioned.json"),
            "expected_source_label": "examples/native_core/hello_native.vkf",
        }
    ]


def test_declared_fixture_manifest_payload_emits_machine_readable_declared_contract() -> None:
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
    assert len(payload["bundle_sha256"]) == 64
    assert payload["declared_catalog_issues"] == []
    assert payload["validation_issue_counts"] == {}
    assert payload["fixtures_with_validation_issues"] == []
    assert payload["fixtures"] == [
        {
            "source_rel": spec.source_rel,
            "canonical_source_rel": spec.source_rel,
            "fixture_name": spec.fixture_name,
            "expected_source_label": spec.source_rel,
            "source_path": str(repo / spec.source_rel),
            "fixture_path": str(TOKEN_FIXTURE_ROOT / spec.fixture_name),
            "source_exists": True,
            "fixture_exists": True,
            "source_sha256": payload["fixtures"][index]["source_sha256"],
            "fixture_sha256": payload["fixtures"][index]["fixture_sha256"],
            "pairing_status": "paired",
                "external_lexer_contract": {
                    "source_path": str(repo / spec.source_rel),
                    "filename_label": spec.source_rel,
                    "fixture_path": str(TOKEN_FIXTURE_ROOT / spec.fixture_name),
                    "source_sha256": payload["fixtures"][index]["source_sha256"],
                    "fixture_sha256": payload["fixtures"][index]["fixture_sha256"],
                },
                "external_lexer_contract_usable": True,
                "validation_issues": [],
            }
            for index, spec in enumerate(TOKEN_FIXTURE_SPECS)
        ]
    for item in payload["fixtures"]:
        assert len(item["source_sha256"]) == 64
        assert len(item["fixture_sha256"]) == 64


def test_declared_fixture_manifest_payload_surfaces_noncanonical_and_missing_entries(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    specs = (
        TokenFixtureSpec(
            source_rel=r".\examples\native_core\hello_native.vkf",
            fixture_name="hello_native_versioned.json",
        ),
        TokenFixtureSpec(
            source_rel="examples/native_core/missing_fixture_source.vkf",
            fixture_name="missing_fixture_source_versioned.json",
        ),
    )
    payload = declared_fixture_manifest_payload(repo_root=repo, fixture_root=out_root, specs=specs)
    assert payload["summary"] == {
        "total": 2,
        "source_present": 1,
        "fixture_present": 0,
        "paired": 0,
        "fixture_missing": 1,
        "source_missing": 0,
        "unpaired": 1,
        "external_lexer_contract_usable": 0,
        "external_lexer_contract_blocked": 2,
        "with_validation_issues": 2,
        "declared_catalog_issues": 1,
    }
    assert payload["declared_catalog_issues"] == [
        {
            "issue": "noncanonical-source-rel",
            "value": "examples/native_core/hello_native.vkf",
            "fixture_names": [r".\examples\native_core\hello_native.vkf"],
        }
    ]
    assert payload["validation_issue_counts"] == {
        "fixture-missing": 2,
        "noncanonical-source-rel": 1,
        "source-missing": 1,
    }
    assert payload["fixtures_with_validation_issues"] == [
        {
            "fixture_name": "hello_native_versioned.json",
            "issues": ["fixture-missing", "noncanonical-source-rel"],
        },
        {
            "fixture_name": "missing_fixture_source_versioned.json",
            "issues": ["source-missing", "fixture-missing"],
        },
    ]
    assert payload["fixtures"] == [
        {
            "source_rel": r".\examples\native_core\hello_native.vkf",
            "canonical_source_rel": "examples/native_core/hello_native.vkf",
            "fixture_name": "hello_native_versioned.json",
            "expected_source_label": "examples/native_core/hello_native.vkf",
            "source_path": str(repo / "examples/native_core/hello_native.vkf"),
            "fixture_path": str(out_root / "hello_native_versioned.json"),
            "source_exists": True,
            "fixture_exists": False,
            "source_sha256": payload["fixtures"][0]["source_sha256"],
            "fixture_sha256": None,
            "pairing_status": "fixture-missing",
                "external_lexer_contract": {
                    "source_path": str(repo / "examples/native_core/hello_native.vkf"),
                    "filename_label": "examples/native_core/hello_native.vkf",
                    "fixture_path": str(out_root / "hello_native_versioned.json"),
                    "source_sha256": payload["fixtures"][0]["source_sha256"],
                    "fixture_sha256": None,
                },
                "external_lexer_contract_usable": False,
                "validation_issues": ["fixture-missing", "noncanonical-source-rel"],
            },
            {
            "source_rel": "examples/native_core/missing_fixture_source.vkf",
            "canonical_source_rel": "examples/native_core/missing_fixture_source.vkf",
            "fixture_name": "missing_fixture_source_versioned.json",
            "expected_source_label": "examples/native_core/missing_fixture_source.vkf",
            "source_path": str(repo / "examples/native_core/missing_fixture_source.vkf"),
            "fixture_path": str(out_root / "missing_fixture_source_versioned.json"),
            "source_exists": False,
            "fixture_exists": False,
            "source_sha256": None,
            "fixture_sha256": None,
            "pairing_status": "unpaired",
                "external_lexer_contract": {
                    "source_path": str(repo / "examples/native_core/missing_fixture_source.vkf"),
                    "filename_label": "examples/native_core/missing_fixture_source.vkf",
                    "fixture_path": str(out_root / "missing_fixture_source_versioned.json"),
                    "source_sha256": None,
                    "fixture_sha256": None,
                },
                "external_lexer_contract_usable": False,
                "validation_issues": ["source-missing", "fixture-missing"],
            },
        ]
    assert len(payload["fixtures"][0]["source_sha256"]) == 64


def test_discovered_fixture_report_covers_all_checked_in_token_json() -> None:
    report = discovered_fixture_report(fixture_root=TOKEN_FIXTURE_ROOT)
    assert {item.fixture_name for item in report} == set(discovered_fixture_names(TOKEN_FIXTURE_ROOT))
    by_name = {item.fixture_name: item for item in report}
    assert by_name["hello_native_versioned.json"].managed is True
    assert by_name["hello_native_versioned.json"].envelope_kind == "versioned"
    assert by_name["hello_native_versioned.json"].canonical_versioned is True
    assert by_name["hello_native_versioned.json"].pairing_mode == "declared-label"
    assert by_name["hello_native_versioned.json"].paired_source_exists is True
    assert by_name["hello_native_versioned.json"].paired_source_sha256 is not None
    assert by_name["hello_native_versioned.json"].validation_issues == ()
    assert by_name["legacy_singleton_tuple_type.json"].managed is False
    assert by_name["legacy_singleton_tuple_type.json"].envelope_kind == "legacy"
    assert by_name["legacy_singleton_tuple_type.json"].canonical_versioned is False
    assert by_name["legacy_singleton_tuple_type.json"].pairing_mode == "sibling-vkf"
    assert by_name["legacy_singleton_tuple_type.json"].paired_source_exists is True
    assert by_name["legacy_singleton_tuple_type.json"].paired_source_sha256 is not None
    assert by_name["legacy_singleton_tuple_type.json"].validation_issues == (
        "legacy-envelope",
        "not-canonical-versioned",
    )
    for item in report:
        assert item.token_count > 0
        assert len(item.payload_sha256) == 64


def test_discovered_fixture_report_handles_invalid_json_without_crashing(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    out_root.mkdir(parents=True, exist_ok=True)
    bad = out_root / "broken.json"
    bad.write_text("{ not json", encoding="utf-8")
    report = discovered_fixture_report(repo_root=repo, fixture_root=out_root)
    assert len(report) == 1
    item = report[0]
    assert item.fixture_name == "broken.json"
    assert item.parseable_json is False
    assert item.envelope_kind == "invalid-json"
    assert item.canonical_versioned is False
    assert item.pairing_mode == "none"
    assert item.token_count == 0
    assert item.paired_source_sha256 is None
    assert item.validation_issues == (
        "invalid-json",
        "missing-source-label",
        "missing-paired-source",
        "empty-token-list",
    )
    payload = fixture_status_payload(repo_root=repo, fixture_root=out_root, specs=())
    assert payload["summary"]["invalid_json"] == 1
    assert payload["summary"]["with_validation_issues"] == 1
    assert payload["discovered_fixtures_by_envelope_kind"] == {"invalid-json": ["broken.json"]}
    assert payload["discovered_fixtures_by_pairing_mode"] == {"none": ["broken.json"]}
    assert payload["validation_issue_counts"] == {
        "empty-token-list": 1,
        "invalid-json": 1,
        "missing-paired-source": 1,
        "missing-source-label": 1,
    }
    assert payload["fixtures_with_validation_issues"] == [
        {
            "fixture_name": "broken.json",
            "issues": [
                "invalid-json",
                "missing-source-label",
                "missing-paired-source",
                "empty-token-list",
            ],
        }
    ]


def test_fixture_status_payload_surfaces_declared_catalog_issues() -> None:
    specs = (
        TokenFixtureSpec(
            source_rel="examples/native_core/hello_native.vkf",
            fixture_name="hello_native_versioned.json",
        ),
        TokenFixtureSpec(
            source_rel="examples/native_core/hello_native.vkf",
            fixture_name="hello_native_shadow.json",
        ),
    )
    payload = fixture_status_payload(
        repo_root=Path(__file__).resolve().parents[1],
        fixture_root=TOKEN_FIXTURE_ROOT,
        specs=specs,
    )
    assert payload["summary"]["declared_catalog_issues"] == 1
    assert payload["declared_catalog_issues"] == [
        {
            "issue": "duplicate-source-rel",
            "value": "examples/native_core/hello_native.vkf",
            "fixture_names": [
                "hello_native_shadow.json",
                "hello_native_versioned.json",
            ],
        }
    ]
    assert len(payload["bundle_sha256"]["declared_catalog_issues"]) == 64


def test_fixture_drift_report_includes_declared_catalog_issues() -> None:
    specs = (
        TokenFixtureSpec(
            source_rel="examples/native_core/hello_native.vkf",
            fixture_name="hello_native_versioned.json",
        ),
        TokenFixtureSpec(
            source_rel="examples/native_core/other_source.vkf",
            fixture_name="hello_native_versioned.json",
        ),
    )
    drift = fixture_drift_report(
        repo_root=Path(__file__).resolve().parents[1],
        fixture_root=TOKEN_FIXTURE_ROOT,
        specs=specs,
    )
    assert "duplicate-fixture-name: hello_native_versioned.json -> examples/native_core/hello_native.vkf, examples/native_core/other_source.vkf" in drift


def test_native_lexer_fixtures_module_manifest_emits_declared_fixture_contract() -> None:
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
    assert payload["declared_catalog_issues"] == []
    assert payload["validation_issue_counts"] == {}
    assert payload["fixtures_with_validation_issues"] == []
    assert [item["fixture_name"] for item in payload["fixtures"]] == [
        spec.fixture_name for spec in TOKEN_FIXTURE_SPECS
    ]
    for item in payload["fixtures"]:
        assert len(item["source_sha256"]) == 64
        assert len(item["fixture_sha256"]) == 64
    assert len(payload["bundle_sha256"]) == 64
