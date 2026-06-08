# vf-overlay — fullscreen transparent WebView2 shell

Native **Windows** executable: **DirectComposition** + **`ICoreWebView2CompositionController`**, transparent **`DefaultBackgroundColor`**, **`WS_POPUP`** fullscreen host, loopback HTTP serving static files from **`web/`** next to the exe.

**Build** (requires **CMake**, **Visual Studio** or **Build Tools** with **Desktop development with C++**, and **WebView2 Runtime** on the machine):

From repo root (recommended — picks the **CMake generator** that matches your VS year, e.g. `Visual Studio 16 2019` for VS 2019 Build Tools):

```powershell
.\scripts\build-vf-overlay.ps1
```

If you only have **VS 2019 Build Tools**, the generator must be **`Visual Studio 16 2019`**, not **`Visual Studio 17 2022`**, and **`CMAKE_GENERATOR_INSTANCE`** must point at that same install.

Manual configure:

```powershell
cd native\VfOverlay
# VS 2022 example:
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 "-DCMAKE_GENERATOR_INSTANCE=C:\Program Files\Microsoft Visual Studio\2022\Community"
# VS 2019 Build Tools example:
# cmake -S . -B build -G "Visual Studio 16 2019" -A x64 "-DCMAKE_GENERATOR_INSTANCE=C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools"
cmake --build build --config Release
```

Output: **`build\Release\vf-overlay.exe`** (or **`build\vf-overlay.exe`** with Ninja) with **`web/`** copied from the repo’s **`web/vf-ui`**.

Shared host output: **`build\Release\VfOverlay.dll`** plus **`VfOverlay.lib`**. Consumers that need the same native overlay host, such as Tesseracs Desktop, should link/load the DLL and call:

```cpp
VfOverlayRunDll(instance, pageArg, webRoot, show);
```

The DLL owns the native fullscreen transparent host, DirectComposition/WebView2 setup, and overlay hit-test behavior. Product apps should provide content/runtime integration above this seam instead of duplicating native overlay code.

Run from repo root: **`.\scripts\run-vf-ui.ps1`** (after a successful build).
