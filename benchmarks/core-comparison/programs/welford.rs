#[derive(Clone, Copy)]
struct State {
    count: f64,
    mean: f64,
    m2: f64,
}

fn welford_step(state: State, value: f64) -> State {
    let count = state.count + 1.0;
    let delta = value - state.mean;
    let mean = state.mean + delta / count;
    let delta2 = value - mean;
    State { count, mean, m2: state.m2 + delta * delta2 }
}

fn population_stddev(data: &[f64]) -> f64 {
    let mut state = State { count: 0.0, mean: 0.0, m2: 0.0 };
    for &value in data {
        state = welford_step(state, value);
    }
    (state.m2 / state.count).sqrt()
}

fn main() {
    let values = std::hint::black_box(vec![{{VALUES}}]);
    println!("{:.17}", population_stddev(&values));
}
