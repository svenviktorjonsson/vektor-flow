#[derive(Clone, Copy)]
struct ValueError;

fn validated_integer(value: f64) -> Result<i64, ValueError> {
    if value.floor() == value {
        Ok(value as i64)
    } else {
        Err(ValueError)
    }
}

fn count_valid_integers(data: &[f64]) -> u64 {
    let mut accepted = 0_u64;
    for &value in data {
        match validated_integer(value) {
            Ok(_) => accepted += 1,
            Err(ValueError) => {}
        }
    }
    accepted
}

fn main() {
    let values = std::hint::black_box(vec![{{VALIDATION_VALUES}}]);
    println!("{}", count_valid_integers(&values));
}
