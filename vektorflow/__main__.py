"""Allow ``python -m vektorflow`` as an alias for the ``vkf`` CLI."""

from __future__ import annotations

from .cli import vkf_entry

if __name__ == "__main__":
    vkf_entry()
