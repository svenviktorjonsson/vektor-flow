"""Module entrypoint that delegates to the ``vkf`` CLI."""

from __future__ import annotations

from .cli import vkf_entry

if __name__ == "__main__":
    vkf_entry()
