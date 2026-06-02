# Chess 3D Assets

Downloaded on 2026-06-02 from OpenGameArt:

- Source: https://opengameart.org/content/stylized-chess-pieces
- Author: Lyricsz
- License: CC0
- Downloaded archive: `downloads/lyricsz_stylized_chess_source.zip`

The extracted runtime assets live in `models/gltf` as binary GLB files. The VKF
loader at `chess_asset_loader.vkf` reads `manifest.csv` with native
`io.read_text` and reads GLB model data with native `io.read_bytes`, giving the
chess UI path a concrete Python-free runtime asset I/O contract before the
renderer grows a full GLB parser/importer.
