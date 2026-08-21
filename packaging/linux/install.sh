#!/usr/bin/env sh
set -eu

bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_root=${VKF_INSTALL_ROOT:-"$HOME/.local/opt/vektor-flow"}
bin_root=${VKF_BIN_ROOT:-"$HOME/.local/bin"}

mkdir -p "$install_root" "$bin_root"
cp -R "$bundle_dir/bin" "$install_root/"
cp -R "$bundle_dir/compiler" "$install_root/"
cp -R "$bundle_dir/samples" "$install_root/"
cp "$bundle_dir/vektorflow-release.json" "$install_root/"
ln -sfn "$install_root/bin/vkf" "$bin_root/vkf"

case ":${PATH:-}:" in
  *":$bin_root:"*) ;;
  *)
    printf '%s\n' "Installed commands in $bin_root."
    printf '%s\n' "Add this line to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

printf '%s\n' "Vektor Flow installed in $install_root"
printf '%s\n' "Run: vkf -e ':: 2 + 2'"
