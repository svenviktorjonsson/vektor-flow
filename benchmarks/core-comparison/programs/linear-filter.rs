fn advance(x: f64, i: f64) -> f64 {
    x * 0.9999997 + i * 0.0000001
}

fn run(n: f64) -> f64 {
    let mut i = 0.0;
    let mut x = 1.0;
    while i < n {
        x = advance(x, i);
        i += 1.0;
    }
    x
}

fn main() {
    println!("{:.17}", run(std::hint::black_box({{COUNT}}.0)));
}
