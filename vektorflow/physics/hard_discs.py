"""Event-driven 2D hard-disc collision detection and response.

This is the first collision slice for VKF physics: circular impostors for
vertices, frictionless pair contacts, hard frame boundaries, and exact analytic
positions between collision events.
"""

from __future__ import annotations

from dataclasses import dataclass
import heapq
import math
from typing import Iterable, Literal

Number = int | float
Vec2 = tuple[float, float]

_EPS = 1.0e-10


@dataclass(frozen=True)
class HardDisc:
    """A filled 2D collision impostor attached to a moving vertex."""

    x: float
    y: float
    vx: float
    vy: float
    radius: float
    density: float = 1.0

    @property
    def position(self) -> Vec2:
        return (self.x, self.y)

    @property
    def velocity(self) -> Vec2:
        return (self.vx, self.vy)

    @property
    def mass(self) -> float:
        return self.density * math.pi * self.radius * self.radius


@dataclass(frozen=True)
class HardDiscSnapshot:
    time: float
    discs: tuple[HardDisc, ...]

    @property
    def kinetic_energy(self) -> float:
        return sum(0.5 * disc.mass * (disc.vx * disc.vx + disc.vy * disc.vy) for disc in self.discs)

    @property
    def min_gap(self) -> float:
        gap = math.inf
        for i, a in enumerate(self.discs):
            for b in self.discs[i + 1 :]:
                dx = b.x - a.x
                dy = b.y - a.y
                gap = min(gap, math.hypot(dx, dy) - a.radius - b.radius)
        return gap


@dataclass(frozen=True)
class CollisionEvent:
    time: float
    kind: Literal["pair", "wall_x", "wall_y"]
    i: int
    j: int
    generation_i: int
    generation_j: int


class HardDiscWorld2D:
    """Exact event queue for frictionless, energy-conserving hard discs."""

    def __init__(self, discs: Iterable[HardDisc], *, width: Number = 1.0, height: Number = 1.0) -> None:
        self.width = float(width)
        self.height = float(height)
        if self.width <= 0.0 or self.height <= 0.0:
            raise ValueError("world width and height must be positive")
        self._discs = [HardDisc(**disc.__dict__) for disc in discs]
        if not self._discs:
            raise ValueError("hard-disc world needs at least one disc")
        self._validate_initial_state()
        self._time = 0.0
        self._generations = [0 for _ in self._discs]
        self._events: list[tuple[float, int, CollisionEvent]] = []
        self._next_event_id = 0
        self._schedule_all()

    @property
    def time(self) -> float:
        return self._time

    def snapshot(self) -> HardDiscSnapshot:
        return HardDiscSnapshot(self._time, tuple(self._discs))

    def advance_to(self, target_time: Number) -> HardDiscSnapshot:
        """Advance by consuming only queued collisions before ``target_time``."""

        target = float(target_time)
        if target < self._time - _EPS:
            raise ValueError("cannot advance hard-disc world backwards")
        while self._events and self._events[0][0] <= target + _EPS:
            _, _, event = heapq.heappop(self._events)
            if not self._is_valid(event):
                continue
            self._drift(event.time)
            if event.kind == "pair":
                self._resolve_pair(event.i, event.j)
                self._bump_and_reschedule(event.i, event.j)
            elif event.kind == "wall_x":
                self._resolve_wall_x(event.i)
                self._bump_and_reschedule(event.i)
            elif event.kind == "wall_y":
                self._resolve_wall_y(event.i)
                self._bump_and_reschedule(event.i)
        self._drift(target)
        return self.snapshot()

    def _validate_initial_state(self) -> None:
        for index, disc in enumerate(self._discs):
            if disc.radius <= 0.0:
                raise ValueError(f"disc {index} radius must be positive")
            if disc.density <= 0.0:
                raise ValueError(f"disc {index} density must be positive")
            if disc.mass <= 0.0:
                raise ValueError(f"disc {index} mass must be positive")
            if disc.x - disc.radius < -_EPS or disc.x + disc.radius > self.width + _EPS:
                raise ValueError(f"disc {index} overlaps the x boundary")
            if disc.y - disc.radius < -_EPS or disc.y + disc.radius > self.height + _EPS:
                raise ValueError(f"disc {index} overlaps the y boundary")
        for i, a in enumerate(self._discs):
            for j, b in enumerate(self._discs[i + 1 :], start=i + 1):
                if math.hypot(b.x - a.x, b.y - a.y) < a.radius + b.radius - _EPS:
                    raise ValueError(f"discs {i} and {j} overlap")

    def _schedule_all(self) -> None:
        for i in range(len(self._discs)):
            self._schedule_body(i)
        for i in range(len(self._discs)):
            for j in range(i + 1, len(self._discs)):
                self._schedule_pair(i, j)

    def _schedule_body(self, i: int) -> None:
        self._schedule_wall_x(i)
        self._schedule_wall_y(i)
        for j in range(len(self._discs)):
            if i == j:
                continue
            self._schedule_pair(min(i, j), max(i, j))

    def _push_event(self, event: CollisionEvent) -> None:
        self._next_event_id += 1
        heapq.heappush(self._events, (event.time, self._next_event_id, event))

    def _schedule_pair(self, i: int, j: int) -> None:
        dt = self._time_to_pair_collision(i, j)
        if dt is None:
            return
        self._push_event(
            CollisionEvent(
                self._time + dt,
                "pair",
                i,
                j,
                self._generations[i],
                self._generations[j],
            )
        )

    def _schedule_wall_x(self, i: int) -> None:
        disc = self._discs[i]
        dt = None
        if disc.vx < -_EPS:
            dt = (disc.radius - disc.x) / disc.vx
        elif disc.vx > _EPS:
            dt = (self.width - disc.radius - disc.x) / disc.vx
        if dt is not None and dt > _EPS:
            self._push_event(CollisionEvent(self._time + dt, "wall_x", i, -1, self._generations[i], -1))

    def _schedule_wall_y(self, i: int) -> None:
        disc = self._discs[i]
        dt = None
        if disc.vy < -_EPS:
            dt = (disc.radius - disc.y) / disc.vy
        elif disc.vy > _EPS:
            dt = (self.height - disc.radius - disc.y) / disc.vy
        if dt is not None and dt > _EPS:
            self._push_event(CollisionEvent(self._time + dt, "wall_y", i, -1, self._generations[i], -1))

    def _time_to_pair_collision(self, i: int, j: int) -> float | None:
        a = self._discs[i]
        b = self._discs[j]
        dx = b.x - a.x
        dy = b.y - a.y
        dvx = b.vx - a.vx
        dvy = b.vy - a.vy
        aa = dvx * dvx + dvy * dvy
        if aa <= _EPS:
            return None
        bb = 2.0 * (dx * dvx + dy * dvy)
        rr = a.radius + b.radius
        cc = dx * dx + dy * dy - rr * rr
        if bb >= -_EPS:
            return None
        discriminant = bb * bb - 4.0 * aa * cc
        if discriminant < 0.0:
            return None
        dt = (-bb - math.sqrt(max(0.0, discriminant))) / (2.0 * aa)
        return dt if dt > _EPS else None

    def _is_valid(self, event: CollisionEvent) -> bool:
        if event.time < self._time - _EPS:
            return False
        if event.generation_i != self._generations[event.i]:
            return False
        return event.j < 0 or event.generation_j == self._generations[event.j]

    def _drift(self, target_time: float) -> None:
        dt = target_time - self._time
        if dt <= _EPS:
            self._time = max(self._time, target_time)
            return
        self._discs = [
            HardDisc(
                disc.x + disc.vx * dt,
                disc.y + disc.vy * dt,
                disc.vx,
                disc.vy,
                disc.radius,
                disc.density,
            )
            for disc in self._discs
        ]
        self._time = target_time

    def _resolve_pair(self, i: int, j: int) -> None:
        a = self._discs[i]
        b = self._discs[j]
        dx = b.x - a.x
        dy = b.y - a.y
        distance = math.hypot(dx, dy)
        if distance <= _EPS:
            return
        nx = dx / distance
        ny = dy / distance
        relative_normal_speed = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
        if relative_normal_speed <= _EPS:
            return
        impulse = 2.0 * relative_normal_speed / (a.mass + b.mass)
        self._discs[i] = HardDisc(
            a.x,
            a.y,
            a.vx - impulse * b.mass * nx,
            a.vy - impulse * b.mass * ny,
            a.radius,
            a.density,
        )
        self._discs[j] = HardDisc(
            b.x,
            b.y,
            b.vx + impulse * a.mass * nx,
            b.vy + impulse * a.mass * ny,
            b.radius,
            b.density,
        )

    def _resolve_wall_x(self, i: int) -> None:
        disc = self._discs[i]
        self._discs[i] = HardDisc(disc.x, disc.y, -disc.vx, disc.vy, disc.radius, disc.density)

    def _resolve_wall_y(self, i: int) -> None:
        disc = self._discs[i]
        self._discs[i] = HardDisc(disc.x, disc.y, disc.vx, -disc.vy, disc.radius, disc.density)

    def _bump_and_reschedule(self, *indices: int) -> None:
        for index in indices:
            self._generations[index] += 1
        for index in indices:
            self._schedule_body(index)
