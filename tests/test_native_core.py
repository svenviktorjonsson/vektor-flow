from __future__ import annotations

from pathlib import Path
import contextlib
import json
from functools import lru_cache
from io import StringIO
import subprocess

import pytest

from vektorflow.cli import main
from vektorflow.cpp_backend import CppEmitError, compile_cpp_source, discover_cpp_compiler
from vektorflow.interpreter import run_file
from vektorflow.native_parser_proto import emit_cpp_for_native_core_file
from vektorflow.parser import parse_module, parse_token_stream_json


ROOT = Path(__file__).resolve().parent.parent
NATIVE_CORE = ROOT / "examples" / "native_core"


EXPECTED_OUTPUTS = {
    "hello_native.vkf": "42",
    "vectors_native.vkf": "[2.5, 2.5, 2.5, 2.5]",
    "records_native.vkf": "(pts:[11, 22], bag:{2:1, 3:3, 4:2}, total:3)",
    "numeric_native.vkf": "0\n3.14159265358979\n3\n[0, 0.25, 0.5, 0.75, 1]\n1",
    "named_record_native.vkf": "4\n(x:4, y:6)",
    "named_record_nested_native.vkf": "4\n(origin:(x:4, y:6), size:(x:10, y:20))",
    "named_record_collections_native.vkf": "[5, 7]\n{3:1, 6:2}\n(pts:[5, 7], bag:{3:1, 6:2}, total:2)",
    "named_record_scene_native.vkf": "4\n[5, 7]\n{3:1, 6:2}\n(anchor:(x:4, y:6), state:(pts:[5, 7], bag:{3:1, 6:2}, total:2))",
    "named_record_scene_chain_native.vkf": "7\n3\n(anchor:(x:7, y:10), state:(pts:[6, 8], bag:{3:2, 6:2}, total:3))",
    "named_record_scene_helpers_native.vkf": "6\n2\n(anchor:(x:4, y:6), state:(bag:{3:1, 6:2}, pts:[5, 7], total:2))",
    "named_record_scene_handoff_native.vkf": "10\n3\n(anchor:(x:7, y:10), state:(bag:{3:2, 6:2}, pts:[6, 8], total:3))",
    "named_record_scene_relay_native.vkf": "10\n3\n(anchor:(x:7, y:10), state:(bag:{3:2, 6:2}, pts:[6, 8], total:3))",
    "named_record_scene_compose_native.vkf": "4\n2\n(anchor:(x:4, y:6), state:(bag:{3:1, 6:2}, pts:[5, 7], total:2))",
    "named_record_scene_fanout_native.vkf": "7\n3\n(anchor:(x:7, y:10), state:(bag:{3:2, 6:2}, pts:[6, 8], total:3))",
    "named_record_scene_overlay_native.vkf": "4\n2\n(anchor:(x:4, y:6), state:(bag:{3:1, 6:2}, pts:[5, 7], total:2))",
    "named_record_scene_patch_native.vkf": "4\n2\n(anchor:(x:4, y:6), state:(bag:{3:1, 6:2}, pts:[5, 7], total:2))",
    "named_record_scene_split_native.vkf": "10\n3\n(anchor:(x:7, y:10), state:(bag:{3:2, 6:2}, pts:[6, 8], total:3))",
    "named_record_scene_splice_native.vkf": "7\n3\n(anchor:(x:7, y:10), state:(bag:{3:2, 6:2}, pts:[6, 8], total:3))",
    "named_record_scene_rebuild_native.vkf": "7\n3\n(anchor:(x:7, y:10), state:(bag:{3:2, 6:2}, pts:[6, 8], total:3))",
    "named_record_scene_crossfade_native.vkf": "10\n3\n(anchor:(x:7, y:10), state:(bag:{3:2, 6:2}, pts:[6, 8], total:3))",
    "named_record_scene_reverse_native.vkf": "10\n3\n(anchor:(x:7, y:10), state:(bag:{3:2, 6:2}, pts:[6, 8], total:3))",
    "named_record_scene_checkpoint_native.vkf": "4\n2\n(anchor:(x:4, y:6), state:(bag:{3:1, 6:2}, pts:[5, 7], total:2))",
}

FAST_PATH_SUPPORTED = {
    "hello_native.vkf",
    "vectors_native.vkf",
    "records_native.vkf",
    "numeric_native.vkf",
    "named_record_native.vkf",
    "named_record_nested_native.vkf",
    "named_record_collections_native.vkf",
    "named_record_scene_native.vkf",
    "named_record_scene_chain_native.vkf",
    "named_record_scene_helpers_native.vkf",
    "named_record_scene_handoff_native.vkf",
    "named_record_scene_compose_native.vkf",
    "named_record_scene_patch_native.vkf",
    "named_record_scene_split_native.vkf",
    "named_record_scene_rebuild_native.vkf",
    "named_record_scene_checkpoint_native.vkf",
    "named_record_scene_splice_native.vkf",
    "named_record_scene_fanout_native.vkf",
    "named_record_scene_overlay_native.vkf",
    "named_record_scene_relay_native.vkf",
    "named_record_scene_reverse_native.vkf",
    "named_record_scene_crossfade_native.vkf",
}

FAST_PATH_FALLBACK = set()

OPTIONAL_BUILDABLE_FALLBACK = tuple(
    name
    for name in (
    )
    if (NATIVE_CORE / name).exists()
)

SCENE_BATCH_FAST_PATH_SNIPPETS = {
    "named_record_scene_relay_native.vkf": [
        "Scene staged = step(base, shift",
        "Point final_anchor = shift_anchor(staged.anchor, shift)",
        "State final_state = bump_state(staged.state",
    ],
    "named_record_scene_reverse_native.vkf": [
        "Scene staged = step(base, shift",
        "Point final_anchor = shift_anchor(staged.anchor, shift)",
        "State final_state = bump_state(staged.state",
    ],
    "named_record_scene_crossfade_native.vkf": [
        "Scene staged = step(base, shift",
        "Scene moved_anchor{",
        "Scene moved{moved_anchor.anchor, bump_state(moved_anchor.state",
    ],
}


def _expected_module_repr(path: Path) -> str:
    return repr(parse_module(path.read_text(encoding="utf-8"), filename=path.as_posix()))


def _run_cli_stdout(args: list[str]) -> tuple[int, str]:
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        rc = main(args)
    return rc, buf.getvalue()


@lru_cache(maxsize=1)
def _supports_build_native_core() -> bool:
    rc, out = _run_cli_stdout(["--help"])
    assert rc == 0
    return "build-native-core" in out


def _native_core_build_args(path: Path, exe: Path) -> list[str]:
    if _supports_build_native_core():
        return ["build-native-core", str(path), "-o", str(exe)]
    return ["build", str(path), "-o", str(exe)]


def _compile_and_run_cpp(cpp_source: str, out_dir: Path, exe_name: str) -> subprocess.CompletedProcess[str]:
    exe = compile_cpp_source(cpp_source, out_dir, exe_name=exe_name)
    return subprocess.run([str(exe)], capture_output=True, text=True)


def _assert_native_cpp_runtime_matches_standard(path: Path, tmp_path: Path, exe_prefix: str) -> None:
    standard_rc, standard_out = _run_cli_stdout(["cpp", str(path)])
    native_rc, native_out = _run_cli_stdout(["cpp-native-core", str(path)])

    assert standard_rc == 0
    assert native_rc == 0

    short = exe_prefix[:24]
    standard_proc = _compile_and_run_cpp(standard_out, tmp_path / f"{short}_standard", f"{short}_standard")
    native_proc = _compile_and_run_cpp(native_out, tmp_path / f"{short}_native", f"{short}_native")

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


def _assert_native_build_runtime_matches_standard(path: Path, tmp_path: Path, exe_prefix: str) -> None:
    short = exe_prefix[:24]
    standard_exe = tmp_path / f"{short}_s.exe"
    native_exe = tmp_path / f"{short}_n.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


def _assert_interpreter_output(name: str, out: str) -> None:
    if name in ("hello_native.vkf", "vectors_native.vkf"):
        assert out == EXPECTED_OUTPUTS[name]
        return
    if name == "records_native.vkf":
        assert "pts:[11, 22]" in out
        assert "bag:{2:1, 3:3, 4:2}" in out
        assert "total:3" in out
        return
    if name == "numeric_native.vkf":
        lines = out.splitlines()
        assert lines[0] == "0"
        assert float(lines[1]) == pytest.approx(3.14159265358979)
        assert lines[2] == "3"
        assert lines[3] == "[0, 0.25, 0.5, 0.75, 1]"
        assert float(lines[4]) == pytest.approx(1.0)
        return
    if name == "named_record_native.vkf":
        lines = out.splitlines()
        assert lines[0] == "4"
        assert lines[1] == "(x:4, y:6)"
        return
    if name == "named_record_nested_native.vkf":
        lines = out.splitlines()
        assert lines[0] == "4"
        assert lines[1] == "(origin:(x:4, y:6), size:(x:10, y:20))"
        return
    if name == "named_record_collections_native.vkf":
        lines = out.splitlines()
        assert lines[0] == "[5, 7]"
        assert lines[1] == "{3:1, 6:2}"
        assert "pts:[5, 7]" in lines[2]
        assert "bag:{3:1, 6:2}" in lines[2]
        assert "total:2" in lines[2]
        return
    if name == "named_record_scene_native.vkf":
        lines = out.splitlines()
        assert lines[0] == "4"
        assert lines[1] == "[5, 7]"
        assert lines[2] == "{3:1, 6:2}"
        assert "anchor:(x:4, y:6)" in lines[3]
        assert "pts:[5, 7]" in lines[3]
        assert "bag:{3:1, 6:2}" in lines[3]
        assert "total:2" in lines[3]
        return
    if name == "named_record_scene_chain_native.vkf":
        lines = out.splitlines()
        assert lines[0] == "7"
        assert lines[1] == "3"
        assert "anchor:(x:7, y:10)" in lines[2]
        assert "pts:[6, 8]" in lines[2]
        assert "bag:{3:2, 6:2}" in lines[2]
        assert "total:3" in lines[2]
        return
    if name in {
        "named_record_scene_helpers_native.vkf",
        "named_record_scene_handoff_native.vkf",
        "named_record_scene_relay_native.vkf",
        "named_record_scene_compose_native.vkf",
        "named_record_scene_fanout_native.vkf",
        "named_record_scene_overlay_native.vkf",
        "named_record_scene_patch_native.vkf",
        "named_record_scene_split_native.vkf",
        "named_record_scene_splice_native.vkf",
        "named_record_scene_rebuild_native.vkf",
        "named_record_scene_crossfade_native.vkf",
        "named_record_scene_reverse_native.vkf",
        "named_record_scene_checkpoint_native.vkf",
    }:
        lines = out.splitlines()
        if name in {
            "named_record_scene_helpers_native.vkf",
            "named_record_scene_compose_native.vkf",
            "named_record_scene_overlay_native.vkf",
            "named_record_scene_patch_native.vkf",
            "named_record_scene_checkpoint_native.vkf",
        }:
            assert lines[0] == ("6" if name == "named_record_scene_helpers_native.vkf" else "4")
            assert lines[1] == "2"
            assert "anchor:(x:4, y:6)" in lines[2]
            assert "pts:[5, 7]" in lines[2]
            assert "bag:{3:1, 6:2}" in lines[2]
            assert "total:2" in lines[2]
        else:
            assert lines[0] == ("10" if name in {"named_record_scene_handoff_native.vkf", "named_record_scene_relay_native.vkf", "named_record_scene_split_native.vkf", "named_record_scene_crossfade_native.vkf", "named_record_scene_reverse_native.vkf"} else "7")
            assert lines[1] == "3"
            assert "anchor:(x:7, y:10)" in lines[2]
            assert "pts:[6, 8]" in lines[2]
            assert "bag:{3:2, 6:2}" in lines[2]
            assert "total:3" in lines[2]
        return
    raise AssertionError(f"missing interpreter validator for {name}")


@pytest.mark.parametrize("name, expected", EXPECTED_OUTPUTS.items())
def test_native_core_examples_run_under_interpreter(name: str, expected: str) -> None:
    path = NATIVE_CORE / name
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        run_file(path)
    _assert_interpreter_output(name, buf.getvalue().strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", EXPECTED_OUTPUTS)
def test_native_core_examples_parse_via_native_frontend(name: str) -> None:
    path = NATIVE_CORE / name
    rc, out = _run_cli_stdout(["parse-native-core", str(path)])
    assert rc == 0
    assert out.strip() == _expected_module_repr(path)


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", EXPECTED_OUTPUTS)
def test_native_core_examples_native_tokens_round_trip_to_parser(name: str) -> None:
    path = NATIVE_CORE / name
    rc, out = _run_cli_stdout(["tokens-native-core", str(path), "--json"])
    assert rc == 0

    payload = json.loads(out)
    assert payload["tokens"][-1]["kind"] == "EOF"
    assert payload["tokens"][0]["location"]["file"] == path.as_posix()
    assert repr(parse_token_stream_json(out)) == _expected_module_repr(path)


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_hello_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "double twice(double x)" in native_out
    assert "vf_format_num" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "hello_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_vectors_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "vectors_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "std::array<double, 4>" in native_out
    assert "vf_format_value" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "vectors_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_records_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "records_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "struct RecordsState" in native_out
    assert "RecordsState step(RecordsState state, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out
    assert "vf_mset_make(" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "records_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_native_parser_fast_path_supports_current_shapes_only() -> None:
    for name in sorted(FAST_PATH_SUPPORTED):
        path = NATIVE_CORE / name
        emitted_cpp = emit_cpp_for_native_core_file(path)
        assert "int main()" in emitted_cpp

    for name in sorted(FAST_PATH_FALLBACK):
        path = NATIVE_CORE / name
        with pytest.raises(CppEmitError):
            emit_cpp_for_native_core_file(path)

    for name in OPTIONAL_BUILDABLE_FALLBACK:
        path = NATIVE_CORE / name
        with pytest.raises(CppEmitError):
            emit_cpp_for_native_core_file(path)


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", OPTIONAL_BUILDABLE_FALLBACK)
def test_optional_buildable_fallback_shapes_stay_off_fast_path_but_parse(name: str) -> None:
    path = NATIVE_CORE / name

    parse_rc, parse_out = _run_cli_stdout(["parse-native-core", str(path)])
    assert parse_rc == 0
    assert parse_out.strip() == _expected_module_repr(path)


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", OPTIONAL_BUILDABLE_FALLBACK)
def test_optional_buildable_fallback_shapes_preserve_cpp_runtime_parity(name: str, tmp_path: Path) -> None:
    path = NATIVE_CORE / name

    parse_rc, parse_out = _run_cli_stdout(["parse-native-core", str(path)])
    assert parse_rc == 0
    assert parse_out.strip() == _expected_module_repr(path)

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, f"{path.stem[:16]}_opt_fb_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", OPTIONAL_BUILDABLE_FALLBACK)
def test_optional_buildable_fallback_shapes_preserve_build_runtime_parity(name: str, tmp_path: Path) -> None:
    path = NATIVE_CORE / name
    _assert_native_build_runtime_matches_standard(path, tmp_path, f"{path.stem[:16]}_opt_fb_build")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", OPTIONAL_BUILDABLE_FALLBACK)
def test_optional_buildable_fallback_shapes_build_and_run(name: str, tmp_path: Path) -> None:
    path = NATIVE_CORE / name
    exe = tmp_path / path.with_suffix(".exe").name

    parse_rc, parse_out = _run_cli_stdout(["parse-native-core", str(path)])
    assert parse_rc == 0
    assert parse_out.strip() == _expected_module_repr(path)

    assert main(_native_core_build_args(path, exe)) == 0
    proc = subprocess.run([str(exe)], capture_output=True, text=True)
    assert proc.returncode == 0
    _assert_interpreter_output(name, proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", sorted(FAST_PATH_FALLBACK))
def test_native_core_fallback_shapes_preserve_cpp_runtime_parity(name: str, tmp_path: Path) -> None:
    path = NATIVE_CORE / name

    parse_rc, parse_out = _run_cli_stdout(["parse-native-core", str(path)])
    assert parse_rc == 0
    assert parse_out.strip() == _expected_module_repr(path)

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, f"{path.stem[:16]}_fb_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", sorted(FAST_PATH_FALLBACK))
def test_native_core_fallback_shapes_preserve_build_runtime_parity(name: str, tmp_path: Path) -> None:
    path = NATIVE_CORE / name
    _assert_native_build_runtime_matches_standard(path, tmp_path, f"{path.stem[:16]}_fb_build")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", sorted(FAST_PATH_FALLBACK))
def test_native_parser_proto_rejects_fallback_shapes(name: str) -> None:
    path = NATIVE_CORE / name

    with pytest.raises(CppEmitError):
        emit_cpp_for_native_core_file(path)


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_records_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "records_native.vkf"
    _assert_native_build_runtime_matches_standard(path, tmp_path, "records_native_build")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_records_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "records_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)
    assert "struct RecordsState" in emitted_cpp
    assert "vf_format_value(const RecordsState& value)" in emitted_cpp
    assert "std::cout << vf_format_value(step(base, extra, delta))" in emitted_cpp
    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "records_native_proto")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", OPTIONAL_BUILDABLE_FALLBACK)
def test_native_parser_proto_rejects_optional_buildable_fallback_shapes(name: str) -> None:
    path = NATIVE_CORE / name

    with pytest.raises(CppEmitError):
        emit_cpp_for_native_core_file(path)


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name, expected", EXPECTED_OUTPUTS.items())
def test_native_core_examples_build_and_run(name: str, expected: str, tmp_path: Path) -> None:
    path = NATIVE_CORE / name
    exe = tmp_path / path.with_suffix(".exe").name
    parse_rc, parse_out = _run_cli_stdout(["parse-native-core", str(path)])
    assert parse_rc == 0
    assert parse_out.strip() == _expected_module_repr(path)

    assert main(_native_core_build_args(path, exe)) == 0
    proc = subprocess.run([str(exe)], capture_output=True, text=True)
    assert proc.returncode == 0
    _assert_interpreter_output(name, proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_hello_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"
    standard_exe = tmp_path / "hello_native_standard.exe"
    native_exe = tmp_path / "hello_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_vectors_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "vectors_native.vkf"
    standard_exe = tmp_path / "vectors_native_standard.exe"
    native_exe = tmp_path / "vectors_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_numeric_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "numeric_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "std::sin(0.0)" in native_out
    assert "vf_array_normalize" in native_out
    assert "vf_array_correlation" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "numeric_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "struct Point" in native_out
    assert "Point move(Point p, double dx, double dy)" in native_out
    assert "vf_format_value(const Point& value)" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_nested_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_nested_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "struct Point" in native_out
    assert "struct Box" in native_out
    assert "Box translate(Box box, double dx, double dy)" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_nested_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_collections_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_collections_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "struct State" in native_out
    assert "std::array<double, 2>" in native_out
    assert "std::map<double, long long>" in native_out
    assert "State bump(State state, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_collections_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "struct Point" in native_out
    assert "struct State" in native_out
    assert "struct Scene" in native_out
    assert "Scene bump(Scene scene, Point shift, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_chain_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_chain_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "struct Point" in native_out
    assert "struct State" in native_out
    assert "struct Scene" in native_out
    assert "Scene second = bump(first, shift" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_chain_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_helpers_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_helpers_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "Point shift_anchor(Point anchor, Point shift)" in native_out
    assert "State bump_state(State state, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out
    assert "Scene step(Scene scene, Point shift, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_helpers_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_handoff_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_handoff_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "Point shift_anchor(Point anchor, Point shift)" in native_out
    assert "State bump_state(State state, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out
    assert "Scene second = step(first, shift" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_handoff_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_compose_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_compose_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "Point moved_anchor = shift_anchor(base.anchor, shift)" in native_out
    assert "Scene moved{moved_anchor, staged.state}" in native_out
    assert "Scene step(Scene scene, Point shift, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_compose_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_patch_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_patch_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "Scene move_anchor(Scene scene, Point shift)" in native_out
    assert "State patched = bump_state(shifted.state" in native_out
    assert "Scene moved{shifted.anchor, patched}" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_patch_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_split_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_split_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "Scene staged = step(base, shift" in native_out
    assert "Point final_anchor = shift_anchor(staged.anchor, shift)" in native_out
    assert "State final_state = bump_state(staged.state" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_split_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_rebuild_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_rebuild_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "Scene staged = step(base, shift" in native_out
    assert "Scene moved_anchor{" in native_out
    assert "Scene moved{moved_anchor.anchor, bump_state(moved_anchor.state" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_rebuild_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_overlay_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_overlay_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "Scene move_anchor(Scene scene, Point shift)" in native_out
    assert "Scene fill_state(Scene scene, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out
    assert "Scene moved{shifted.anchor, filled.state}" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_overlay_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_checkpoint_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_checkpoint_native.vkf"

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "Scene staged = step(base, shift" in native_out
    assert "Scene checkpoint = staged;" in native_out
    assert "Scene moved = checkpoint;" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_checkpoint_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_splice_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_splice_native.vkf"

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_splice_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_fanout_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_fanout_native.vkf"

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_fanout_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", tuple(SCENE_BATCH_FAST_PATH_SNIPPETS))
def test_scene_batch_native_cpp_native_core_uses_fast_path_and_preserves_output(name: str, tmp_path: Path) -> None:
    path = NATIVE_CORE / name

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    for snippet in SCENE_BATCH_FAST_PATH_SNIPPETS[name]:
        assert snippet in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, f"{path.stem}_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_numeric_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "numeric_native.vkf"
    standard_exe = tmp_path / "numeric_native_standard.exe"
    native_exe = tmp_path / "numeric_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_native.vkf"
    standard_exe = tmp_path / "named_record_native_standard.exe"
    native_exe = tmp_path / "named_record_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_nested_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_nested_native.vkf"
    standard_exe = tmp_path / "named_record_nested_native_standard.exe"
    native_exe = tmp_path / "named_record_nested_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_collections_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_collections_native.vkf"
    standard_exe = tmp_path / "named_record_collections_native_standard.exe"
    native_exe = tmp_path / "named_record_collections_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_native.vkf"
    standard_exe = tmp_path / "named_record_scene_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_chain_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_chain_native.vkf"
    standard_exe = tmp_path / "named_record_scene_chain_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_chain_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_helpers_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_helpers_native.vkf"
    standard_exe = tmp_path / "named_record_scene_helpers_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_helpers_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_handoff_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_handoff_native.vkf"
    standard_exe = tmp_path / "named_record_scene_handoff_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_handoff_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_compose_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_compose_native.vkf"
    standard_exe = tmp_path / "named_record_scene_compose_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_compose_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_patch_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_patch_native.vkf"
    standard_exe = tmp_path / "named_record_scene_patch_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_patch_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_split_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_split_native.vkf"
    standard_exe = tmp_path / "named_record_scene_split_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_split_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_rebuild_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_rebuild_native.vkf"
    standard_exe = tmp_path / "named_record_scene_rebuild_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_rebuild_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_overlay_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_overlay_native.vkf"
    standard_exe = tmp_path / "named_record_scene_overlay_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_overlay_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_checkpoint_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_checkpoint_native.vkf"
    standard_exe = tmp_path / "named_record_scene_checkpoint_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_checkpoint_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_splice_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_splice_native.vkf"
    standard_exe = tmp_path / "named_record_scene_splice_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_splice_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_fanout_native_build_native_core_matches_standard_build(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_fanout_native.vkf"
    standard_exe = tmp_path / "named_record_scene_fanout_native_standard.exe"
    native_exe = tmp_path / "named_record_scene_fanout_native_native.exe"

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    assert main(["build-native-core", str(path), "-o", str(native_exe)]) == 0

    standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
    native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)

    assert standard_proc.returncode == 0
    assert native_proc.returncode == 0
    assert native_proc.stdout == standard_proc.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", tuple(SCENE_BATCH_FAST_PATH_SNIPPETS))
def test_scene_batch_build_native_core_matches_standard_build(name: str, tmp_path: Path) -> None:
    path = NATIVE_CORE / name
    _assert_native_build_runtime_matches_standard(path, tmp_path, f"{path.stem}_build")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_hello_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "double twice(double x)" in emitted_cpp
    assert "vf_format_num" in emitted_cpp

    proc = _compile_and_run_cpp(emitted_cpp, tmp_path / "hello_native_proto", "hello_native_proto")

    assert proc.returncode == 0
    assert proc.stdout.strip() == EXPECTED_OUTPUTS["hello_native.vkf"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_vectors_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "vectors_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "std::array<double, 4>" in emitted_cpp
    assert "mix(const std::array<double, N>& x, const std::array<double, N>& y)" in emitted_cpp
    assert "vf_format_value" in emitted_cpp

    proc = _compile_and_run_cpp(emitted_cpp, tmp_path / "vectors_native_proto", "vectors_native_proto")

    assert proc.returncode == 0
    assert proc.stdout.strip() == EXPECTED_OUTPUTS["vectors_native.vkf"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_numeric_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "numeric_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "std::sin(0.0)" in emitted_cpp
    assert "vf_array_normalize" in emitted_cpp
    assert "vf_array_correlation" in emitted_cpp

    proc = _compile_and_run_cpp(emitted_cpp, tmp_path / "numeric_native_proto", "numeric_native_proto")

    assert proc.returncode == 0
    assert proc.stdout.strip() == EXPECTED_OUTPUTS["numeric_native.vkf"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "struct Point" in emitted_cpp
    assert "Point move(Point p, double dx, double dy)" in emitted_cpp
    assert "vf_format_value(const Point& value)" in emitted_cpp

    proc = _compile_and_run_cpp(emitted_cpp, tmp_path / "named_record_native_proto", "named_record_native_proto")

    assert proc.returncode == 0
    assert proc.stdout.strip() == EXPECTED_OUTPUTS["named_record_native.vkf"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_nested_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_nested_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "struct Point" in emitted_cpp
    assert "struct Box" in emitted_cpp
    assert "Box translate(Box box, double dx, double dy)" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_nested_native_proto",
        "named_record_nested_native_proto",
    )

    assert proc.returncode == 0
    assert proc.stdout.strip() == EXPECTED_OUTPUTS["named_record_nested_native.vkf"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_collections_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_collections_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "struct State" in emitted_cpp
    assert "std::array<double, 2>" in emitted_cpp
    assert "std::map<double, long long>" in emitted_cpp
    assert "State bump(State state, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_collections_native_proto",
        "named_record_collections_native_proto",
    )

    assert proc.returncode == 0
    assert proc.stdout.strip() == EXPECTED_OUTPUTS["named_record_collections_native.vkf"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "struct Point" in emitted_cpp
    assert "struct State" in emitted_cpp
    assert "struct Scene" in emitted_cpp
    assert "Scene bump(Scene scene, Point shift, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_native_proto",
        "named_record_scene_native_proto",
    )

    assert proc.returncode == 0
    assert proc.stdout.strip() == EXPECTED_OUTPUTS["named_record_scene_native.vkf"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_chain_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_chain_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "struct Point" in emitted_cpp
    assert "struct State" in emitted_cpp
    assert "struct Scene" in emitted_cpp
    assert "Scene second = bump(first, shift" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_chain_native_proto",
        "named_record_scene_chain_native_proto",
    )

    assert proc.returncode == 0
    assert proc.stdout.strip() == EXPECTED_OUTPUTS["named_record_scene_chain_native.vkf"]


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_helpers_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_helpers_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "Point shift_anchor(Point anchor, Point shift)" in emitted_cpp
    assert "State bump_state(State state, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in emitted_cpp
    assert "Scene step(Scene scene, Point shift, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_helpers_native_proto",
        "named_record_scene_helpers_native_proto",
    )

    assert proc.returncode == 0
    _assert_interpreter_output("named_record_scene_helpers_native.vkf", proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_handoff_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_handoff_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "Point shift_anchor(Point anchor, Point shift)" in emitted_cpp
    assert "State bump_state(State state, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in emitted_cpp
    assert "Scene second = step(first, shift" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_handoff_native_proto",
        "named_record_scene_handoff_native_proto",
    )

    assert proc.returncode == 0
    _assert_interpreter_output("named_record_scene_handoff_native.vkf", proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_compose_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_compose_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "Point moved_anchor = shift_anchor(base.anchor, shift)" in emitted_cpp
    assert "Scene moved{moved_anchor, staged.state}" in emitted_cpp
    assert "return Scene{scene.anchor, bump_state(scene.state, extra, delta)};" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_compose_native_proto",
        "named_record_scene_compose_native_proto",
    )

    assert proc.returncode == 0
    _assert_interpreter_output("named_record_scene_compose_native.vkf", proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_patch_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_patch_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "Scene move_anchor(Scene scene, Point shift)" in emitted_cpp
    assert "State patched = bump_state(shifted.state" in emitted_cpp
    assert "Scene moved{shifted.anchor, patched}" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_patch_native_proto",
        "named_record_scene_patch_native_proto",
    )

    assert proc.returncode == 0
    _assert_interpreter_output("named_record_scene_patch_native.vkf", proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_split_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_split_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "Scene staged = step(base, shift" in emitted_cpp
    assert "Point final_anchor = shift_anchor(staged.anchor, shift)" in emitted_cpp
    assert "State final_state = bump_state(staged.state" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_split_native_proto",
        "named_record_scene_split_native_proto",
    )

    assert proc.returncode == 0
    _assert_interpreter_output("named_record_scene_split_native.vkf", proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_rebuild_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_rebuild_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "Scene staged = step(base, shift" in emitted_cpp
    assert "Scene moved_anchor{" in emitted_cpp
    assert "Scene moved{moved_anchor.anchor, bump_state(moved_anchor.state" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_rebuild_native_proto",
        "named_record_scene_rebuild_native_proto",
    )

    assert proc.returncode == 0
    _assert_interpreter_output("named_record_scene_rebuild_native.vkf", proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_overlay_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_overlay_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "Scene move_anchor(Scene scene, Point shift)" in emitted_cpp
    assert "Scene fill_state(Scene scene, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in emitted_cpp
    assert "Scene moved{shifted.anchor, filled.state}" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_overlay_native_proto",
        "named_record_scene_overlay_native_proto",
    )

    assert proc.returncode == 0
    _assert_interpreter_output("named_record_scene_overlay_native.vkf", proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_checkpoint_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_checkpoint_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "Scene staged = step(base, shift" in emitted_cpp
    assert "Scene checkpoint = staged;" in emitted_cpp
    assert "Scene moved = checkpoint;" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_checkpoint_native_proto",
        "named_record_scene_checkpoint_native_proto",
    )

    assert proc.returncode == 0
    _assert_interpreter_output("named_record_scene_checkpoint_native.vkf", proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_splice_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_splice_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "Scene shifted = move_anchor(base, shift);" in emitted_cpp
    assert "Scene filled = fill_state(base, std::array<double, 2>{4, 5}, vf_mset_make(6, 2));" in emitted_cpp
    assert "Point final_anchor = shift_anchor(shifted.anchor, shift);" in emitted_cpp
    assert "State final_state = bump_state(filled.state, std::array<double, 2>{1, 1}, vf_mset_make(3, 1));" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_splice_native_proto",
        "named_record_scene_splice_native_proto",
    )

    assert proc.returncode == 0
    _assert_interpreter_output("named_record_scene_splice_native.vkf", proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_fanout_native_parser_proto_emits_cpp_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_fanout_native.vkf"
    emitted_cpp = emit_cpp_for_native_core_file(path)

    assert "Point first_anchor = shift_anchor(base.anchor, shift);" in emitted_cpp
    assert "State first_state = bump_state(base.state, std::array<double, 2>{4, 5}, vf_mset_make(6, 2));" in emitted_cpp
    assert "Point second_anchor = shift_anchor(first.anchor, shift);" in emitted_cpp
    assert "State second_state = bump_state(first.state, std::array<double, 2>{1, 1}, vf_mset_make(3, 1));" in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / "named_record_scene_fanout_native_proto",
        "named_record_scene_fanout_native_proto",
    )

    assert proc.returncode == 0
    _assert_interpreter_output("named_record_scene_fanout_native.vkf", proc.stdout.strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", tuple(SCENE_BATCH_FAST_PATH_SNIPPETS))
def test_scene_batch_parser_proto_emits_cpp_and_preserves_output(name: str, tmp_path: Path) -> None:
    path = NATIVE_CORE / name
    emitted_cpp = emit_cpp_for_native_core_file(path)

    for snippet in SCENE_BATCH_FAST_PATH_SNIPPETS[name]:
        assert snippet in emitted_cpp

    proc = _compile_and_run_cpp(
        emitted_cpp,
        tmp_path / f"{path.stem}_proto",
        f"{path.stem}_proto",
    )

    assert proc.returncode == 0
    _assert_interpreter_output(name, proc.stdout.strip())

