from __future__ import annotations


class VFChr(str):
    """Runtime value for explicit VKF ``chr``."""

    def __new__(cls, value: str) -> "VFChr":
        if len(value) != 1:
            raise ValueError("chr value must contain exactly one character")
        return str.__new__(cls, value)
