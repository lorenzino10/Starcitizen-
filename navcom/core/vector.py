"""Vettori 3D in metri.

Implementazione volutamente semplice (niente numpy) per rendere ogni calcolo
leggibile e verificabile a mano. I float Python sono double IEEE-754: con
coordinate dell'ordine di 1e11 m l'errore relativo e' ~1e-16, cioe' molto
sotto il millimetro, quindi irrilevante rispetto alla precisione dei dati.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Vec3:
    x: float
    y: float
    z: float

    def __add__(self, o: "Vec3") -> "Vec3":
        return Vec3(self.x + o.x, self.y + o.y, self.z + o.z)

    def __sub__(self, o: "Vec3") -> "Vec3":
        return Vec3(self.x - o.x, self.y - o.y, self.z - o.z)

    def __mul__(self, k: float) -> "Vec3":
        return Vec3(self.x * k, self.y * k, self.z * k)

    __rmul__ = __mul__

    def dot(self, o: "Vec3") -> float:
        return self.x * o.x + self.y * o.y + self.z * o.z

    def norm2(self) -> float:
        return self.dot(self)

    def norm(self) -> float:
        return math.sqrt(self.norm2())

    def as_tuple(self) -> tuple[float, float, float]:
        return (self.x, self.y, self.z)

    @staticmethod
    def of(seq) -> "Vec3":
        x, y, z = seq
        return Vec3(float(x), float(y), float(z))


ORIGIN = Vec3(0.0, 0.0, 0.0)


def distance(a: Vec3, b: Vec3) -> float:
    """Distanza euclidea 3D in metri."""
    return (b - a).norm()
