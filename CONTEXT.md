# Vektor Flow Context

## Domain Language

- **VKF source bundle**: A `.vkf` source file plus any generated runtime payloads
  needed to run it as a compiled executable.
- **Native scene staging**: The native step that turns VKF scene/UI source into
  overlay-ready web session files and a manifest.
- **Compiled scene executable**: A standalone `.exe` copied from the native VKF
  runner with the current scene bundle appended to it.
- **Axis mode deck**: The graphical API test deck in
  `examples/100_axis_4_panel.vkf`, covering 2D crosshair, 2D box, 2D polar,
  3D crosshair, and 3D box axis modes.

