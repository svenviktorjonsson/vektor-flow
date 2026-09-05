#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Run with emscripten/emsdk:4.0.14; all output remains inside the repository.
node tools/build-packaged-stdlib.mjs
make --file=scripts/shared-compiler.mk --jobs=2
