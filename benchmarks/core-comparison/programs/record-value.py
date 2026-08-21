def advance(state: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    x, y, vx, vy = state
    return (
        x + vx,
        y + vy,
        vx * 0.999999 + y * 0.000001,
        vy * 0.999998 - x * 0.000001,
    )


def run(n: float) -> float:
    i = 0.0
    state = (1.0, 2.0, 0.01, 0.02)
    while i < n:
        state = advance(state)
        i += 1.0
    return sum(state)


print(format(run({{COUNT}}.0), '.17g'))
