import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys

import polars as pl


def dependency_sha256() -> str:
    digest = hashlib.sha256()
    distributions = sorted(
        (
            distribution
            for distribution in importlib.metadata.distributions()
            if (distribution.metadata.get("Name") or "")
            .lower()
            .replace("_", "-")
            .startswith("polars")
        ),
        key=lambda distribution: (
            (distribution.metadata.get("Name") or "").lower(),
            distribution.version,
        ),
    )
    if not distributions:
        raise RuntimeError("Polars distribution metadata is unavailable")
    for distribution in distributions:
        name = (distribution.metadata.get("Name") or "").lower().replace("_", "-")
        digest.update(f"distribution\0{name}\0{distribution.version}\0".encode())
        for relative in sorted(distribution.files or [], key=lambda path: path.as_posix()):
            if "__pycache__" in relative.parts or relative.suffix == ".pyc":
                continue
            installed = Path(distribution.locate_file(relative))
            if not installed.is_file():
                raise RuntimeError(f"Polars dependency file is missing: {relative}")
            digest.update(f"file\0{relative.as_posix()}\0".encode())
            with installed.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            digest.update(b"\0")
    return digest.hexdigest()


def main() -> None:
    sampling = len(sys.argv) == 3 and sys.argv[2] == "--sample"
    if len(sys.argv) != 2 and not sampling:
        raise SystemExit(
            "usage: project-transform-reduce-polars.py FIXTURE.csv [--sample]"
        )
    result = (
        pl.scan_csv(sys.argv[1])
        .select((((pl.col("x") * 2.0 - pl.col("y")) ** 2).sum()).alias("result"))
        .collect()
        .item()
    )
    if sampling:
        print(result)
        return
    print(
        json.dumps(
            {
                "result": result,
                "peer_version": pl.__version__,
                "dependency_sha256": dependency_sha256(),
                "threads": pl.thread_pool_size(),
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
