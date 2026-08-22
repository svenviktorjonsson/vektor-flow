#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: package-native-release.sh VERSION [BINARY_DIRECTORY] [OUTPUT_DIRECTORY]" >&2
  exit 2
fi

version=$1
binary_directory=${2:-build/native-compiler/bin}
output_directory=${3:-dist/releases}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

case "/$binary_directory/" in *"/../"*|*"/./"*|//* ) echo "binary directory must be a normalized relative path" >&2; exit 2;; esac
case "/$output_directory/" in *"/../"*|*"/./"*|//* ) echo "output directory must be a normalized relative path" >&2; exit 2;; esac
binary_candidate="$repo_root/$binary_directory"
output_candidate="$repo_root/$output_directory"
test -d "$binary_candidate" || { echo "binary directory does not exist" >&2; exit 2; }
mkdir -p "$output_candidate"
binary_root=$(CDPATH= cd -- "$binary_candidate" && pwd -P)
output_root=$(CDPATH= cd -- "$output_candidate" && pwd -P)
case "$binary_root" in "$repo_root"/*) ;; *) echo "binary directory must stay inside repository" >&2; exit 2;; esac
case "$output_root" in "$repo_root"/*) ;; *) echo "output directory must stay inside repository" >&2; exit 2;; esac
stage_root="$output_root/vektor-flow-linux-x64"
archive_path="$output_root/vektor-flow-linux-x64.tar.gz"
package_path="$output_root/vektor-flow-linux-x64.deb"
payload_root="$output_root/.linux-deb"

rm -rf "$stage_root" "$payload_root"
rm -f "$archive_path" "$archive_path.sha256" "$package_path" "$package_path.sha256"
mkdir -p "$stage_root/bin" "$stage_root/compiler/self_hosted/stdlib" "$stage_root/samples"

test -x "$binary_root/vkf-strict" || { echo "missing release compiler: $binary_root/vkf-strict" >&2; exit 1; }
cp "$binary_root/vkf-strict" "$stage_root/bin/vkf"

for module in math stat random time io collections errors system process regex; do
  cp "$repo_root/compiler/self_hosted/stdlib/$module.vkf" "$stage_root/compiler/self_hosted/stdlib/"
done
cp "$repo_root/examples/01_hello.vkf" "$stage_root/samples/"
cp "$repo_root/examples/64_axis_tags_and_broadcast.vkf" "$stage_root/samples/"
cp "$repo_root/README.md" "$repo_root/INSTALL.md" "$repo_root/TESTING.md" "$stage_root/"
cp "$repo_root/packaging/linux/install.sh" "$stage_root/install.sh"
chmod +x "$stage_root/install.sh" "$stage_root/bin/"*

cat > "$stage_root/vektorflow-release.json" <<EOF
{
  "schema": 1,
  "name": "Vektor Flow",
  "version": "$version",
  "platform": "linux-x64",
  "entrypoint": "bin/vkf",
  "test_command": "vkf -t",
  "stdlib_modules": ["math", "stat", "random", "time", "io", "collections", "errors", "system", "process", "regex"],
  "not_included_partial_modules": ["physics", "ui", "symbolic"],
  "strict_direct": true,
  "compatibility_fallback": false,
  "runtime_contract": {
    "python_required": false,
    "cpp_compiler_required": false,
    "cpp_runtime_install_required": false,
    "assembler_required": false
  }
}
EOF

if find "$stage_root" -type f \( -name '*.c' -o -name '*.cc' -o -name '*.cpp' -o -name '*.cxx' -o -name '*.py' -o -name '*.pyc' -o -name '*.pyd' \) | grep -q .; then
  echo "strict native bundle contains compatibility/build sources" >&2
  exit 1
fi

smoke_root="$output_root/.installer-smoke"
rm -rf "$smoke_root"
mkdir -p "$smoke_root"
cat > "$smoke_root/installed_math.vkf" <<'EOF'
m: .math
:: m.tanh(0)
EOF
(
  cd "$smoke_root"
  printf '%s\n' ':: 1' > overwrite_guard.vkf
  printf '%s\n' 'user-owned-data' > do-not-overwrite
  if "$stage_root/bin/vkf" -b overwrite_guard.vkf -o do-not-overwrite > guard.txt 2>&1; then
    echo "packaged compiler overwrote a user-owned output file" >&2
    exit 1
  fi
  test "$(cat do-not-overwrite)" = "user-owned-data"
  grep -q 'refusing to overwrite existing non-VKF file' guard.txt
  printf '%s\n' 'user-owned VKF-CACHE-V1:not-an-artifact' > marker-decoy
  if "$stage_root/bin/vkf" -b overwrite_guard.vkf -o marker-decoy > decoy-guard.txt 2>&1; then
    echo "packaged compiler trusted a forged cache marker" >&2
    exit 1
  fi
  test "$(cat marker-decoy)" = "user-owned VKF-CACHE-V1:not-an-artifact"
  grep -q 'refusing to overwrite existing non-VKF file' decoy-guard.txt
  printf '%s\n' 'user-owned-target' > symlink-target
  ln -s symlink-target symlink-output
  if "$stage_root/bin/vkf" -b overwrite_guard.vkf -o symlink-output > symlink-guard.txt 2>&1; then
    echo "packaged compiler followed a symbolic-link output" >&2
    exit 1
  fi
  test "$(cat symlink-target)" = "user-owned-target"
  grep -q 'refusing to overwrite symbolic-link output' symlink-guard.txt
  mkdir linked-workspace-target
  ln -s linked-workspace-target .vkfbuild
  if "$stage_root/bin/vkf" -b overwrite_guard.vkf -o safe-new-output > workspace-guard.txt 2>&1; then
    echo "packaged compiler followed a symbolic-link build workspace" >&2
    exit 1
  fi
  test -z "$(ls -A linked-workspace-target)"
  grep -q 'refusing symbolic-link build workspace' workspace-guard.txt
  rm .vkfbuild
  "$stage_root/bin/vkf" -b "$smoke_root/installed_math.vkf" > build.txt
  grep -q '^Built ' build.txt
  test -x "$smoke_root/installed_math"
  test "$("$smoke_root/installed_math")" = "0"
  test ! -e "$smoke_root/.vkfbuild"
  cat > installed_io.vkf <<'EOF'
io: .io
io.write_text("native-io.txt", "native UTF-8: hej")
io.append_text("native-io.txt", " + appended")
io.write_bytes("native-io.bin", "byte exact")
io.eprint("native stderr")
:: io.read_text("native-io.txt")
:: io.read_bytes("native-io.bin")
EOF
  "$stage_root/bin/vkf" installed_io.vkf > io.txt 2> io.err
  test "$(cat io.txt)" = "native UTF-8: hej + appended
byte exact"
  test "$(cat io.err)" = "native stderr"
  cat > installed_read_line.vkf <<'EOF'
io: .io
:: io.read_line()
EOF
  long_line=$(printf '%600s' '' | tr ' ' x)
  printf '%s\r\n' "$long_line" | "$stage_root/bin/vkf" installed_read_line.vkf > read-line.txt
  test "$(cat read-line.txt)" = "$long_line"
  cat > installed_collections_errors.vkf <<'EOF'
c: .collections
errors: .errors
q: c.queue()
q.put(10)
q.put(20)
first: q.get()
second: q.get()
point: c.map(name:"origin", x:1, y:2)
caught: 0
(false?! "native error")!?
    errors.AssertionError => caught: 1
:: first + second + point.x + point.y + caught
EOF
  test "$("$stage_root/bin/vkf" installed_collections_errors.vkf)" = "34"
  "$stage_root/bin/vkf" -t "$repo_root/tests/release_stdlibs.vkf" > stdlibs.txt
  grep -q '^4 passed, 0 failed$' stdlibs.txt
  cat > installed_system.vkf <<'EOF'
system: .system
present: system.env("PATH")
missing: system.env("VKF_MISSING_RELEASE_TEST_0_1_0")
:: system.os()
:: system.arch()
:: system.cpu_count() > 0
:: present.found
:: missing.found
EOF
  test "$("$stage_root/bin/vkf" installed_system.vkf)" = "linux
x86_64
true
true
false"
  cat > installed_process.vkf <<'EOF'
process: .process
result: process.run("/bin/sh", ["-c", "printf hello; printf error >&2; exit 7"])
shell_result: process.shell("exit 0")
:: result.code
:: result.out
:: result.err
:: shell_result.code
EOF
  test "$("$stage_root/bin/vkf" installed_process.vkf)" = "7
hello
error
0"
  cat > installed_regex.vkf <<'EOF'
regex: .regex
result: regex.match("values are 123 and 45", 'values are (?P<a>.*) and (?P<b>\d+)')
:: result.a
:: result.b
EOF
  test "$("$stage_root/bin/vkf" installed_regex.vkf)" = "123
45"
  test "$("$stage_root/bin/vkf" "$smoke_root/installed_math.vkf" -o app)" = "0"
  test -x "$smoke_root/app"
  cat > installed_test.vkf <<'EOF'
test installed_test() -> bit:
    :: "test output"
    @: 2 + 2 = 4
EOF
  "$stage_root/bin/vkf" -t installed_test.vkf > test.txt
  grep -q 'PASS .*installed_test' test.txt
  archive_install_root="$smoke_root/archive-install"
  archive_bin_root="$smoke_root/archive-bin"
  VKF_INSTALL_ROOT="$archive_install_root" VKF_BIN_ROOT="$archive_bin_root" \
    "$stage_root/install.sh" > archive-install.txt
  test -x "$archive_install_root/bin/vkf"
  test -L "$archive_bin_root/vkf"
  test -f "$archive_install_root/.vektor-flow-install"
  collision_root="$smoke_root/collision-install"
  collision_bin="$smoke_root/collision-bin"
  mkdir -p "$collision_root" "$collision_bin"
  printf '%s\n' 'user-owned-command' > "$collision_bin/vkf"
  if VKF_INSTALL_ROOT="$collision_root" VKF_BIN_ROOT="$collision_bin" \
     "$stage_root/install.sh" > collision-install.txt 2>&1; then
    echo "archive installer replaced an existing command" >&2
    exit 1
  fi
  test "$(cat "$collision_bin/vkf")" = "user-owned-command"
  grep -q 'refusing to replace existing command' collision-install.txt
  if VKF_INSTALL_ROOT=/ VKF_BIN_ROOT="$collision_bin" \
     "$stage_root/install.sh" > unsafe-install.txt 2>&1; then
    echo "archive installer accepted the filesystem root" >&2
    exit 1
  fi
  grep -q 'refusing unsafe install root' unsafe-install.txt
  if "$stage_root/bin/vkf" -e 'physics: .physics; :: physics.rigid_material("x", 1, 1, 1, 1, 1, 1)' > unsupported.txt 2>&1; then
    echo "strict release accepted an excluded stdlib module" >&2
    exit 1
  fi
  grep -q 'not included in the strict native release' unsupported.txt
)
rm -rf "$smoke_root"

tar -C "$stage_root" -czf "$archive_path" .
(cd "$output_root" && sha256sum "$(basename "$archive_path")" > "$(basename "$archive_path").sha256")

mkdir -p "$payload_root/DEBIAN" "$payload_root/usr/lib/vektor-flow" "$payload_root/usr/bin"
cp -R "$stage_root/bin" "$payload_root/usr/lib/vektor-flow/"
cp -R "$stage_root/compiler" "$payload_root/usr/lib/vektor-flow/"
cp -R "$stage_root/samples" "$payload_root/usr/lib/vektor-flow/"
cp "$stage_root/vektorflow-release.json" "$payload_root/usr/lib/vektor-flow/"
ln -s ../lib/vektor-flow/bin/vkf "$payload_root/usr/bin/vkf"
cat > "$payload_root/DEBIAN/control" <<EOF
Package: vektor-flow
Version: $version
Section: devel
Priority: optional
Architecture: amd64
Maintainer: Vektor Flow
Description: Strict native Vektor Flow compiler
 Python-free compiler and direct native runtime for the supported VKF subset.
EOF
dpkg-deb --build --root-owner-group "$payload_root" "$package_path" >/dev/null
(cd "$output_root" && sha256sum "$(basename "$package_path")" > "$(basename "$package_path").sha256")
rm -rf "$payload_root"

printf '%s\n%s\n%s\n' "$stage_root" "$archive_path" "$package_path"
