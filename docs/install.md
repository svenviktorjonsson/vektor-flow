# Install Vektor Flow

## Windows

1. Download and extract the Windows package
2. Open PowerShell in the extracted folder
3. Run:

```powershell
.\vkf.exe -e ':: "hello, world"'
```

You should see:

```text
hello, world
```

Then try:

```powershell
.\vkf.exe .\samples\01_hello.vkf
.\vkf.exe .\samples\100_axis_4_panel.vkf
```

For the supported native subset, `vkf.exe <file.vkf>` uses the native
Python-free default path. If the native frontend classifies a file as supported
and native execution fails, that is a hard error rather than a Python retry.
Unsupported UI/scene programs remain outside this guarantee until their native
lowering is complete.

Packages built for the supported subset expose a Python-free manifest contract:
`runtime_contract.python_required_to_build=false`,
`runtime_contract.python_required_to_run=false`, and
`runtime_contract.default_entrypoint=vkf.exe`. Release bundles now ship that
entrypoint as a real native executable together with sibling native pipeline
tools, and browser-mode bundles can also ship a native `vf-browser-server`
helper so `vf-ui` serving does not need a Python helper process. Legacy native-core package
metadata is separate and may still describe bootstrap-time Python tooling.

## macOS / Linux

1. Download and extract the package for your OS
2. Open a shell in the extracted folder
3. Run:

```bash
./vkf -e ':: "hello, world"'
```

Then try:

```bash
./vkf ./samples/01_hello.vkf
./vkf ./samples/100_axis_4_panel.vkf
```

For the supported native subset, `vkf <file.vkf>` uses the native Python-free
default path. Unsupported UI/scene programs are not covered by that guarantee
yet and may require legacy or development tooling.

Supported-subset package manifests carry the same Python-free contract. UI and
scene packages remain excluded from that guarantee until their native lowering
is complete.

## Need more detail?

- [Testing](./testing)
- [INSTALL.md on GitHub](https://github.com/svenviktorjonsson/vektor-flow/blob/main/INSTALL.md)
