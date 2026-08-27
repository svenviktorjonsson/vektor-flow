import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSymbolicKernel } from "../web/vf-ui/vf-symbolic-kernel-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(root, process.env.VKF_NATIVE_BIN)
  : join(root, "build", "native-compiler-clang", "bin");
const compiler = join(
  nativeBin,
  `vkf-strict${executableSuffix}`,
);
const wasmCompiler = join(
  nativeBin,
  `vkf_symbolic_kernel_artifact${executableSuffix}`,
);
const allCases = [
  {
    name: "linalg",
    source: join(root, "tests", "wasm", "linalg_conformance.vkf"),
    entry: "linalg_wasm_conformance",
    expected: 451,
  },
  {
    name: "physics",
    source: join(root, "tests", "wasm", "physics_conformance.vkf"),
    entry: "physics_wasm_conformance",
    expected: 58.5,
  },
  {
    name: "physics-linalg",
    source: join(root, "tests", "wasm", "physics_linalg_conformance.vkf"),
    entry: "physics_linalg_wasm_conformance",
    expected: 33,
  },
  {
    name: "symbolic",
    source: join(root, "tests", "wasm", "symbolic_conformance.vkf"),
    entry: "symbolic_wasm_conformance",
    expected: 12421.5,
  },
  {
    name: "symbolic-adjacency",
    source: join(root, "tests", "wasm", "symbolic_adjacency_conformance.vkf"),
    entry: "symbolic_adjacency_wasm_conformance",
    expected: 3,
  },
  {
    name: "symbolic-proposition",
    source: join(root, "tests", "wasm", "symbolic_proposition_conformance.vkf"),
    entry: "symbolic_proposition_wasm_conformance",
    expected: 27,
  },
  {
    name: "symbolic-transform-laplace",
    source: join(root, "tests", "wasm", "symbolic_transform_conformance.vkf"),
    entry: "symbolic_laplace_wasm_conformance",
    expected: 1,
  },
  {
    name: "symbolic-transform-z",
    source: join(root, "tests", "wasm", "symbolic_z_transform_conformance.vkf"),
    entry: "symbolic_z_transform_wasm_conformance",
    expected: 1,
  },
  {
    name: "symbolic-transform-fourier",
    source: join(root, "tests", "wasm", "symbolic_fourier_conformance.vkf"),
    entry: "symbolic_fourier_wasm_conformance",
    expected: 1,
  },
  {
    name: "symbolic-transform-haar",
    source: join(root, "tests", "wasm", "symbolic_fourier_conformance.vkf"),
    entry: "symbolic_haar_wasm_conformance",
    expected: 1,
  },
  {
    name: "symbolic-pde",
    source: join(root, "tests", "wasm", "symbolic_pde_conformance.vkf"),
    entry: "symbolic_pde_wasm_conformance",
    expected: 1,
  },
];
const caseArgument = process.argv.indexOf("--case");
const selectedCase = caseArgument >= 0 ? process.argv[caseArgument + 1] : null;
if (caseArgument >= 0 && !selectedCase) {
  throw new Error("--case requires a conformance case name");
}
const cases = selectedCase
  ? allCases.filter((testCase) => testCase.name === selectedCase)
  : allCases;
if (selectedCase && cases.length === 0) {
  throw new Error(`unknown conformance case ${selectedCase}`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return result.stdout;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const work = mkdtempSync(join(tmpdir(), "vkf-stdlib-wasm-"));
const report = {
  schema: "vkf.stdlib-native-wasm-conformance",
  schemaVersion: 1,
  compiler: run(compiler, ["-v"]).trim(),
  runsPerTarget: 10,
  cases: [],
};

try {
  for (const testCase of cases) {
    const caseRoot = join(work, testCase.name);
    const source = testCase.source;
    const native = join(caseRoot, `native${executableSuffix}`);
    const wasm = join(caseRoot, `${testCase.name}.wasm`);
    const manifestPath = join(caseRoot, `${testCase.name}.json`);
    mkdirSync(caseRoot, { recursive: true });
    const diagnostics = JSON.parse(run(compiler, [
      "-b",
      source,
      "-o",
      native,
      "--diagnostics",
      "--optimizer-policy",
      "mask-0",
    ]));
    const nativeOutputs = Array.from({ length: report.runsPerTarget }, () =>
      Number(run(native, []).trim())
    );
    if (nativeOutputs.some((value) => value !== testCase.expected)) {
      throw new Error(`${testCase.name} native output mismatch`);
    }

    run(wasmCompiler, [
      "--typed-ir",
      diagnostics.typed_ir_path,
      "--wasm",
      wasm,
      "--manifest",
      manifestPath,
      "--entry",
      testCase.entry,
      "--prune-to-entry",
    ]);
    const wasmBytes = readFileSync(wasm);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const { instance } = await WebAssembly.instantiate(wasmBytes);
    const vm = createSymbolicKernel({ instance, manifest });
    const wasmOutputs = [];
    for (let runIndex = 0; runIndex < report.runsPerTarget; runIndex += 1) {
      try {
        wasmOutputs.push(vm.invokeValue(testCase.entry));
      } catch (error) {
        throw new Error(
          `${testCase.name} WASM invocation ${runIndex + 1} failed`,
          { cause: error },
        );
      }
    }
    if (wasmOutputs.some((value) => value !== testCase.expected)) {
      throw new Error(
        `${testCase.name} WASM output mismatch: expected ${testCase.expected}, `
        + `received ${JSON.stringify(wasmOutputs)}`,
      );
    }

    report.cases.push({
      name: testCase.name,
      entry: testCase.entry,
      expected: testCase.expected,
      sourceSha256: sha256(readFileSync(testCase.source)),
      wasmSha256: sha256(wasmBytes),
      nativeOutputs,
      wasmOutputs,
    });
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  const resolvedWork = resolve(work);
  const resolvedTemp = resolve(tmpdir());
  if (!resolvedWork.startsWith(`${resolvedTemp}\\`) &&
      !resolvedWork.startsWith(`${resolvedTemp}/`)) {
    throw new Error(`refusing to remove non-temporary path ${resolvedWork}`);
  }
  rmSync(resolvedWork, { recursive: true, force: true });
}
