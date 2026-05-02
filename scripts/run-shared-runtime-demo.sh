#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$script_dir/.." && pwd)

demo="$root/web/vf-ui/vf-shared-rect-demo.html"
if [ ! -f "$demo" ]; then
  demo="$root/vf-ui/vf-shared-rect-demo.html"
fi
if [ ! -f "$demo" ]; then
  echo "Cannot find vf-shared-rect-demo.html under source web/vf-ui or bundled vf-ui." >&2
  exit 1
fi

browser=${BROWSER:-}
if [ -z "$browser" ]; then
  for candidate in microsoft-edge msedge google-chrome chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      browser=$candidate
      break
    fi
  done
fi
if [ -z "$browser" ]; then
  echo "No Chromium-family browser found. Set BROWSER=/path/to/chrome." >&2
  exit 1
fi

case "$demo" in
  /*) url="file://$demo" ;;
  *) url="file://$(pwd)/$demo" ;;
esac

user_data_dir="${TMPDIR:-/tmp}/vektor-flow-shared-runtime-demo"
if [ "${PRINT_ONLY:-0}" = "1" ]; then
  echo "$browser"
  echo "--new-window --enable-features=SharedArrayBuffer --allow-file-access-from-files --user-data-dir=$user_data_dir $url"
  exit 0
fi

"$browser" \
  --new-window \
  --enable-features=SharedArrayBuffer \
  --allow-file-access-from-files \
  "--user-data-dir=$user_data_dir" \
  "$url" &

echo "Launched Python-free shared-runtime demo:"
echo "  $url"
