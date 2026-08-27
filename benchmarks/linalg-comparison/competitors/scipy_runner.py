import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import scipy
import scipy.linalg as la


def load_fixture(root: Path, name: str):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    spec = manifest["fixtures"][name]
    path = root / spec["file"]
    payload = path.read_bytes()
    actual_hash = hashlib.sha256(payload).hexdigest()
    if actual_hash != spec["sha256"]:
        raise RuntimeError(f"fixture hash mismatch: {actual_hash} != {spec['sha256']}")
    values = np.frombuffer(payload, dtype="<f8")
    arrays = {}
    for key, descriptor in spec["arrays"].items():
        start = descriptor["offsetElements"]
        arrays[key] = values[start:start + descriptor["length"]]
    if "matrix" in arrays:
        arrays["matrix"] = arrays["matrix"].reshape(spec["rows"], spec["columns"])
    return arrays, actual_hash


def relative(value, scale):
    return float(value / max(float(scale), np.finfo(np.float64).tiny))


def timed(prepare, operation):
    operation(prepare())  # initialize dispatch, LAPACK, and allocator before measurement
    prepared = prepare()
    start = time.perf_counter_ns()
    result = operation(prepared)
    elapsed_ms = (time.perf_counter_ns() - start) / 1_000_000
    return result, elapsed_ms


def run(kernel: str, fixture_root: Path, expected_hash: str):
    if kernel in {"solve-general-96", "lu-general-96", "eigen-general-96"}:
        fixture = "general-96"
    elif kernel in {"least-squares-tall-96x48", "qr-tall-96x48", "svd-tall-96x48"}:
        fixture = "tall-96x48"
    elif kernel in {"cholesky-spd-96", "eigen-symmetric-96"}:
        fixture = "spd-96"
    else:
        raise ValueError(f"unknown kernel {kernel}")
    arrays, input_hash = load_fixture(fixture_root, fixture)
    if input_hash != expected_hash:
        raise RuntimeError(f"fixture argument mismatch: {input_hash} != {expected_hash}")
    a = np.asarray(arrays["matrix"], dtype=np.float64)
    a_norm = la.norm(a, "fro")
    metrics = {}

    if kernel == "solve-general-96":
        algorithm = "LAPACK general solve"
        b = np.asarray(arrays["rhs"], dtype=np.float64)
        x_true = np.asarray(arrays["x_true"], dtype=np.float64)

        def prepare():
            return np.array(a, order="F", copy=True), np.array(b, copy=True)

        def operation(prepared):
            return la.solve(
                prepared[0], prepared[1],
                assume_a="gen", overwrite_a=True, overwrite_b=True, check_finite=False,
            )

        x, elapsed_ms = timed(prepare, operation)
        metrics["residual"] = relative(la.norm(a @ x - b), a_norm * la.norm(x) + la.norm(b))
        metrics["solution_error"] = relative(la.norm(x - x_true), la.norm(x_true))
        checksum = float(np.sum(x))
    elif kernel == "least-squares-tall-96x48":
        algorithm = "LAPACK gelsy pivoted QR"
        b = np.asarray(arrays["rhs"], dtype=np.float64)
        x_true = np.asarray(arrays["x_true"], dtype=np.float64)

        def prepare():
            return np.array(a, order="F", copy=True), np.array(b, copy=True)

        def operation(prepared):
            return la.lstsq(
                prepared[0], prepared[1],
                overwrite_a=True, overwrite_b=True, check_finite=False, lapack_driver="gelsy",
            )[0]

        x, elapsed_ms = timed(prepare, operation)
        residual = a @ x - b
        metrics["residual"] = relative(la.norm(a.T @ residual), a_norm * la.norm(residual))
        metrics["solution_error"] = relative(la.norm(x - x_true), la.norm(x_true))
        checksum = float(np.sum(x))
    elif kernel == "lu-general-96":
        algorithm = "LAPACK partial-pivot LU"
        def prepare():
            return np.array(a, order="F", copy=True)

        def operation(prepared):
            return la.lu_factor(prepared, overwrite_a=True, check_finite=False)

        (packed, pivots), elapsed_ms = timed(prepare, operation)
        lower = np.tril(packed, -1) + np.eye(packed.shape[0])
        upper = np.triu(packed)
        permutation = np.eye(packed.shape[0])
        for row, pivot in enumerate(pivots):
            permutation[[row, pivot], :] = permutation[[pivot, row], :]
        metrics["reconstruction"] = relative(
            la.norm(permutation @ a - lower @ upper, "fro"), a_norm,
        )
        checksum = float(np.sum(packed) + np.sum(pivots))
    elif kernel == "qr-tall-96x48":
        algorithm = "LAPACK economic QR"
        def prepare():
            return np.array(a, order="F", copy=True)

        def operation(prepared):
            return la.qr(
                prepared, mode="economic",
                overwrite_a=True, check_finite=False,
            )

        (q, r), elapsed_ms = timed(prepare, operation)
        identity = np.eye(q.shape[1])
        metrics["reconstruction"] = relative(la.norm(a - q @ r, "fro"), a_norm)
        metrics["orthogonality"] = relative(la.norm(q.T @ q - identity, "fro"), q.shape[1])
        checksum = float(np.sum(q) + np.sum(r))
    elif kernel == "cholesky-spd-96":
        algorithm = "LAPACK lower Cholesky"
        def prepare():
            return np.array(a, order="F", copy=True)

        def operation(prepared):
            return la.cholesky(
                prepared, lower=True,
                overwrite_a=True, check_finite=False,
            )

        lower, elapsed_ms = timed(prepare, operation)
        metrics["reconstruction"] = relative(la.norm(a - lower @ lower.T, "fro"), a_norm)
        checksum = float(np.sum(lower))
    elif kernel == "svd-tall-96x48":
        algorithm = "LAPACK gesdd thin SVD"
        def prepare():
            return np.array(a, order="F", copy=True)

        def operation(prepared):
            return la.svd(
                prepared, full_matrices=False,
                overwrite_a=True, check_finite=False, lapack_driver="gesdd",
            )

        (u, singular, vh), elapsed_ms = timed(prepare, operation)
        identity = np.eye(singular.size)
        metrics["reconstruction"] = relative(
            la.norm(a - (u * singular) @ vh, "fro"), a_norm,
        )
        metrics["orthogonality"] = max(
            relative(la.norm(u.T @ u - identity, "fro"), singular.size),
            relative(la.norm(vh @ vh.T - identity, "fro"), singular.size),
        )
        checksum = float(np.sum(singular))
    elif kernel == "eigen-symmetric-96":
        algorithm = "LAPACK evd symmetric eigen"
        def prepare():
            return np.array(a, order="F", copy=True)

        def operation(prepared):
            return la.eigh(
                prepared, lower=True,
                overwrite_a=True, check_finite=False, driver="evd",
            )

        (eigenvalues, eigenvectors), elapsed_ms = timed(prepare, operation)
        identity = np.eye(eigenvalues.size)
        metrics["residual"] = relative(
            la.norm(a @ eigenvectors - eigenvectors * eigenvalues, "fro"), a_norm,
        )
        metrics["reconstruction"] = relative(
            la.norm(a - (eigenvectors * eigenvalues) @ eigenvectors.T, "fro"), a_norm,
        )
        metrics["orthogonality"] = relative(
            la.norm(eigenvectors.T @ eigenvectors - identity, "fro"), eigenvalues.size,
        )
        checksum = float(np.sum(eigenvalues))
    else:
        algorithm = "LAPACK geev general eigen"

        def prepare():
            return np.array(a, order="F", copy=True)

        def operation(prepared):
            return la.eig(
                prepared, left=False, right=True,
                overwrite_a=True, check_finite=False,
            )

        (eigenvalues, eigenvectors), elapsed_ms = timed(prepare, operation)
        metrics["residual"] = relative(
            la.norm(a @ eigenvectors - eigenvectors * eigenvalues, "fro"), a_norm,
        )
        checksum = float(np.sum(eigenvalues.real) + np.sum(eigenvalues.imag))

    print(f"elapsed_ms={elapsed_ms:.17g}")
    print(f"checksum={checksum:.17g}")
    for name, value in metrics.items():
        print(f"{name}={value:.17g}")
    print(f"input_sha256={input_hash}")
    print(f"implementation=SciPy {scipy.__version__}")
    blas = np.__config__.CONFIG.get("Build Dependencies", {}).get("blas", {})
    print(f"backend={blas.get('name', 'unknown')} {blas.get('version', 'unknown')}")
    print(f"algorithm={algorithm}")


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--version":
        print(f"SciPy {scipy.__version__}; NumPy {np.__version__}")
        return
    if len(sys.argv) != 4:
        raise SystemExit("usage: scipy_runner.py <kernel> <fixture-root> <expected-sha256>")
    run(sys.argv[1], Path(sys.argv[2]), sys.argv[3])


if __name__ == "__main__":
    main()
