# How to build with VKF

[Guide](guide.md) / How

Start in the browser, make the result visible, then choose how to share it or
work locally. No compiler installation or compilation backend is needed for
the runnable examples here. The browser supports a subset of VKF.

## Run and change a program

Press **Run**, change `* 2` to `* 3`, then run again. The same function is applied
through both the flat and nested vectors.

<!-- live-example: examples/introduction/vector-functions.vkf -->

`value:int` declares the parameter type, `-> int` the result type, and `:` the
function body. `::` prints the result.

[Bindings and values](../language-guide.md#1-programs-and-bindings) →
[functions](../language-guide.md#3-functions-and-calls) →
[vectors and axes](../language-guide.md#8-shapes-axes-and-indexing).

## Make it visible

Run this program, then edit a coordinate in `x` or `y` and run it again.
The frame displays the structured data you supply.

<!-- live-example: examples/introduction/geometry.vkf -->

[The graphics model](concepts.md#graphics-and-interfaces) →
[rendering architecture](../adr/0001-ui-runtime-shared-memory-gpu.md).

## Build an interface

Use HTML and CSS for layout and styling, with VKF supplying calculations and
behaviour. For a static webpage, the
[browser embedding walkthrough](browser.md) covers the bundle and host glue.

The compiled HTML/CSS application runtime is currently a Windows native
capability; it is not the same as embedding the browser subset. Inspect the
[VKF program](../../examples/ui_plot_card/app.vkf),
[HTML](../../examples/ui_plot_card/ui/main.html) and
[CSS](../../examples/ui_plot_card/ui/theme.css) together.

## Run locally or share through a browser

[Download](../../INSTALL.md#download-the-native-compiler) →
[first local program](../../INSTALL.md#your-first-local-program) →
[CLI commands](../../INSTALL.md#cli-walkthrough).

[Build the browser runtime](../../INSTALL.md#compile-the-browser-runtime-from-source) →
[embed it](browser.md) →
[static hosting](../../INSTALL.md#host-it-without-an-application-backend).

The browser build recipe is not a general `vkf --wasm` export command. Its
supported path and limitations are documented in the linked walkthrough.

[What: core ideas and performance →](concepts.md) · [Back to guide](guide.md)
