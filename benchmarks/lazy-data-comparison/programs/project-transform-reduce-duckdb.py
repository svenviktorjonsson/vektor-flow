import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys

import duckdb


QUERY = (
    "SELECT sum(pow(2 * x - y, 2)) AS result "
    "FROM read_csv(?)"
)


def distribution_sha256() -> str:
    digest = hashlib.sha256()
    distribution = importlib.metadata.distribution("duckdb")
    if distribution.version != duckdb.__version__:
        raise RuntimeError("DuckDB import and distribution versions differ")
    name = (distribution.metadata.get("Name") or "").lower().replace("_", "-")
    digest.update(f"distribution\0{name}\0{distribution.version}\0".encode())
    files = distribution.files
    if not files:
        raise RuntimeError("DuckDB distribution file metadata is unavailable")
    for relative in sorted(files, key=lambda path: path.as_posix()):
        if "__pycache__" in relative.parts or relative.suffix == ".pyc":
            continue
        installed = Path(distribution.locate_file(relative))
        if not installed.is_file():
            raise RuntimeError(f"DuckDB dependency file is missing: {relative}")
        digest.update(f"file\0{relative.as_posix()}\0".encode())
        with installed.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def csv_projection(plan: object) -> list[str]:
    matches: list[list[str]] = []

    def visit(node: object) -> None:
        if not isinstance(node, dict):
            return
        name = node.get("name")
        if name in {"READ_CSV", "READ_CSV_AUTO"}:
            info = node.get("extra_info")
            columns = info.get("Projections") if isinstance(info, dict) else None
            if isinstance(columns, list) and all(isinstance(column, str) for column in columns):
                matches.append(columns)
        for child in node.get("children", []):
            visit(child)

    if isinstance(plan, list):
        for root in plan:
            visit(root)
    if len(matches) != 1:
        raise RuntimeError("DuckDB plan did not expose one CSV projection")
    return matches[0]


def main() -> None:
    sampling = len(sys.argv) == 4 and sys.argv[3] == "--sample"
    if len(sys.argv) != 3 and not sampling:
        raise SystemExit(
            "usage: project-transform-reduce-duckdb.py FIXTURE.csv THREADS [--sample]"
        )
    threads = int(sys.argv[2])
    if threads < 1:
        raise RuntimeError("DuckDB threads must be positive")
    connection = duckdb.connect(":memory:", config={"threads": str(threads)})
    try:
        if not sampling:
            _, encoded_plan = connection.execute(
                f"EXPLAIN (FORMAT JSON) {QUERY}",
                [sys.argv[1]],
            ).fetchone()
            projected_columns = csv_projection(json.loads(encoded_plan))
        result = connection.execute(QUERY, [sys.argv[1]]).fetchone()[0]
        if not sampling:
            configured_threads = connection.execute(
                "SELECT current_setting('threads')"
            ).fetchone()[0]
    finally:
        connection.close()
    if sampling:
        print(result)
        return
    print(
        json.dumps(
            {
                "result": result,
                "peer_version": duckdb.__version__,
                "distribution_sha256": distribution_sha256(),
                "threads": configured_threads,
                "projected_columns": projected_columns,
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
