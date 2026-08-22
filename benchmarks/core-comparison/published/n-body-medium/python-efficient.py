from math import sqrt

solar = 39.478417604357434
days = 365.24
bodies = [
    [0., 0., 0., 0., 0., 0., solar],
    [4.841431442464721, -1.1603200440274284, -0.10362204447112311, 0.001660076642744037*days, 0.007699011184197404*days, -0.0000690460016972063*days, 0.0009547919384243266*solar],
    [8.34336671824458, 4.124798564124305, -0.4035234171143214, -0.002767425107268624*days, 0.004998528012349172*days, 0.000023041729757376393*days, 0.0002858859806661308*solar],
    [12.894369562139131, -15.111151401698631, -0.22330757889265573, 0.002964601375647616*days, 0.0023784717395948095*days, -0.000029658956854023756*days, 0.00004366244043351563*solar],
    [15.379697114850917, -25.919314609987964, 0.17925877295037118, 0.0026806777249038932*days, 0.001628241700382423*days, -0.00009515922545197159*days, 0.000051513890204661146*solar],
]
px = sum(body[3] * body[6] for body in bodies)
py = sum(body[4] * body[6] for body in bodies)
pz = sum(body[5] * body[6] for body in bodies)
bodies[0][3:6] = [-px / solar, -py / solar, -pz / solar]
for _ in range(10000):
    for i in range(5):
        for j in range(i + 1, 5):
            a, b = bodies[i], bodies[j]
            dx, dy, dz = a[0]-b[0], a[1]-b[1], a[2]-b[2]
            squared = dx*dx + dy*dy + dz*dz
            magnitude = 0.01 / (squared * sqrt(squared))
            a[3] -= dx*b[6]*magnitude; a[4] -= dy*b[6]*magnitude; a[5] -= dz*b[6]*magnitude
            b[3] += dx*a[6]*magnitude; b[4] += dy*a[6]*magnitude; b[5] += dz*a[6]*magnitude
    for body in bodies:
        body[0] += 0.01*body[3]; body[1] += 0.01*body[4]; body[2] += 0.01*body[5]
result = 0.0
for i, a in enumerate(bodies):
    result += 0.5*a[6]*(a[3]*a[3] + a[4]*a[4] + a[5]*a[5])
    for b in bodies[i+1:]:
        dx, dy, dz = a[0]-b[0], a[1]-b[1], a[2]-b[2]
        result -= a[6]*b[6] / sqrt(dx*dx + dy*dy + dz*dz)
print(format(result, '.17g'))
