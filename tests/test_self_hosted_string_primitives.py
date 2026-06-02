from __future__ import annotations

import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent


def _compiler_command(source: Path, output: Path) -> list[str] | None:
    for compiler in ("clang++", "g++", "c++"):
        path = shutil.which(compiler)
        if path is not None:
            return [
                path,
                "-std=c++17",
                "-I",
                str(ROOT),
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
            f"/I{ROOT}",
            str(source),
            f"/Fe:{output}",
        ]

    return None


def test_header_only_string_primitives_compile_and_handle_ascii_utf8_slice_and_cursor(
    tmp_path: Path,
) -> None:
    source = tmp_path / "check_string_primitives.cpp"
    output = tmp_path / "check_string_primitives.exe"
    source.write_text(
        textwrap.dedent(
            r'''
            #include "compiler/native/vkf_string_primitives.hpp"

            #include <iostream>
            #include <string>

            int main() {
                const std::string text = std::string("A") + u8"é" + u8"€" + u8"😀" + "\nB";

                if (vkf_string_byte_len(text) != text.size()) return 1;
                if (vkf_string_eof(text, text.size()) != true) return 2;
                if (vkf_string_eof(text, 0) != false) return 3;

                if (vkf_string_peek_scalar(text, 0) != "A") return 4;
                if (vkf_string_scalar_width(text, 1) != 2) return 5;
                if (vkf_string_scalar_width(text, 3) != 3) return 6;
                if (vkf_string_scalar_width(text, 6) != 4) return 7;
                if (vkf_string_slice_bytes(text, 1, 6) != std::string(u8"é") + u8"€") return 8;

                VkfCursor cursor{text, "<test>", 0, 1, 1};
                cursor = vkf_cursor_advance_scalar(cursor);
                if (cursor.index != 1 || cursor.line != 1 || cursor.column != 2) return 9;
                cursor = vkf_cursor_advance_scalar(cursor);
                cursor = vkf_cursor_advance_scalar(cursor);
                cursor = vkf_cursor_advance_scalar(cursor);
                if (cursor.index != 10 || cursor.line != 1 || cursor.column != 5) return 10;
                cursor = vkf_cursor_advance_scalar(cursor);
                if (cursor.index != 11 || cursor.line != 2 || cursor.column != 1) return 11;
                if (vkf_string_peek_scalar(text, cursor.index) != "B") return 12;

                try {
                    (void)vkf_string_peek_scalar(text, 2);
                    return 13;
                } catch (const std::runtime_error&) {
                }

                try {
                    (void)vkf_string_slice_bytes(text, 1, 2);
                    return 14;
                } catch (const std::runtime_error&) {
                }

                return 0;
            }
            '''
        ),
        encoding="utf-8",
    )

    command = _compiler_command(source, output)
    if command is None:
        pytest.skip("no C++ compiler found")

    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    subprocess.run([str(output)], cwd=ROOT, check=True, capture_output=True, text=True)
