#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: package-native-release-macos.sh VERSION [BINARY_DIRECTORY] [OUTPUT_DIRECTORY]" >&2
  exit 2
fi

version=$1
binary_directory=${2:-build/native-compiler/bin}
output_directory=${3:-dist/releases}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
binary_root="$repo_root/$binary_directory"
output_root="$repo_root/$output_directory"
stage_root="$output_root/vektor-flow-macos-arm64"
archive_path="$output_root/vektor-flow-macos-arm64.tar.gz"
package_path="$output_root/vektor-flow-macos-arm64.pkg"
payload_root="$output_root/.macos-payload"

case "$binary_root" in "$repo_root"/*) ;; *) echo "binary directory must stay inside repository" >&2; exit 2;; esac
case "$output_root" in "$repo_root"/*) ;; *) echo "output directory must stay inside repository" >&2; exit 2;; esac

rm -rf "$stage_root" "$payload_root"
rm -f "$archive_path" "$archive_path.sha256" "$package_path" "$package_path.sha256"
mkdir -p "$stage_root/bin" "$stage_root/compiler/self_hosted/stdlib" "$stage_root/samples"

test -x "$binary_root/vkf-strict" || { echo "missing release compiler: $binary_root/vkf-strict" >&2; exit 1; }
cp "$binary_root/vkf-strict" "$stage_root/bin/vkf"

for module in math stat random time io collections errors system process capture; do
  cp "$repo_root/compiler/self_hosted/stdlib/$module.vkf" "$stage_root/compiler/self_hosted/stdlib/"
done
cp "$repo_root/examples/01_hello.vkf" "$stage_root/samples/"
cp "$repo_root/examples/64_axis_tags_and_broadcast.vkf" "$stage_root/samples/"
cp "$repo_root/README.md" "$repo_root/INSTALL.md" "$repo_root/TESTING.md" "$stage_root/"
cp "$repo_root/packaging/macos/install.sh" "$stage_root/install.sh"
chmod +x "$stage_root/install.sh" "$stage_root/bin/vkf"

cat > "$stage_root/vektorflow-release.json" <<EOF
{
  "schema": 1,
  "name": "Vektor Flow",
  "version": "$version",
  "platform": "macos-arm64",
  "entrypoint": "bin/vkf",
  "test_command": "vkf -t",
  "stdlib_modules": ["math", "stat", "random", "time", "io", "collections", "errors", "system", "process", "capture"],
  "not_included_partial_modules": ["physics", "ui", "symbolic"],
  "strict_direct": true,
  "compatibility_fallback": false,
  "runtime_contract": {
    "python_required": false,
    "cpp_compiler_required": false,
    "cpp_runtime_install_required": false,
    "assembler_required": false,
    "rosetta_required": false
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
  "$stage_root/bin/vkf" -b installed_math.vkf > build.txt
  grep -q '^Built ' build.txt
  test -x installed_math
  test "$(./installed_math)" = "0"
  test ! -e .vkfbuild
  cat > installed_io.vkf <<'EOF'
io: .io
io.write_text("native-io.txt", "native UTF-8: hej")
io.append_text("native-io.txt", " + appended")
io.write_bytes("native-io.bin", "byte exact")
io.eprint("native stderr")
:: io.read_text("native-io.txt")
:: io.read_bytes("native-io.bin")
EOF
  set +e
  "$stage_root/bin/vkf" installed_io.vkf > io.txt 2> io.err
  io_status=$?
  set -e
  io_output=$(cat io.txt)
  io_error=$(cat io.err)
  if [ "$io_status" -ne 0 ] || [ "$io_output" != "native UTF-8: hej + appended
byte exact" ] || [ "$io_error" != "native stderr" ]; then
    echo "macOS IO smoke failed (status $io_status)" >&2
    echo "stdout:" >&2
    cat io.txt >&2
    echo "stderr:" >&2
    cat io.err >&2
    exit 1
  fi
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
  test "$("$stage_root/bin/vkf" installed_system.vkf)" = "macos
arm64
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
  set +e
  "$stage_root/bin/vkf" installed_process.vkf > process.txt 2> process.err
  process_status=$?
  set -e
  process_output=$(cat process.txt)
  if [ "$process_status" -ne 0 ] || [ "$process_output" != "7
hello
error
0" ]; then
    echo "macOS process smoke failed (status $process_status)" >&2
    echo "stdout:" >&2
    cat process.txt >&2
    echo "stderr:" >&2
    cat process.err >&2
    exit 1
  fi
  cat > installed_capture.vkf <<'EOF'
capture: .capture
result: capture.regex("values are 123 and 45", 'values are (?P<a>\d+) and (?P<b>\d+)')
:: result.a
:: result.b
EOF
  test "$("$stage_root/bin/vkf" installed_capture.vkf)" = "123
45"
  test "$("$stage_root/bin/vkf" installed_math.vkf -o app)" = "0"
  test -x app
  cat > installed_test.vkf <<'EOF'
test installed_test() -> bit:
    :: "test output"
    @: 2 + 2 = 4
EOF
  "$stage_root/bin/vkf" -t installed_test.vkf > test.txt
  grep -q 'PASS .*installed_test' test.txt
  if "$stage_root/bin/vkf" -e 'physics: .physics; :: physics.rigid_material("x", 1, 1, 1, 1, 1, 1)' > unsupported.txt 2>&1; then
    echo "strict release accepted an excluded stdlib module" >&2
    exit 1
  fi
  grep -q 'not included in the strict native release' unsupported.txt
)
rm -rf "$smoke_root"

tar -C "$stage_root" -czf "$archive_path" .
(cd "$output_root" && shasum -a 256 "$(basename "$archive_path")" > "$(basename "$archive_path").sha256")

mkdir -p "$payload_root/usr/local/lib/vektor-flow" "$payload_root/usr/local/bin"
cp -R "$stage_root/bin" "$payload_root/usr/local/lib/vektor-flow/"
cp -R "$stage_root/compiler" "$payload_root/usr/local/lib/vektor-flow/"
cp -R "$stage_root/samples" "$payload_root/usr/local/lib/vektor-flow/"
cp "$stage_root/vektorflow-release.json" "$payload_root/usr/local/lib/vektor-flow/"
ln -s ../lib/vektor-flow/bin/vkf "$payload_root/usr/local/bin/vkf"
pkgbuild \
  --root "$payload_root" \
  --identifier com.vektorflow.compiler \
  --version "$version" \
  --install-location / \
  "$package_path"
(cd "$output_root" && shasum -a 256 "$(basename "$package_path")" > "$(basename "$package_path").sha256")
rm -rf "$payload_root"

printf '%s\n%s\n%s\n' "$stage_root" "$archive_path" "$package_path"
