use faer::{
    Mat, Par, Side, c64,
    linalg::solvers::{DenseSolveCore, Solve, SolveLstsq},
};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    hint::black_box,
    path::{Path, PathBuf},
    process::ExitCode,
    time::Instant,
};

const IMPLEMENTATION: &str = "faer 0.24.4";

struct Fixture {
    matrix: Mat<f64>,
    x_true: Option<Mat<f64>>,
    rhs: Option<Mat<f64>>,
    input_sha256: String,
}

#[derive(Default)]
struct Metrics {
    residual: Option<f64>,
    reconstruction: Option<f64>,
    orthogonality: Option<f64>,
    solution_error: Option<f64>,
}

struct Sample {
    elapsed_ms: f64,
    checksum: f64,
    metrics: Metrics,
}

fn fixture_spec(kernel: &str) -> Result<(&'static str, usize, usize, bool), String> {
    match kernel {
        "solve-general-96" | "lu-general-96" | "eigen-general-96" => {
            Ok(("general-96.f64le", 96, 96, true))
        }
        "least-squares-tall-96x48" | "qr-tall-96x48" | "svd-tall-96x48" => {
            Ok(("tall-96x48.f64le", 96, 48, true))
        }
        "cholesky-spd-96" | "eigen-symmetric-96" => Ok(("spd-96.f64le", 96, 96, false)),
        _ => Err(format!("unknown kernel {kernel}")),
    }
}

fn sha256_hex(payload: &[u8]) -> String {
    let digest = Sha256::digest(payload);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn load_fixture(
    kernel: &str,
    root: &Path,
    expected_sha256: Option<&str>,
) -> Result<Fixture, String> {
    let (file, rows, columns, has_system_vectors) = fixture_spec(kernel)?;
    let path = root.join(file);
    let payload = fs::read(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    let input_sha256 = sha256_hex(&payload);
    if let Some(expected) = expected_sha256 {
        if input_sha256 != expected {
            return Err(format!(
                "fixture hash mismatch: {input_sha256} != {expected}"
            ));
        }
    }
    if payload.len() % 8 != 0 {
        return Err(format!("{} is not an f64le stream", path.display()));
    }
    let values: Vec<f64> = payload
        .chunks_exact(8)
        .map(|bytes| f64::from_le_bytes(bytes.try_into().unwrap()))
        .collect();
    let matrix_length = rows * columns;
    let expected_values = matrix_length
        + if has_system_vectors {
            columns + rows
        } else {
            0
        };
    if values.len() != expected_values {
        return Err(format!(
            "{} contains {} values; expected {expected_values}",
            path.display(),
            values.len()
        ));
    }
    let matrix = Mat::from_fn(rows, columns, |row, column| values[row * columns + column]);
    let (x_true, rhs) = if has_system_vectors {
        let x_start = matrix_length;
        let rhs_start = x_start + columns;
        (
            Some(Mat::from_fn(columns, 1, |row, _| values[x_start + row])),
            Some(Mat::from_fn(rows, 1, |row, _| values[rhs_start + row])),
        )
    } else {
        (None, None)
    };
    Ok(Fixture {
        matrix,
        x_true,
        rhs,
        input_sha256,
    })
}

fn timed<T>(operation: impl Fn() -> T) -> (T, f64) {
    black_box(operation());
    let start = Instant::now();
    let result = black_box(operation());
    let elapsed_ms = start.elapsed().as_secs_f64() * 1_000.0;
    (result, elapsed_ms)
}

fn frobenius(matrix: &Mat<f64>) -> f64 {
    let mut sum = 0.0;
    for column in 0..matrix.ncols() {
        for row in 0..matrix.nrows() {
            sum += matrix[(row, column)] * matrix[(row, column)];
        }
    }
    sum.sqrt()
}

fn sum_matrix(matrix: &Mat<f64>) -> f64 {
    let mut sum = 0.0;
    for column in 0..matrix.ncols() {
        for row in 0..matrix.nrows() {
            sum += matrix[(row, column)];
        }
    }
    sum
}

fn relative(value: f64, scale: f64) -> f64 {
    value / scale.max(f64::MIN_POSITIVE)
}

fn difference_norm(left: &Mat<f64>, right: &Mat<f64>) -> f64 {
    assert_eq!((left.nrows(), left.ncols()), (right.nrows(), right.ncols()));
    let mut sum = 0.0;
    for column in 0..left.ncols() {
        for row in 0..left.nrows() {
            let difference = left[(row, column)] - right[(row, column)];
            sum += difference * difference;
        }
    }
    sum.sqrt()
}

fn matmul(left: &Mat<f64>, right: &Mat<f64>) -> Mat<f64> {
    assert_eq!(left.ncols(), right.nrows());
    Mat::from_fn(left.nrows(), right.ncols(), |row, column| {
        let mut sum = 0.0;
        for inner in 0..left.ncols() {
            sum += left[(row, inner)] * right[(inner, column)];
        }
        sum
    })
}

fn transpose_matmul(left: &Mat<f64>, right: &Mat<f64>) -> Mat<f64> {
    assert_eq!(left.nrows(), right.nrows());
    Mat::from_fn(left.ncols(), right.ncols(), |row, column| {
        let mut sum = 0.0;
        for inner in 0..left.nrows() {
            sum += left[(inner, row)] * right[(inner, column)];
        }
        sum
    })
}

fn matmul_transpose(left: &Mat<f64>, right: &Mat<f64>) -> Mat<f64> {
    assert_eq!(left.ncols(), right.ncols());
    Mat::from_fn(left.nrows(), right.nrows(), |row, column| {
        let mut sum = 0.0;
        for inner in 0..left.ncols() {
            sum += left[(row, inner)] * right[(column, inner)];
        }
        sum
    })
}

fn identity(size: usize) -> Mat<f64> {
    Mat::from_fn(
        size,
        size,
        |row, column| if row == column { 1.0 } else { 0.0 },
    )
}

fn scaled_columns(matrix: &Mat<f64>, scales: &[f64]) -> Mat<f64> {
    assert_eq!(matrix.ncols(), scales.len());
    Mat::from_fn(matrix.nrows(), matrix.ncols(), |row, column| {
        matrix[(row, column)] * scales[column]
    })
}

fn run(kernel: &str, fixture: &Fixture) -> Result<Sample, String> {
    let a = &fixture.matrix;
    let a_norm = frobenius(a);
    match kernel {
        "solve-general-96" => {
            let rhs = fixture.rhs.as_ref().unwrap();
            let x_true = fixture.x_true.as_ref().unwrap();
            let (x, elapsed_ms) = timed(|| a.partial_piv_lu().solve(rhs));
            let residual = difference_norm(&matmul(a, &x), rhs);
            Ok(Sample {
                elapsed_ms,
                checksum: sum_matrix(&x),
                metrics: Metrics {
                    residual: Some(relative(residual, a_norm * frobenius(&x) + frobenius(rhs))),
                    solution_error: Some(relative(difference_norm(&x, x_true), frobenius(x_true))),
                    ..Metrics::default()
                },
            })
        }
        "least-squares-tall-96x48" => {
            let rhs = fixture.rhs.as_ref().unwrap();
            let x_true = fixture.x_true.as_ref().unwrap();
            let (x, elapsed_ms) = timed(|| a.col_piv_qr().solve_lstsq(rhs));
            let residual_vector = &matmul(a, &x) - rhs;
            let normal_residual = transpose_matmul(a, &residual_vector);
            Ok(Sample {
                elapsed_ms,
                checksum: sum_matrix(&x),
                metrics: Metrics {
                    residual: Some(relative(
                        frobenius(&normal_residual),
                        a_norm * frobenius(&residual_vector),
                    )),
                    solution_error: Some(relative(difference_norm(&x, x_true), frobenius(x_true))),
                    ..Metrics::default()
                },
            })
        }
        "lu-general-96" => {
            let (lu, elapsed_ms) = timed(|| a.partial_piv_lu());
            let reconstructed = lu.reconstruct();
            let lower = lu.L().to_owned();
            let upper = lu.U().to_owned();
            Ok(Sample {
                elapsed_ms,
                checksum: sum_matrix(&lower) + sum_matrix(&upper),
                metrics: Metrics {
                    reconstruction: Some(relative(difference_norm(a, &reconstructed), a_norm)),
                    ..Metrics::default()
                },
            })
        }
        "qr-tall-96x48" => {
            let ((q, r), elapsed_ms) = timed(|| {
                let qr = a.qr();
                (qr.compute_thin_Q(), qr.thin_R().to_owned())
            });
            let reconstruction = matmul(&q, &r);
            let gram = transpose_matmul(&q, &q);
            Ok(Sample {
                elapsed_ms,
                checksum: sum_matrix(&q) + sum_matrix(&r),
                metrics: Metrics {
                    reconstruction: Some(relative(difference_norm(a, &reconstruction), a_norm)),
                    orthogonality: Some(relative(
                        difference_norm(&gram, &identity(q.ncols())),
                        q.ncols() as f64,
                    )),
                    ..Metrics::default()
                },
            })
        }
        "cholesky-spd-96" => {
            let (llt, elapsed_ms) = timed(|| a.llt(Side::Lower).unwrap());
            let lower = llt.L().to_owned();
            let reconstruction = matmul_transpose(&lower, &lower);
            Ok(Sample {
                elapsed_ms,
                checksum: sum_matrix(&lower),
                metrics: Metrics {
                    reconstruction: Some(relative(difference_norm(a, &reconstruction), a_norm)),
                    ..Metrics::default()
                },
            })
        }
        "svd-tall-96x48" => {
            let (svd, elapsed_ms) = timed(|| a.thin_svd().unwrap());
            let u = svd.U().to_owned();
            let v = svd.V().to_owned();
            let singular: Vec<f64> = svd.S().column_vector().iter().copied().collect();
            let reconstruction = matmul_transpose(&scaled_columns(&u, &singular), &v);
            let u_gram = transpose_matmul(&u, &u);
            let v_gram = transpose_matmul(&v, &v);
            let size = singular.len();
            Ok(Sample {
                elapsed_ms,
                checksum: singular.iter().sum(),
                metrics: Metrics {
                    reconstruction: Some(relative(difference_norm(a, &reconstruction), a_norm)),
                    orthogonality: Some(
                        relative(difference_norm(&u_gram, &identity(size)), size as f64).max(
                            relative(difference_norm(&v_gram, &identity(size)), size as f64),
                        ),
                    ),
                    ..Metrics::default()
                },
            })
        }
        "eigen-symmetric-96" => {
            let (eigen, elapsed_ms) = timed(|| a.self_adjoint_eigen(Side::Lower).unwrap());
            let vectors = eigen.U().to_owned();
            let values: Vec<f64> = eigen.S().column_vector().iter().copied().collect();
            let scaled_vectors = scaled_columns(&vectors, &values);
            let residual = &matmul(a, &vectors) - &scaled_vectors;
            let reconstruction = matmul_transpose(&scaled_vectors, &vectors);
            let gram = transpose_matmul(&vectors, &vectors);
            Ok(Sample {
                elapsed_ms,
                checksum: values.iter().sum(),
                metrics: Metrics {
                    residual: Some(relative(frobenius(&residual), a_norm)),
                    reconstruction: Some(relative(difference_norm(a, &reconstruction), a_norm)),
                    orthogonality: Some(relative(
                        difference_norm(&gram, &identity(values.len())),
                        values.len() as f64,
                    )),
                    ..Metrics::default()
                },
            })
        }
        "eigen-general-96" => {
            let (eigen, elapsed_ms) = timed(|| a.eigen().unwrap());
            let vectors = eigen.U();
            let values = eigen.S().column_vector();
            let mut residual_squared = 0.0;
            for column in 0..a.ncols() {
                for row in 0..a.nrows() {
                    let mut left = c64::new(0.0, 0.0);
                    for inner in 0..a.ncols() {
                        left += c64::from(a[(row, inner)]) * vectors[(inner, column)];
                    }
                    let difference = left - vectors[(row, column)] * values[column];
                    residual_squared += difference.norm_sqr();
                }
            }
            let checksum = values.iter().map(|value| value.re + value.im).sum();
            Ok(Sample {
                elapsed_ms,
                checksum,
                metrics: Metrics {
                    residual: Some(relative(residual_squared.sqrt(), a_norm)),
                    ..Metrics::default()
                },
            })
        }
        _ => Err(format!("unknown kernel {kernel}")),
    }
}

fn algorithm(kernel: &str) -> &'static str {
    match kernel {
        "solve-general-96" => "partial-pivot LU factorization and solve",
        "least-squares-tall-96x48" => "column-pivot QR least-squares solve",
        "lu-general-96" => "partial-pivot LU",
        "qr-tall-96x48" => "Householder QR with explicit thin Q",
        "cholesky-spd-96" => "LLT Cholesky",
        "svd-tall-96x48" => "thin SVD",
        "eigen-symmetric-96" => "self-adjoint eigendecomposition",
        "eigen-general-96" => "general real eigendecomposition",
        _ => unreachable!(),
    }
}

fn emit(kernel: &str, sample: &Sample, input_sha256: &str) {
    println!("elapsed_ms={:.17}", sample.elapsed_ms);
    println!("checksum={:.17}", sample.checksum);
    if let Some(value) = sample.metrics.residual {
        println!("residual={value:.17}");
    }
    if let Some(value) = sample.metrics.reconstruction {
        println!("reconstruction={value:.17}");
    }
    if let Some(value) = sample.metrics.orthogonality {
        println!("orthogonality={value:.17}");
    }
    if let Some(value) = sample.metrics.solution_error {
        println!("solution_error={value:.17}");
    }
    println!("input_sha256={input_sha256}");
    println!("implementation={IMPLEMENTATION}");
    println!("backend=faer native kernels; parallelism=sequential");
    println!("algorithm={}", algorithm(kernel));
}

fn real_main() -> Result<(), String> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    if arguments.as_slice() == ["--version"] {
        println!("{IMPLEMENTATION}; parallelism=sequential");
        return Ok(());
    }
    if !(arguments.len() == 2 || arguments.len() == 3) {
        return Err(
            "usage: vkf-linalg-faer-runner <kernel> <fixture-root> [expected-sha256]".into(),
        );
    }
    faer::set_global_parallelism(Par::Seq);
    let fixture_root = PathBuf::from(&arguments[1]);
    let fixture = load_fixture(
        &arguments[0],
        &fixture_root,
        arguments.get(2).map(String::as_str),
    )?;
    let sample = run(&arguments[0], &fixture)?;
    emit(&arguments[0], &sample, &fixture.input_sha256);
    Ok(())
}

fn main() -> ExitCode {
    match real_main() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
