#[derive(Clone, Copy)]
struct Vector4(f64, f64, f64, f64);

fn advance(v: Vector4) -> Vector4 {
    Vector4(
        v.0 * 1.0000001 + v.1 * 0.000001,
        v.1 * 0.9999999 - v.2 * 0.000001,
        v.2 * 1.0000002 + v.3 * 0.000001,
        v.3 * 0.9999998 - v.0 * 0.000001,
    )
}

fn run(n: f64) -> f64 {
    let mut i = 0.0;
    let mut v = Vector4(1.0, 2.0, 3.0, 4.0);
    while i < n {
        v = advance(v);
        i += 1.0;
    }
    v.0 + v.1 + v.2 + v.3
}

fn main() {
    println!("{:.17}", run(std::hint::black_box(75000.0)));
}
