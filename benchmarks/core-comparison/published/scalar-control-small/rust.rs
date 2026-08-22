fn advance(x: f64, i: f64) -> f64 {
    let y = x * 1.00000011920929 + i * 0.0000001;
    if y > 1000.0 { y - 999.5 } else { y }
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
    println!("{:.17}", run(std::hint::black_box(20000.0)));
}
