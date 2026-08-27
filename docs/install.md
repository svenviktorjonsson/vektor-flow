# Install Vektor Flow

## Windows

Download `vektor-flow-windows-x64-setup.exe` from GitHub Releases. The per-user
installer offers an **Add VKF to my PATH** checkbox and needs no administrator
access. Open a new terminal after installation:

```powershell
vkf -e ':: "hello, world"'
```

The installed compiler/runtime has no Python, C++ compiler, or assembler
dependency.

The installer is strict-native. It ships direct core plus `math`, `stat`,
`random`, `time`, `io`, `collections`, `errors`, `system`, `process`, and
`regex`. The partial `physics`, `ui`, and `symbolic` modules are absent;
unsupported imports hard-fail instead of activating a compatibility path.

Current development packages add native `physics`, `physics.units` (SI), and
`symbolic`; only `ui` remains excluded there. This does not change the contents
of an already-published 0.2.1 download.

1. Download and extract the Windows package
2. Open PowerShell in the extracted folder
3. Run:

```powershell
.\bin\vkf.exe -e ':: "hello, world"'
```

You should see:

```text
hello, world
```

Then try:

```powershell
.\bin\vkf.exe .\samples\01_hello.vkf
.\bin\vkf.exe -b .\samples\01_hello.vkf -o hello.exe
```

For the supported native subset, `vkf.exe <file.vkf>` uses the native
Python-free default path. If the native frontend classifies a file as supported
and native execution fails, that is a hard error rather than a Python retry.
Programs requiring `physics`, `ui`, or `symbolic` remain outside this release
until those modules are complete.

Packages built for the supported subset expose a Python-free manifest contract:
`runtime_contract.python_required_to_build=false`,
`runtime_contract.python_required_to_run=false`, and
`runtime_contract.default_entrypoint=vkf.exe`. Release bundles now ship that
entrypoint as a real native executable together with sibling native pipeline
tools, and browser-mode bundles can also ship a native `vf-browser-server`
helper so `vf-ui` serving does not need a Python helper process. Legacy native-core package
metadata is separate and may still describe bootstrap-time Python tooling.

### Build the compiler from source

The Windows compiler build uses Clang/C++17. It does not invoke Python. Clang
is selected because the current multi-process compiler meets its latency budget
with these low-startup binaries:

```powershell
.\scripts\build-native-compiler.ps1
.\build\native-compiler-clang\bin\vkf.exe -e ':: "hello"'
.\build\native-compiler-clang\bin\vkf-strict.exe .\samples\numeric.vkf
```

`compiler/native/CMakeLists.txt` remains the portable build Interface.
The strict target produces a real executable directly. Unsupported language or
stdlib surfaces fail; no C++/Clang compatibility fallback is shipped.

## macOS / Linux

Debian/Ubuntu users can install `vektor-flow-linux-x64.deb`; other Linux users
can extract `vektor-flow-linux-x64.tar.gz` and run `./install.sh`. macOS Apple
Silicon users can run
`vektor-flow-macos-arm64.pkg`, or use its archive and `install.sh`. Archive
installers use `~/.local/opt/vektor-flow` and link `vkf` into `~/.local/bin`.

1. Download and extract the package for your OS
2. Open a shell in the extracted folder
3. Run:

```bash
./bin/vkf -e ':: "hello, world"'
```

Then try:

```bash
./bin/vkf ./samples/01_hello.vkf
./bin/vkf -b ./samples/01_hello.vkf -o hello
```

For the supported native subset, `vkf <file.vkf>` uses the native Python-free
path. Unsupported UI/scene programs hard-fail in this release.

Package manifests carry the same Python-free contract. `physics`, `ui`, and
`symbolic` remain excluded until their native lowering is complete.

For next-release development packages, the manifest instead lists `physics`,
`physics.units`, `physics.units.si`, and `symbolic` as included and lists only
`ui` as partial.

## Need more detail?

- [Testing](./testing)
- [INSTALL.md on GitHub](https://github.com/svenviktorjonsson/vektor-flow/blob/main/INSTALL.md)
