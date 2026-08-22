#!/usr/bin/env sh
set -eu

bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_root=${VKF_INSTALL_ROOT:-"$HOME/.local/opt/vektor-flow"}
bin_root=${VKF_BIN_ROOT:-"$HOME/.local/bin"}

fail() {
  printf '%s\n' "Vektor Flow installer: $*" >&2
  exit 2
}

[ "$(id -u)" -ne 0 ] ||
  fail "do not run the archive installer as root; use the platform package"

require_safe_root() {
  root=$1
  label=$2
  case "$root" in
    ""|/|//|"$HOME"|"$HOME"/)
      fail "refusing unsafe $label: $root"
      ;;
  esac
}

require_safe_root "$install_root" "install root"
require_safe_root "$bin_root" "command directory"

if [ -e "$install_root" ] && [ ! -d "$install_root" ]; then
  fail "install root exists and is not a directory: $install_root"
fi
if [ -d "$install_root" ] && [ ! -f "$install_root/.vektor-flow-install" ] &&
   { [ ! -f "$install_root/vektorflow-release.json" ] ||
     [ ! -f "$install_root/bin/vkf" ]; } &&
   [ -n "$(ls -A "$install_root" 2>/dev/null)" ]; then
  fail "install root is not empty and is not owned by Vektor Flow: $install_root"
fi

mkdir -p "$install_root" "$bin_root"
install_root=$(CDPATH= cd -- "$install_root" && pwd -P)
bin_root=$(CDPATH= cd -- "$bin_root" && pwd -P)
require_safe_root "$install_root" "resolved install root"
require_safe_root "$bin_root" "resolved command directory"
case "$install_root" in "$HOME"/*) ;; *) fail "install root must stay inside the current user's home";; esac
case "$bin_root" in "$HOME"/*) ;; *) fail "command directory must stay inside the current user's home";; esac
[ "$install_root" != "$bin_root" ] || fail "install root and command directory must differ"

for managed in bin compiler samples; do
  if [ -L "$install_root/$managed" ]; then
    fail "managed install path is a symbolic link: $install_root/$managed"
  fi
  if [ -d "$install_root/$managed" ] &&
     find "$install_root/$managed" -type l -print -quit | grep -q .; then
    fail "managed install tree contains a symbolic link: $install_root/$managed"
  fi
done
[ ! -L "$install_root/vektorflow-release.json" ] ||
  fail "release manifest path is a symbolic link"

command_path="$bin_root/vkf"
if [ -e "$command_path" ] || [ -L "$command_path" ]; then
  if [ ! -L "$command_path" ]; then
    fail "refusing to replace existing command: $command_path"
  fi
  current_target=$(readlink "$command_path")
  [ "$current_target" = "$install_root/bin/vkf" ] ||
    fail "refusing to replace a vkf link owned by another installation: $command_path"
fi

cp -R "$bundle_dir/bin" "$install_root/"
cp -R "$bundle_dir/compiler" "$install_root/"
cp -R "$bundle_dir/samples" "$install_root/"
cp "$bundle_dir/vektorflow-release.json" "$install_root/"
printf '%s\n' "Vektor Flow managed installation" > "$install_root/.vektor-flow-install"
ln -sfn "$install_root/bin/vkf" "$command_path"

case ":${PATH:-}:" in
  *":$bin_root:"*) ;;
  *)
    printf '%s\n' "Installed command in $bin_root."
    printf '%s\n' "Add this line to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

printf '%s\n' "Vektor Flow installed in $install_root"
printf '%s\n' "Run: vkf -e ':: 2 + 2'"
