#[derive(Clone, Copy)]
struct State { x: f64, y: f64, vx: f64, vy: f64 }

fn advance(state: State) -> State {
    State {
        x: state.x + state.vx,
        y: state.y + state.vy,
        vx: state.vx * 0.999999 + state.y * 0.000001,
        vy: state.vy * 0.999998 - state.x * 0.000001,
    }
}

fn run(n: f64) -> f64 {
    let mut i = 0.0;
    let mut state = State { x: 1.0, y: 2.0, vx: 0.01, vy: 0.02 };
    while i < n {
        state = advance(state);
        i += 1.0;
    }
    state.x + state.y + state.vx + state.vy
}

fn main() {
    println!("{:.17}", run(std::hint::black_box({{COUNT}}.0)));
}
