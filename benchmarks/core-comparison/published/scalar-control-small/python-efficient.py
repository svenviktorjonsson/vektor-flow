def advance(x: float, i: float) -> float:
    y = x * 1.00000011920929 + i * 0.0000001
    return y - 999.5 if y > 1000.0 else y


def run(n: float) -> float:
    i = 0.0
    x = 1.0
    while i < n:
        x = advance(x, i)
        i += 1.0
    return x


print(format(run(20000.0), '.17g'))
