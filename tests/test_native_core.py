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
from vektorflow.native_frontend import native_subset_native_parser_fast_path_available
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
}

FAST_PATH_SUPPORTED = {
    "hello_native.vkf",
    "vectors_native.vkf",
    "numeric_native.vkf",
    "named_record_native.vkf",
    "named_record_nested_native.vkf",
    "named_record_collections_native.vkf",
    "named_record_scene_native.vkf",
    "named_record_scene_chain_native.vkf",
    "named_record_scene_helpers_native.vkf",
}

FAST_PATH_FALLBACK = {
    "records_native.vkf",
}

OPTIONAL_BUILDABLE_FALLBACK = tuple(
    name
    for name in (
        "named_record_scene_handoff_native.vkf",
        "named_record_scene_relay_native.vkf",
        "named_record_scene_compose_native.vkf",
        "named_record_scene_fanout_native.vkf",
    )
    if (NATIVE_CORE / name).exists()
)


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
    }:
        lines = out.splitlines()
        if name in {
            "named_record_scene_helpers_native.vkf",
            "named_record_scene_compose_native.vkf",
        }:
            assert lines[0] == ("6" if name == "named_record_scene_helpers_native.vkf" else "4")
            assert lines[1] == "2"
            assert "anchor:(x:4, y:6)" in lines[2]
            assert "pts:[5, 7]" in lines[2]
            assert "bag:{3:1, 6:2}" in lines[2]
            assert "total:2" in lines[2]
        else:
            assert lines[0] == ("7" if name == "named_record_scene_fanout_native.vkf" else "10")
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
    source = path.read_text(encoding="utf-8")

    assert native_subset_native_parser_fast_path_available(None, str(path))
    assert native_subset_native_parser_fast_path_available(source, path.name)

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "double twice(double x)" in native_out
    assert "vf_format_num" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "hello_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_vectors_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "vectors_native.vkf"
    source = path.read_text(encoding="utf-8")

    assert native_subset_native_parser_fast_path_available(None, str(path))
    assert native_subset_native_parser_fast_path_available(source, path.name)

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "std::array<double, 4>" in native_out
    assert "vf_format_value" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "vectors_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_native_parser_fast_path_supports_current_shapes_only() -> None:
    for name in sorted(FAST_PATH_SUPPORTED):
        path = NATIVE_CORE / name
        source = path.read_text(encoding="utf-8")
        assert native_subset_native_parser_fast_path_available(None, str(path))
        assert native_subset_native_parser_fast_path_available(source, path.name)

    for name in sorted(FAST_PATH_FALLBACK):
        path = NATIVE_CORE / name
        source = path.read_text(encoding="utf-8")
        assert not native_subset_native_parser_fast_path_available(None, str(path))
        assert not native_subset_native_parser_fast_path_available(source, path.name)

    for name in OPTIONAL_BUILDABLE_FALLBACK:
        path = NATIVE_CORE / name
        source = path.read_text(encoding="utf-8")
        assert not native_subset_native_parser_fast_path_available(None, str(path))
        assert not native_subset_native_parser_fast_path_available(source, path.name)


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
    source = path.read_text(encoding="utf-8")

    assert native_subset_native_parser_fast_path_available(None, str(path))
    assert native_subset_native_parser_fast_path_available(source, path.name)

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "std::sin(0.0)" in native_out
    assert "vf_array_normalize" in native_out
    assert "vf_array_correlation" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "numeric_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_native.vkf"
    source = path.read_text(encoding="utf-8")

    assert native_subset_native_parser_fast_path_available(None, str(path))
    assert native_subset_native_parser_fast_path_available(source, path.name)

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "struct Point" in native_out
    assert "Point move(Point p, double dx, double dy)" in native_out
    assert "vf_format_value(const Point& value)" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_nested_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_nested_native.vkf"
    source = path.read_text(encoding="utf-8")

    assert native_subset_native_parser_fast_path_available(None, str(path))
    assert native_subset_native_parser_fast_path_available(source, path.name)

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "struct Point" in native_out
    assert "struct Box" in native_out
    assert "Box translate(Box box, double dx, double dy)" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_nested_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_collections_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_collections_native.vkf"
    source = path.read_text(encoding="utf-8")

    assert native_subset_native_parser_fast_path_available(None, str(path))
    assert native_subset_native_parser_fast_path_available(source, path.name)

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "struct State" in native_out
    assert "std::array<double, 2>" in native_out
    assert "std::map<double, long long>" in native_out
    assert "State bump(State state, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_collections_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_native.vkf"
    source = path.read_text(encoding="utf-8")

    assert native_subset_native_parser_fast_path_available(None, str(path))
    assert native_subset_native_parser_fast_path_available(source, path.name)

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "struct Point" in native_out
    assert "struct State" in native_out
    assert "struct Scene" in native_out
    assert "Scene bump(Scene scene, Point shift, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_chain_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_chain_native.vkf"
    source = path.read_text(encoding="utf-8")

    assert native_subset_native_parser_fast_path_available(None, str(path))
    assert native_subset_native_parser_fast_path_available(source, path.name)

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "struct Point" in native_out
    assert "struct State" in native_out
    assert "struct Scene" in native_out
    assert "Scene second = bump(first, shift" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_chain_native_cpp")


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_named_record_scene_helpers_native_cpp_native_core_uses_fast_path_and_preserves_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "named_record_scene_helpers_native.vkf"
    source = path.read_text(encoding="utf-8")

    assert native_subset_native_parser_fast_path_available(None, str(path))
    assert native_subset_native_parser_fast_path_available(source, path.name)

    _, native_out = _run_cli_stdout(["cpp-native-core", str(path)])
    assert "Point shift_anchor(Point anchor, Point shift)" in native_out
    assert "State bump_state(State state, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out
    assert "Scene step(Scene scene, Point shift, const std::array<double, 2>& extra, const std::map<double, long long>& delta)" in native_out

    _assert_native_cpp_runtime_matches_standard(path, tmp_path, "named_record_scene_helpers_native_cpp")


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
