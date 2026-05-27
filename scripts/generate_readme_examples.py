from __future__ import annotations

import argparse
import re
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
README = REPO / "README.md"
OUT_DIR = REPO / "examples" / "generated" / "readme"

MARKER_RE = re.compile(r"<!--\s*readme-example:\s*([^\s]+)\s*-->")
FENCE_OPEN_RE = re.compile(r"^```vkf\s*$")
FENCE_CLOSE_RE = re.compile(r"^```\s*$")


def iter_marked_examples(readme_text: str):
    lines = readme_text.splitlines()
    i = 0
    while i < len(lines):
        marker_match = MARKER_RE.search(lines[i])
        if not marker_match:
            i += 1
            continue
        rel_path = marker_match.group(1).strip().replace("\\", "/")
        i += 1
        while i < len(lines) and not FENCE_OPEN_RE.match(lines[i]):
            i += 1
        if i >= len(lines):
            raise ValueError(f"Missing ```vkf block after marker for {rel_path}")
        i += 1
        body: list[str] = []
        while i < len(lines) and not FENCE_CLOSE_RE.match(lines[i]):
            body.append(lines[i])
            i += 1
        if i >= len(lines):
            raise ValueError(f"Unclosed ```vkf block for {rel_path}")
        yield rel_path, "\n".join(body).rstrip() + "\n"
        i += 1


def generate_examples(*, check: bool) -> int:
    readme_text = README.read_text(encoding="utf-8")
    examples = list(iter_marked_examples(readme_text))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    wrote = 0
    for rel_path, source in examples:
        rel = Path(rel_path)
        if rel.is_absolute() or ".." in rel.parts:
            raise ValueError(f"Invalid readme-example path: {rel_path}")
        out_path = OUT_DIR / rel
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if check:
            current = out_path.read_text(encoding="utf-8") if out_path.exists() else None
            if current != source:
                raise SystemExit(f"README example out of date: {out_path.relative_to(REPO)}")
        else:
            out_path.write_text(source, encoding="utf-8")
            wrote += 1
        seen.add(str(out_path.resolve()))

    for existing in OUT_DIR.rglob("*.vkf"):
        if str(existing.resolve()) not in seen:
            if check:
                raise SystemExit(f"Unexpected generated README example: {existing.relative_to(REPO)}")
            existing.unlink()

    if not check:
        print(f"generated {wrote} README example(s) into {OUT_DIR.relative_to(REPO)}")
    return len(examples)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate runnable VKF examples from README.md.")
    parser.add_argument("--check", action="store_true", help="Fail if generated files differ from README.")
    args = parser.parse_args()
    generate_examples(check=args.check)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
