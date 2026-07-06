"""3D hard-sphere collision slice for VKF physics."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable

Number = int | float
Vec3 = tuple[float, float, float]

_EPS = 1.0e-10


@dataclass(frozen=True, slots=True)
class HardSphere:
    x: float
    y: float
    z: float
    vx: float
    vy: float
    vz: float
    radius: float
    density: float = 1.0

    @property
    def mass(self) -> float:
        return self.density * (4.0 / 3.0) * math.pi * self.radius**3


@dataclass(frozen=True, slots=True)
class HardSphereSnapshot:
    time: float
    spheres: tuple[HardSphere, ...]

    @property
    def kinetic_energy(self) -> float:
        return sum(0.5 * s.mass * (s.vx * s.vx + s.vy * s.vy + s.vz * s.vz) for s in self.spheres)

    @property
    def min_gap(self) -> float:
        gap = math.inf
        for i, a in enumerate(self.spheres):
            for b in self.spheres[i + 1 :]:
                gap = min(gap, math.dist((a.x, a.y, a.z), (b.x, b.y, b.z)) - a.radius - b.radius)
        return gap


class HardSphereWorld3D:
    """Small-to-medium 3D hard-sphere world with conservative projection."""

    def __init__(
        self,
        spheres: Iterable[HardSphere],
        *,
        width: Number = 1.0,
        depth: Number = 1.0,
        height: Number = 1.0,
        restitution: Number = 1.0,
        gravity: Vec3 = (0.0, 0.0, -9.81),
    ) -> None:
        self.width = float(width)
        self.depth = float(depth)
        self.height = float(height)
        self.restitution = max(0.0, min(1.0, float(restitution)))
        self.gravity = (float(gravity[0]), float(gravity[1]), float(gravity[2]))
        self._spheres = [
            HardSphere(s.x, s.y, s.z, s.vx, s.vy, s.vz, s.radius, s.density)
            for s in spheres
        ]
        if not self._spheres:
            raise ValueError("hard-sphere world needs at least one sphere")
        self._validate_initial_state()
        self._time = 0.0
        self._max_step = 1.0 / 480.0
        self._contact_iterations = 4

    @property
    def time(self) -> float:
        return self._time

    def snapshot(self) -> HardSphereSnapshot:
        return HardSphereSnapshot(self._time, tuple(self._spheres))

    def min_gap(self) -> float:
        return self.snapshot().min_gap

    def advance_to(self, target_time: Number) -> HardSphereSnapshot:
        target = float(target_time)
        if target < self._time - _EPS:
            raise ValueError("cannot advance hard-sphere world backwards")
        while self._time < target - _EPS:
            dt = min(target - self._time, self._max_step)
            self._step(dt)
            self._time += dt
        return self.snapshot()

    def _step(self, dt: float) -> None:
        gx, gy, gz = self.gravity
        next_spheres = []
        for s in self._spheres:
            next_spheres.append(
                HardSphere(
                    s.x + s.vx * dt + 0.5 * gx * dt * dt,
                    s.y + s.vy * dt + 0.5 * gy * dt * dt,
                    s.z + s.vz * dt + 0.5 * gz * dt * dt,
                    s.vx + gx * dt,
                    s.vy + gy * dt,
                    s.vz + gz * dt,
                    s.radius,
                    s.density,
                )
            )
        self._spheres = next_spheres
        for _ in range(self._contact_iterations):
            for i in range(len(self._spheres)):
                self._resolve_wall(i)
            for i in range(len(self._spheres)):
                for j in range(i + 1, len(self._spheres)):
                    self._resolve_pair(i, j)
        for i in range(len(self._spheres)):
            self._resolve_wall(i)

    def _resolve_wall(self, index: int) -> None:
        s = self._spheres[index]
        x, y, z = s.x, s.y, s.z
        vx, vy, vz = s.vx, s.vy, s.vz
        r = s.radius
        if x < r:
            x = r
            vx = abs(vx) * self.restitution
        elif x > self.width - r:
            x = self.width - r
            vx = -abs(vx) * self.restitution
        if y < r:
            y = r
            vy = abs(vy) * self.restitution
        elif y > self.depth - r:
            y = self.depth - r
            vy = -abs(vy) * self.restitution
        if z < r:
            z = r
            vz = abs(vz) * self.restitution
        elif z > self.height - r:
            z = self.height - r
            vz = -abs(vz) * self.restitution
        if (x, y, z, vx, vy, vz) != (s.x, s.y, s.z, s.vx, s.vy, s.vz):
            self._spheres[index] = HardSphere(x, y, z, vx, vy, vz, r, s.density)

    def _resolve_pair(self, i: int, j: int) -> None:
        a = self._spheres[i]
        b = self._spheres[j]
        dx = b.x - a.x
        dy = b.y - a.y
        dz = b.z - a.z
        min_distance = a.radius + b.radius
        dist_sq = dx * dx + dy * dy + dz * dz
        if dist_sq >= min_distance * min_distance:
            return
        distance = math.sqrt(dist_sq) if dist_sq > _EPS else 0.0
        if distance > _EPS:
            nx, ny, nz = dx / distance, dy / distance, dz / distance
        else:
            nx, ny, nz = 1.0, 0.0, 0.0
        overlap = min_distance - distance
        inv_a = 1.0 / a.mass
        inv_b = 1.0 / b.mass
        inv_sum = inv_a + inv_b
        correction = overlap / inv_sum
        ax = a.x - nx * correction * inv_a
        ay = a.y - ny * correction * inv_a
        az = a.z - nz * correction * inv_a
        bx = b.x + nx * correction * inv_b
        by = b.y + ny * correction * inv_b
        bz = b.z + nz * correction * inv_b
        relative_normal_speed = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz
        avx, avy, avz = a.vx, a.vy, a.vz
        bvx, bvy, bvz = b.vx, b.vy, b.vz
        if relative_normal_speed > 0.0:
            impulse = (1.0 + self.restitution) * relative_normal_speed / inv_sum
            avx -= impulse * inv_a * nx
            avy -= impulse * inv_a * ny
            avz -= impulse * inv_a * nz
            bvx += impulse * inv_b * nx
            bvy += impulse * inv_b * ny
            bvz += impulse * inv_b * nz
        self._spheres[i] = HardSphere(ax, ay, az, avx, avy, avz, a.radius, a.density)
        self._spheres[j] = HardSphere(bx, by, bz, bvx, bvy, bvz, b.radius, b.density)

    def _validate_initial_state(self) -> None:
        for index, s in enumerate(self._spheres):
            if s.radius <= 0.0:
                raise ValueError(f"sphere {index} radius must be positive")
            if s.density <= 0.0:
                raise ValueError(f"sphere {index} density must be positive")
            if s.x - s.radius < -_EPS or s.x + s.radius > self.width + _EPS:
                raise ValueError(f"sphere {index} overlaps the x boundary")
            if s.y - s.radius < -_EPS or s.y + s.radius > self.depth + _EPS:
                raise ValueError(f"sphere {index} overlaps the y boundary")
            if s.z - s.radius < -_EPS or s.z + s.radius > self.height + _EPS:
                raise ValueError(f"sphere {index} overlaps the z boundary")
        for i, a in enumerate(self._spheres):
            for j, b in enumerate(self._spheres[i + 1 :], start=i + 1):
                if math.dist((a.x, a.y, a.z), (b.x, b.y, b.z)) < a.radius + b.radius - _EPS:
                    raise ValueError(f"spheres {i} and {j} overlap")


def demo_hard_spheres(count: Number = 100, width: Number = 3.0, depth: Number = 2.0, height: Number = 2.0) -> tuple[HardSphere, ...]:
    n = max(1, int(count))
    world_w = float(width)
    world_d = float(depth)
    world_h = float(height)
    cols = max(1, math.ceil(n ** (1.0 / 3.0) * (world_w / world_d) ** (1.0 / 3.0)))
    rows = max(1, math.ceil(math.sqrt(n / cols)))
    layers = math.ceil(n / (cols * rows))
    cell_w = world_w / cols
    cell_d = world_d / rows
    cell_h = world_h / layers
    radius = min(cell_w, cell_d, cell_h) * 0.22
    out: list[HardSphere] = []
    for index in range(n):
        col = index % cols
        row = (index // cols) % rows
        layer = index // (cols * rows)
        x = (col + 0.5) * cell_w
        y = (row + 0.5) * cell_d
        z = (layer + 0.5) * cell_h
        angle = ((index * 137) % 360) * math.pi / 180.0
        speed = 0.95 + 0.45 * ((index * 17) % 11) / 10.0
        density = 0.75 + (3.70 - 0.75) * ((index * 23) % 101) / 100.0
        out.append(
            HardSphere(
                x,
                y,
                z,
                math.cos(angle) * speed,
                math.sin(angle) * speed,
                0.25 * math.sin(angle * 0.7),
                radius * (0.78 + 0.18 * ((index * 7) % 5) / 4.0),
                density,
            )
        )
    return tuple(out)
