from __future__ import annotations

from pathlib import Path

from vektorflow.cli import main


def test_native_artifact_subcommand_stdout(
    tmp_path: Path,
    capsys,
) -> None:
    source = tmp_path / "artifact_stdout.vkf"
    source.write_text(':: "hello, world"\n', encoding="utf-8")

    assert main(["native-artifact", str(source)]) == 0
    out = capsys.readouterr().out
    assert '"schema": "vf-native-program-artifact"' in out
    assert '"kind": "PrintStmt"' in out


def test_native_artifact_subcommand_output_file(tmp_path: Path) -> None:
    source = tmp_path / "artifact_file.vkf"
    out_path = tmp_path / "artifact.json"
    source.write_text("x: 42\n:: x\n", encoding="utf-8")

    assert main(["native-artifact", str(source), "-o", str(out_path)]) == 0
    payload = out_path.read_text(encoding="utf-8")
    assert '"origin":' in payload
    assert '"kind": "Module"' in payload
