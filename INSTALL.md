# Download, run and share

## Start in the browser

[Open the runnable guide](docs/site/guide.md). The site downloads its WebAssembly
compiler runtime automatically; you do not install a compiler yourself. Supported
programs compile and run on your device, without a compilation backend.

This is an experimental subset of VKF, not complete native/browser parity.
Unsupported programs report an error; there is no server-side execution fallback.

## Download the native compiler

**Published preview: VKF 0.4.0.** The 0.4.1 work on the main branch remains a
release candidate until it is tagged and its downloads are published.

| Platform | Installer | Portable archive |
| --- | --- | --- |
| Windows x64 | [Setup](https://github.com/svenviktorjonsson/vektor-flow/releases/download/v0.4.0/vektor-flow-windows-x64-setup.exe) | [ZIP](https://github.com/svenviktorjonsson/vektor-flow/releases/download/v0.4.0/vektor-flow-windows-x64.zip) |
| Linux x64 | [Debian/Ubuntu package](https://github.com/svenviktorjonsson/vektor-flow/releases/download/v0.4.0/vektor-flow-linux-x64.deb) | [tar.gz](https://github.com/svenviktorjonsson/vektor-flow/releases/download/v0.4.0/vektor-flow-linux-x64.tar.gz) |
| macOS Apple Silicon | [Package](https://github.com/svenviktorjonsson/vektor-flow/releases/download/v0.4.0/vektor-flow-macos-arm64.pkg) | [tar.gz](https://github.com/svenviktorjonsson/vektor-flow/releases/download/v0.4.0/vektor-flow-macos-arm64.tar.gz) |

[Release files and SHA-256 checksums](https://github.com/svenviktorjonsson/vektor-flow/releases/tag/v0.4.0).
VKF is unsupported experimental software: expect incomplete diagnostics and
changing APIs. Do not use it for production or run untrusted native VKF programs.

Run the Windows or macOS installer, then open a new terminal. On Debian/Ubuntu:

```bash
sudo apt install ./vektor-flow-linux-x64.deb
```

For a Linux or macOS portable archive, extract it and run `./install.sh` as your
normal user, **not with sudo**. Make sure its command directory is on `PATH`.
The installed compilation path does not require Python, a C++ compiler, an
assembler or a separate linker. Building VKF itself from source is different.

## Your first local program

Check the installed version and evaluate an expression:

```bash
vkf -v
vkf -e ':: "hello, world"'
```

Save this as `hello.vkf`:

```vkf
:: "hello, world"
```

Then build and run it:

```bash
vkf hello.vkf
```

## CLI walkthrough

| Command | What it does |
| --- | --- |
| `vkf program.vkf` | Build when changed, then run. |
| `vkf program.vkf -o app` | Build or reuse the named executable, then run. |
| `vkf -b program.vkf` | Build without running. |
| `vkf -b program.vkf -o app` | Build only, with an explicit output name. |
| `vkf -e ':: 2 + 2'` | Evaluate inline source. |
| `vkf -t tests.vkf` | Run the native tests in a file. |
| `vkf -t tests` | Run the native tests in a directory. |
| `vkf -v` | Print the compiler version. |

`-b` means build, `-e` evaluate, `-t` test, `-v` version and `-o` output.
Passing a source file is the run command; there is no `-r`.
Source, imports, target, compiler and output choice contribute to the build
fingerprint, so unchanged programs can reuse their executable.

The native compiler emits platform executables: PE on Windows, ELF on Linux and
Mach-O on macOS. A build command is not a promise of cross-compilation to every
other platform. [Testing guide](TESTING.md) and [VS Code integration](vscode/README.md).

## Compile the browser runtime from source

This is the contributor path used by the Pages build, **not a public
`vkf --wasm` export command**. A general CLI flag for standalone WASM export has
not been established by this walkthrough; no new flag is invented here.

In a source checkout, with the Windows native-build prerequisites available:

```powershell
./scripts/build-native-compiler.ps1 `
  -OutputDirectory build/pages-compiler/bin `
  -OnlyTargets vkf-strict,vkf_symbolic_kernel_artifact
$env:VKF_NATIVE_BIN = (Resolve-Path build/pages-compiler/bin)
npm run build:browser-compiler
node --test tests/bootstrap/browser-compiler-wasm.test.mjs
node tools/build-pages-readme.mjs --output=web/generated
```

The build must pass before publishing. The
[Pages workflow](.github/workflows/pages.yml) is the complete build recipe;
[the browser architecture](docs/adr/0004-browser-symbolic-kernel.md) explains the
VKF-to-WASM runtime path.

## Host it without an application backend

Serve the generated `web/` directory on a static HTTPS host, preserving its
subdirectories. Serve `.wasm` as `application/wasm` and `.mjs` as JavaScript.
No VKF compilation service is needed: the browser loads the shipped runtime
and executes supported source locally.

For local testing, use an HTTP static-file server rather than opening
`index.html` as a `file://` URL. The Web Worker and module paths must remain
same-origin and accessible. The existing GitHub Pages workflow publishes this
same directory to vektorflow.org.

Native HTML/CSS applications and the browser examples have different capability
boundaries. Native code runs with your user permissions; browser execution
intentionally excludes filesystem, process and network access from user programs.

[Return to the guide](docs/site/guide.md).
