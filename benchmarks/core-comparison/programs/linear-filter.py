def advance(x: float, i: float) -> float:
    return x * 0.9999997 + i * 0.0000001


def run(n: float) -> float:
    i = 0.0
    x = 1.0
    while i < n:
        x = advance(x, i)
        i += 1.0
    return x


print(format(run({{COUNT}}.0), '.17g'))
