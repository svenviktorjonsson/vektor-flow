# Vektor Flow — `vf-ui` (host shell)

Browser-side **floating frame** chrome: **`vf-frame.js`** / **`vf-frame.css`** (`VfFrame.mount`, drag header, minimize, resize, close, **`expandToFitContent`**).

## Run the GUI (Windows)

**Shell:** **`vf-overlay.exe`** under **`native/VfOverlay/build/...`** — WebView2 + **DirectComposition** (typical WebView2 overlay). Build: **`.\scripts\build-vf-overlay.ps1`**, then **`.\scripts\run-vf-ui.ps1`**. See **`native/VfOverlay/README.md`**.

The native VKF launcher can auto-start **`vf-overlay.exe`** when it is built.

Serves from **`http://127.0.0.1:<port>/`** → **`index.html`** (redirects to scene / demos as configured).

## Browser (quick file edit loop)

```bash
npx --yes http-server web/vf-ui -p 8877
```

- **`example-gui.html`** — form demo (**expandToFitContent**, **Log form**).
- **`demo.html`** — minimal panel.
