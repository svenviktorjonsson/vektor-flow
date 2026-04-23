"""Pytest defaults: disable UI host auto-launch (see vektorflow.ui.launch)."""

from __future__ import annotations

import vektorflow.ui.launch as _vf_launch

_vf_launch._suppress_ui_auto_launch = True
