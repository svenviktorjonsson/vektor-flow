const N: usize = 500;

fn matrix_value(row: usize, column: usize) -> f64 {
    let diagonal = row + column;
    1.0 / ((diagonal * (diagonal + 1) / 2 + row + 1) as f64)
}

fn multiply_av(input: &[f64; N], output: &mut [f64; N]) {
    for row in 0..N {
        let mut total = 0.0;
        for column in 0..N {
            total += matrix_value(row, column) * input[column];
        }
        output[row] = total;
    }
}

fn multiply_atv(input: &[f64; N], output: &mut [f64; N]) {
    for row in 0..N {
        let mut total = 0.0;
        for column in 0..N {
            total += matrix_value(column, row) * input[column];
        }
        output[row] = total;
    }
}

fn multiply_at_av(input: &[f64; N], output: &mut [f64; N]) {
    let mut temporary = [0.0; N];
    multiply_av(input, &mut temporary);
    multiply_atv(&temporary, output);
}

#[no_mangle]
pub extern "C" fn vkf_benchmark() -> f64 {
    let mut u = [1.0; N];
    let mut v = [0.0; N];
    for _ in 0..10 {
        multiply_at_av(&u, &mut v);
        multiply_at_av(&v, &mut u);
    }
    let mut numerator = 0.0;
    let mut denominator = 0.0;
    for index in 0..N {
        numerator += u[index] * v[index];
        denominator += v[index] * v[index];
    }
    (numerator / denominator).sqrt()
}

fn main() {
    println!("{:.17}", vkf_benchmark());
}
