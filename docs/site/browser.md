# Embed VKF in a static webpage

The source build can package the browser compiler as
`vektor-flow-browser-wasm.zip`. The release workflow now includes that bundle;
check the assets of the actual published release before expecting a download.
It is not an established `vkf --wasm` CLI export flag.

## Build the bundle

After building the browser compiler as described in the [setup guide](../../INSTALL.md),
install the repository JavaScript dependencies and package it:

```bash
npm ci
node tools/package-browser-compiler.mjs --output=dist/browser-vkf
```

The output contains `vkf-browser-compiler.mjs` and an `artifacts/` directory.
Keep them together beside the webpage that imports the compiler module.
[Packaging source](../../tools/package-browser-compiler.mjs).

## Connect it to your page

This minimal host compiles and runs supported VKF entirely client-side.
The HTML and CSS remain yours to design. Add your own stylesheet as usual.

```html
<textarea id="vkf-source">double(value:int) -> int: value * 2
:: double([1, 2, 3])</textarea>
<button id="run-vkf">Run VKF</button>
<pre id="vkf-output"></pre>

<script type="module">
  import { loadPackagedBrowserCompiler } from "./vkf-browser-compiler.mjs";

  const compiler = await loadPackagedBrowserCompiler();
  document.querySelector("#run-vkf").addEventListener("click", () => {
    const source = document.querySelector("#vkf-source").value;
    const output = document.querySelector("#vkf-output");
    try {
      const result = compiler.run(source);
      output.textContent = result.kind === "console"
        ? result.values.map(value => JSON.stringify(value)).join("\n")
        : JSON.stringify(result);
    } catch (error) {
      output.textContent = error.message;
    }
  });
</script>
```

The JavaScript host may update its own page, but VKF user code receives no
network, server, filesystem, process, DOM, localhost, or host API access.
Unsupported source fails clearly. The WASM module has no host imports.

This small example runs synchronously. For an editor accepting arbitrary user
input, use a disposable Web Worker with a timeout, as the
[site runner](../../web/inline-runner.mjs) does, so a long calculation cannot
block the interface. Visual results are structured packets; this snippet
prints them rather than pretending to be a complete graphics host.

## Serve the files

Use a static HTTP server locally and HTTPS when publishing. Preserve module
and artifact paths; serve `.wasm` as `application/wasm` and `.mjs` as JavaScript.
There is no VKF compilation backend. Opening a `file://` URL is not the supported
hosting path.

[Downloads and CLI](../../INSTALL.md) · [Back to the guide](guide.md).
