#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const allowedSystemImports = new Set([
  "advapi32.dll",
  "comctl32.dll",
  "crypt32.dll",
  "d3d11.dll",
  "dcomp.dll",
  "dbghelp.dll",
  "dxgi.dll",
  "gdi32.dll",
  "gdiplus.dll",
  "kernel32.dll",
  "msvcrt.dll",
  "ntdll.dll",
  "ole32.dll",
  "oleaut32.dll",
  "shell32.dll",
  "shlwapi.dll",
  "ucrtbase.dll",
  "user32.dll",
  "version.dll",
  "winmm.dll",
  "ws2_32.dll",
]);

function requireRange(bytes, offset, length, label) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > bytes.length) {
    throw new Error(`${label} points outside the PE file`);
  }
}

function readAsciiZ(bytes, offset, label) {
  requireRange(bytes, offset, 1, label);
  const end = bytes.indexOf(0, offset);
  if (end < 0 || end - offset > 4096) throw new Error(`${label} is not a bounded string`);
  return bytes.toString("ascii", offset, end);
}

function parsePeImports(binary) {
  const bytes = readFileSync(binary);
  requireRange(bytes, 0, 64, "DOS header");
  if (bytes.readUInt16LE(0) !== 0x5a4d) throw new Error(`${binary} is not a PE image`);
  const pe = bytes.readUInt32LE(0x3c);
  requireRange(bytes, pe, 24, "PE header");
  if (bytes.toString("ascii", pe, pe + 4) !== "PE\0\0") throw new Error(`${binary} has no PE signature`);

  const sectionCount = bytes.readUInt16LE(pe + 6);
  const optionalSize = bytes.readUInt16LE(pe + 20);
  const optional = pe + 24;
  requireRange(bytes, optional, optionalSize, "optional header");
  const magic = bytes.readUInt16LE(optional);
  const pe32Plus = magic === 0x20b;
  if (!pe32Plus && magic !== 0x10b) throw new Error(`${binary} has unsupported optional-header magic`);
  const directoryBase = optional + (pe32Plus ? 112 : 96);
  const directoryCount = bytes.readUInt32LE(optional + (pe32Plus ? 108 : 92));
  const imageBase = pe32Plus
    ? Number(bytes.readBigUInt64LE(optional + 24))
    : bytes.readUInt32LE(optional + 28);
  const sectionTable = optional + optionalSize;
  requireRange(bytes, sectionTable, sectionCount * 40, "section table");
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTable + index * 40;
    sections.push({
      virtualSize: bytes.readUInt32LE(offset + 8),
      virtualAddress: bytes.readUInt32LE(offset + 12),
      rawSize: bytes.readUInt32LE(offset + 16),
      rawOffset: bytes.readUInt32LE(offset + 20),
    });
  }

  const rvaToOffset = (rva, label) => {
    const section = sections.find((candidate) =>
      rva >= candidate.virtualAddress &&
      rva < candidate.virtualAddress + Math.max(candidate.virtualSize, candidate.rawSize));
    if (!section) throw new Error(`${label} RVA is not backed by a PE section`);
    const offset = section.rawOffset + rva - section.virtualAddress;
    requireRange(bytes, offset, 1, label);
    return offset;
  };
  const directory = (index) => {
    if (directoryCount <= index) return { rva: 0, size: 0 };
    requireRange(bytes, directoryBase + index * 8, 8, `data directory ${index}`);
    return {
      rva: bytes.readUInt32LE(directoryBase + index * 8),
      size: bytes.readUInt32LE(directoryBase + index * 8 + 4),
    };
  };

  const imports = new Set();
  const normal = directory(1);
  if (normal.rva !== 0) {
    const start = rvaToOffset(normal.rva, "import directory");
    for (let offset = start; ; offset += 20) {
      requireRange(bytes, offset, 20, "import descriptor");
      const fields = Array.from({ length: 5 }, (_, index) => bytes.readUInt32LE(offset + index * 4));
      if (fields.every((value) => value === 0)) break;
      imports.add(readAsciiZ(bytes, rvaToOffset(fields[3], "import name"), "import name"));
    }
  }

  const delayed = directory(13);
  if (delayed.rva !== 0) {
    const start = rvaToOffset(delayed.rva, "delay-import directory");
    for (let offset = start; ; offset += 32) {
      requireRange(bytes, offset, 32, "delay-import descriptor");
      const attributes = bytes.readUInt32LE(offset);
      const nameValue = bytes.readUInt32LE(offset + 4);
      if (attributes === 0 && nameValue === 0) break;
      const nameRva = (attributes & 1) !== 0 ? nameValue : nameValue - imageBase;
      imports.add(readAsciiZ(bytes, rvaToOffset(nameRva, "delay-import name"), "delay-import name"));
    }
  }
  return [...imports].sort((left, right) => left.localeCompare(right));
}

function isAllowedSystemImport(name) {
  const normalized = name.toLowerCase();
  return allowedSystemImports.has(normalized) ||
    normalized.startsWith("api-ms-win-") ||
    normalized.startsWith("ext-ms-win-");
}

const argumentsList = process.argv.slice(2);
const binaries = argumentsList
  .filter((argument) => argument.startsWith("--binary="))
  .map((argument) => path.resolve(argument.slice("--binary=".length)));
const releaseRootArgument = argumentsList.find((argument) => argument.startsWith("--release-root="));
const releaseRoot = releaseRootArgument
  ? path.resolve(releaseRootArgument.slice("--release-root=".length))
  : undefined;
const linkMaps = argumentsList
  .filter((argument) => argument.startsWith("--link-map="))
  .map((argument) => path.resolve(argument.slice("--link-map=".length)));
const probeToolchainFree = argumentsList.includes("--probe-toolchain-free");
const probeRootArgument = argumentsList.find((argument) => argument.startsWith("--probe-root="));

function releaseFiles(root) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) found.push(path.relative(root, absolute).replaceAll("\\", "/"));
      else throw new Error(`${absolute}: release contains a non-file filesystem entry`);
    }
  };
  if (!statSync(root).isDirectory()) throw new Error(`${root}: release root is not a directory`);
  visit(root);
  return found.sort((left, right) => left.localeCompare(right));
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function windowsShortPath(directory) {
  if (process.platform !== "win32") return directory;
  const powershell = path.join(
    process.env.SystemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const result = spawnSync(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$fileSystem=New-Object -ComObject Scripting.FileSystemObject; $fileSystem.GetFolder($env:VKF_SHORT_PATH_INPUT).ShortPath",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, VKF_SHORT_PATH_INPUT: directory },
      windowsHide: true,
    },
  );
  const shortened = result.stdout?.trim();
  if (result.status !== 0 || !shortened) {
    throw new Error(`could not shorten probe path ${directory}: ${result.stderr || result.stdout}`);
  }
  return shortened;
}

function verifyImports(binary) {
  const imports = parsePeImports(binary);
  for (const imported of imports) {
    if (!isAllowedSystemImport(imported)) {
      throw new Error(`${binary}: forbidden PE import ${imported}`);
    }
  }
  return imports;
}

function runToolchainFreeProbe(root) {
  const probeRoot = probeRootArgument
    ? path.resolve(probeRootArgument.slice("--probe-root=".length))
    : path.resolve("build/native-release-closure-probe");
  if (probeRoot === root || probeRoot === path.parse(probeRoot).root) {
    throw new Error(`unsafe probe root ${probeRoot}`);
  }
  rmSync(probeRoot, { recursive: true, force: true });
  mkdirSync(probeRoot, { recursive: true });
  const shortProbeRoot = windowsShortPath(probeRoot);
  const temp = path.join(shortProbeRoot, "temp");
  const localAppData = path.join(shortProbeRoot, "local-app-data");
  mkdirSync(temp, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  const compiler = path.join(root, "bin", "vkf.exe");
  const environment = {
    COMSPEC: process.env.COMSPEC,
    LOCALAPPDATA: localAppData,
    PATH: "",
    PATHEXT: process.env.PATHEXT,
    SystemRoot: process.env.SystemRoot,
    TEMP: temp,
    TMP: temp,
    WINDIR: process.env.WINDIR,
  };
  const compile = (source, output, label) => {
    const result = spawnSync(compiler, ["-b", source, "-o", output], {
      cwd: path.dirname(source),
      encoding: "utf8",
      env: environment,
      timeout: 60_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0 || !existsSync(output)) {
      const detail = result.error?.message || result.stderr || result.stdout || `exit ${result.status}`;
      throw new Error(`toolchain-free ${label} compile probe failed: ${String(detail).trim()}`);
    }
    const imports = verifyImports(output);
    return { output: path.basename(output), sha256: sha256(output), imports };
  };

  try {
    const consoleRoot = path.join(probeRoot, "console");
    mkdirSync(consoleRoot, { recursive: true });
    const consoleSource = path.join(consoleRoot, "main.vkf");
    const consoleOutput = path.join(consoleRoot, "main.exe");
    writeFileSync(consoleSource, ":: 6 * 7\n");
    const consoleProbe = compile(consoleSource, consoleOutput, "console");

    const uiRoot = path.join(probeRoot, "ui-app");
    const uiAssets = path.join(uiRoot, "ui");
    mkdirSync(uiAssets, { recursive: true });
    const uiSource = path.join(uiRoot, "app.vkf");
    const uiOutput = path.join(uiRoot, "app.exe");
    writeFileSync(uiSource, [
      ": .ui.display",
      "display: Display(dim:2)",
      "frame: display.add_frame(pos:[0.1, 0.2], size:[0.5, 0.6])",
      'frame.load("ui/main.html")',
      "",
    ].join("\n"));
    writeFileSync(path.join(uiAssets, "main.html"), "<button>Dependency closure</button>\n");
    const uiProbe = compile(uiSource, uiOutput, "UI");
    return {
      environment: {
        path: "",
        python: false,
        node: false,
        cppCompiler: false,
        assembler: false,
        linker: false,
        sdk: false,
      },
      console: consoleProbe,
      ui: uiProbe,
    };
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
}

if (binaries.length === 0 && !releaseRoot && linkMaps.length === 0) {
  console.error("usage: verify-windows-release-closure.mjs (--release-root=<path> | --binary=<path> ... | --link-map=<path> ...)");
  process.exit(64);
}

try {
  let files;
  if (releaseRoot) {
    files = releaseFiles(releaseRoot);
    const expectedExecutables = [
      "bin/vkf.exe",
      "bin/vkf-native-scene-artifact-stager.exe",
      "bin/vkf-runner.exe",
      "bin/vkf-ui-package.exe",
    ];
    const nativeLibraryExtensions = new Set([
      ".a", ".dll", ".dylib", ".lib", ".node", ".obj", ".pdb", ".pyd", ".so",
    ]);
    for (const relative of files) {
      if (nativeLibraryExtensions.has(path.extname(relative).toLowerCase())) {
        throw new Error(`${releaseRoot}: bundled native library or build artifact ${relative}`);
      }
      if (path.extname(relative).toLowerCase() === ".exe" && !expectedExecutables.includes(relative)) {
        throw new Error(`${releaseRoot}: unexpected executable ${relative}`);
      }
    }
    for (const relative of expectedExecutables) {
      if (!files.includes(relative)) throw new Error(`${releaseRoot}: missing shipped executable ${relative}`);
      binaries.push(path.join(releaseRoot, ...relative.split("/")));
    }
  }
  const forbiddenSemanticObjects = [
    "compiled_ui_bootstrap_host",
    "compiled_ui_bootstrap_packet_bridge",
    "compiled_ui_bootstrap_runtime",
    "compiled_ui_runtime_demo",
    "compiled_ui_runtime_loader",
    "compiled_ui_runtime_registry",
    "overlay_geometry_ledger_runtime",
    "overlay_packet_runtime",
  ];
  const mapReport = linkMaps.map((linkMap) => {
    const contents = readFileSync(linkMap, "utf8").toLowerCase();
    const forbidden = forbiddenSemanticObjects.filter((name) => contents.includes(name));
    if (forbidden.length > 0) {
      throw new Error(`${linkMap}: forbidden native UI semantics ${forbidden.join(", ")}`);
    }
    return { linkMap, forbiddenSemanticObjects: [] };
  });
  const report = binaries.map((binary) => {
    const imports = verifyImports(binary);
    return { binary, imports };
  });
  const compileProbe = probeToolchainFree
    ? runToolchainFreeProbe(releaseRoot)
    : undefined;
  process.stdout.write(`${JSON.stringify({ schema: 1, releaseRoot, files, binaries: report, linkMaps: mapReport, compileProbe }, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
