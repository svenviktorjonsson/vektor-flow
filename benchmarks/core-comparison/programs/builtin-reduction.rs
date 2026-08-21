fn main() {
    let start = std::hint::black_box(1.0_f64);
    let mut values = [0.0_f64; {{COUNT}}];
    for (index, value) in values.iter_mut().enumerate() {
        *value = index as f64 + start;
    }
    let sum: f64 = values.iter().sum();
    println!("{:.17}", sum + sum / {{COUNT}}.0 + {{COUNT}}.0);
}
