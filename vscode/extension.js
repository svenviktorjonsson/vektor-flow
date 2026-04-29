"use strict";

const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const vscode = require("vscode");

const execFileAsync = promisify(execFile);
const diagnosticsRuns = new Map();

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const output = vscode.window.createOutputChannel("Vektor Flow");
  const diagnostics = vscode.languages.createDiagnosticCollection("vektorflow");
  const diagnosticsTimers = new Map();
  let diagnosticsToolMissingNotified = false;

  const runFile = async () => {
    const doc = await prepareActiveVkfDocument("run");
    if (!doc) {
      return;
    }
    const compiler = getCompilerInvocation();
    if (!(await ensureCompilerAvailable(compiler))) {
      return;
    }
    launchTerminalCommand(doc, compiler, [doc.uri.fsPath], "Vektor Flow Run");
  };

  const parseFile = async () => {
    const doc = await prepareActiveVkfDocument("parse");
    if (!doc) {
      return;
    }
    const compiler = getCompilerInvocation();
    if (!(await ensureCompilerAvailable(compiler))) {
      return;
    }
    await runCapturedCommand(
      doc,
      compiler,
      [preferredParseCommand(), doc.uri.fsPath],
      output,
      "parse"
    );
  };

  const buildFile = async () => {
    const doc = await prepareActiveVkfDocument("build");
    if (!doc) {
      return;
    }
    const compiler = getCompilerInvocation();
    if (!(await ensureCompilerAvailable(compiler))) {
      return;
    }
    await runCapturedCommand(
      doc,
      compiler,
      [preferredBuildCommand(), doc.uri.fsPath],
      output,
      "build"
    );
  };

  const checkFile = async () => {
    const doc = await prepareActiveVkfDocument("check");
    if (!doc) {
      return;
    }
    const compiler = getCompilerInvocation();
    if (!(await ensureCompilerAvailable(compiler))) {
      return;
    }
    await runCheckCommand(doc, compiler, diagnostics, output);
  };

  const showOutput = () => output.show(true);

  const scheduleDiagnostics = (doc, immediate = false) => {
    if (!shouldLintDocument(doc)) {
      return;
    }
    const key = doc.uri.toString();
    const existing = diagnosticsTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const delay = immediate ? 0 : diagnosticsDebounceMs();
    const timer = setTimeout(() => {
      diagnosticsTimers.delete(key);
      void refreshDiagnostics(doc, diagnostics, output, () => {
        diagnosticsToolMissingNotified = true;
      }, () => diagnosticsToolMissingNotified);
    }, delay);
    diagnosticsTimers.set(key, timer);
  };

  context.subscriptions.push(
    output,
    diagnostics,
    vscode.commands.registerCommand("vektorflow.runFile", runFile),
    vscode.commands.registerCommand("vektorflow.parseFile", parseFile),
    vscode.commands.registerCommand("vektorflow.buildFile", buildFile),
    vscode.commands.registerCommand("vektorflow.checkFile", checkFile),
    vscode.commands.registerCommand("vektorflow.showOutput", showOutput),
    vscode.workspace.onDidOpenTextDocument((doc) => scheduleDiagnostics(doc, true)),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleDiagnostics(event.document)),
    vscode.workspace.onDidSaveTextDocument((doc) => scheduleDiagnostics(doc, true)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const existing = diagnosticsTimers.get(key);
      if (existing) {
        clearTimeout(existing);
        diagnosticsTimers.delete(key);
      }
      diagnosticsRuns.delete(key);
      diagnostics.delete(doc.uri);
    })
  );

  if (vscode.window.activeTextEditor) {
    scheduleDiagnostics(vscode.window.activeTextEditor.document, true);
  }
}

function deactivate() {}

function getCompilerInvocation() {
  const config = vscode.workspace.getConfiguration("vektorflow");
  const compilerPath = String(config.get("compilerPath", "vkf")).trim();
  const configuredArgs = config.get("compilerArgs", []);
  const compilerArgs = Array.isArray(configuredArgs)
    ? configuredArgs.map((value) => String(value))
    : [];
  if (compilerPath) {
    return { command: compilerPath, args: compilerArgs };
  }

  const pythonPath = String(config.get("pythonPath", "python")).trim() || "python";
  return {
    command: pythonPath,
    args: ["-m", "vektorflow.cli", ...compilerArgs],
  };
}

function preferredParseCommand() {
  return "parse-native-core";
}

function preferredBuildCommand() {
  const config = vscode.workspace.getConfiguration("vektorflow");
  return config.get("useNativeCoreCommands", true)
    ? "build-native-core"
    : "build";
}

function diagnosticsCommand() {
  const config = vscode.workspace.getConfiguration("vektorflow");
  return config.get("useNativeCoreCommands", true)
    ? "cpp-native-core"
    : "cpp";
}

function diagnosticsDebounceMs() {
  const config = vscode.workspace.getConfiguration("vektorflow");
  const configured = Number(config.get("diagnosticsDebounceMs", 350));
  return Number.isFinite(configured) && configured >= 0 ? configured : 350;
}

function diagnosticsEnabled() {
  return vscode.workspace.getConfiguration("vektorflow").get("enableDiagnostics", true);
}

async function prepareActiveVkfDocument(actionLabel) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(`Vektor Flow: no active editor to ${actionLabel}.`);
    return null;
  }

  const doc = editor.document;
  const isVkf =
    doc.languageId === "vektorflow" ||
    doc.fileName.toLowerCase().endsWith(".vkf");
  if (!isVkf) {
    vscode.window.showWarningMessage(`Vektor Flow: open a .vkf file to ${actionLabel}.`);
    return null;
  }

  if (doc.isUntitled) {
    vscode.window.showWarningMessage(
      `Vektor Flow: save this file before trying to ${actionLabel}.`
    );
    return null;
  }

  if (doc.isDirty) {
    await doc.save();
  }

  return doc;
}

function isVkfDocument(doc) {
  return (
    !!doc &&
    (doc.languageId === "vektorflow" ||
      doc.fileName.toLowerCase().endsWith(".vkf"))
  );
}

function shouldLintDocument(doc) {
  return diagnosticsEnabled() && isVkfDocument(doc) && !doc.isUntitled;
}

async function ensureCompilerAvailable(compiler) {
  try {
    await execFileAsync(compiler.command, [...compiler.args, "--version"], {
      windowsHide: true,
    });
    return true;
  } catch (error) {
    const configuredPath =
      compiler.args.length > 0
        ? `${compiler.command} ${compiler.args.join(" ")}`
        : compiler.command;
    const action = await vscode.window.showErrorMessage(
      `Vektor Flow: compiler is not available (${configuredPath}). Check vektorflow.compilerPath or vektorflow.pythonPath.`,
      "Open Settings"
    );
    if (action === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "vektorflow.compilerPath"
      );
    }
    return false;
  }
}

async function refreshDiagnostics(doc, diagnostics, output, markMissingToolNotified, isMissingToolNotified) {
  if (!shouldLintDocument(doc)) {
    diagnostics.delete(doc.uri);
    return;
  }

  const compiler = getCompilerInvocation();
  const key = doc.uri.toString();
  const runId = (diagnosticsRuns.get(key) || 0) + 1;
  diagnosticsRuns.set(key, runId);

  const sourceRef = await createDiagnosticsSourceRef(doc);
  try {
    await execFileAsync(compiler.command, [...compiler.args, "--version"], {
      windowsHide: true,
    });
  } catch {
    diagnostics.delete(doc.uri);
    if (!isMissingToolNotified()) {
      markMissingToolNotified();
      vscode.window.showInformationMessage(
        "Vektor Flow: diagnostics are idle until the compiler CLI is available."
      );
    }
    await sourceRef.cleanup();
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const cwd = folder?.uri.fsPath ?? path.dirname(doc.uri.fsPath);
  try {
    await execFileAsync(
      compiler.command,
      [...compiler.args, diagnosticsCommand(), sourceRef.path],
      { cwd, windowsHide: true }
    );
    if (diagnosticsRuns.get(key) !== runId) {
      return;
    }
    diagnostics.delete(doc.uri);
  } catch (error) {
    if (diagnosticsRuns.get(key) !== runId) {
      return;
    }
    const stderr = String(error.stderr || error.stdout || error.message || "");
    const parsed = parseCompilerDiagnostics(doc, sourceRef.path, stderr);
    diagnostics.set(doc.uri, parsed);
    if (parsed.length > 0 || stderr.trim()) {
      output.clear();
      output.appendLine(`> ${[compiler.command, ...compiler.args, diagnosticsCommand(), sourceRef.path].join(" ")}`);
      output.append(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
    }
    if (parsed.length === 0 && stderr.trim()) {
      vscode.window.setStatusBarMessage(
        `Vektor Flow: compiler failed without source locations for ${path.basename(doc.uri.fsPath)}. Use “Vektor Flow: Show Output”.`,
        5000
      );
    }
  } finally {
    await sourceRef.cleanup();
  }
}

async function createDiagnosticsSourceRef(doc) {
  if (!doc.isDirty) {
    return {
      path: doc.uri.fsPath,
      cleanup: async () => {},
    };
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vektorflow-vscode-"));
  const tempPath = path.join(tempDir, path.basename(doc.uri.fsPath));
  await fs.writeFile(tempPath, doc.getText(), "utf8");
  return {
    path: tempPath,
    cleanup: async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup for temporary diagnostics files.
      }
    },
  };
}

function parseCompilerDiagnostics(doc, sourcePath, stderr) {
  const diagnostics = [];
  const normalizedSourcePath = path.normalize(sourcePath);
  for (const rawLine of stderr.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = /^error:\s+(.+):(\d+):(\d+):\s+(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, reportedPath, lineText, characterText, message] = match;
    if (path.normalize(reportedPath) !== normalizedSourcePath) {
      continue;
    }
    const lineIndex = Math.max(0, Number.parseInt(lineText, 10) - 1);
    const characterIndex = Math.max(0, Number.parseInt(characterText, 10) - 1);
    const start = clampToDocument(doc, lineIndex, characterIndex);
    const end = clampToDocument(doc, lineIndex, characterIndex + 1);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(start, end),
      message,
      vscode.DiagnosticSeverity.Error
    );
    diagnostic.source = "vektorflow";
    diagnostic.code = "compiler";
    diagnostics.push(diagnostic);
  }
  return diagnostics;
}

function clampToDocument(doc, line, character) {
  const safeLine = Math.max(0, Math.min(line, Math.max(0, doc.lineCount - 1)));
  const safeCharacter = Math.max(
    0,
    Math.min(character, doc.lineAt(safeLine).text.length)
  );
  return new vscode.Position(safeLine, safeCharacter);
}

function launchTerminalCommand(doc, compiler, cliArgs, terminalName) {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const cwd = folder?.uri.fsPath ?? path.dirname(doc.uri.fsPath);
  const term = vscode.window.createTerminal({
    name: terminalName,
    cwd,
  });
  term.show(true);
  term.sendText(buildTerminalCommandLine(compiler, cliArgs), true);
}

async function runCapturedCommand(doc, compiler, cliArgs, output, label) {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const cwd = folder?.uri.fsPath ?? path.dirname(doc.uri.fsPath);
  output.clear();
  output.appendLine(`> ${[compiler.command, ...compiler.args, ...cliArgs].join(" ")}`);
  try {
    const { stdout, stderr } = await execFileAsync(
      compiler.command,
      [...compiler.args, ...cliArgs],
      {
        cwd,
        windowsHide: true,
      }
    );
    if (stdout) {
      output.append(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
    }
    if (stderr) {
      output.append(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
    }
    output.show(true);
    vscode.window.showInformationMessage(`Vektor Flow ${label} succeeded.`);
  } catch (error) {
    if (error.stdout) {
      output.append(error.stdout.endsWith("\n") ? error.stdout : `${error.stdout}\n`);
    }
    if (error.stderr) {
      output.append(error.stderr.endsWith("\n") ? error.stderr : `${error.stderr}\n`);
    } else if (error.message) {
      output.appendLine(error.message);
    }
    output.show(true);
    vscode.window.showErrorMessage(`Vektor Flow ${label} failed. See output for details.`);
  }
}

async function runCheckCommand(doc, compiler, diagnostics, output) {
  const sourceRef = await createDiagnosticsSourceRef(doc);
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const cwd = folder?.uri.fsPath ?? path.dirname(doc.uri.fsPath);
  const cliArgs = [diagnosticsCommand(), sourceRef.path];
  const commandText = [compiler.command, ...compiler.args, ...cliArgs].join(" ");
  output.clear();
  output.appendLine(`> ${commandText}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Vektor Flow: checking ${path.basename(doc.uri.fsPath)}`,
      cancellable: false,
    },
    async () => {
      try {
        const { stdout, stderr } = await execFileAsync(
          compiler.command,
          [...compiler.args, ...cliArgs],
          {
            cwd,
            windowsHide: true,
          }
        );
        diagnostics.delete(doc.uri);
        if (stdout) {
          output.append(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
        }
        if (stderr) {
          output.append(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
        }
        output.appendLine("Check succeeded.");
        vscode.window.setStatusBarMessage(
          `Vektor Flow: check passed for ${path.basename(doc.uri.fsPath)}`,
          4000
        );
        vscode.window.showInformationMessage(
          `Vektor Flow: no diagnostics in ${path.basename(doc.uri.fsPath)}.`
        );
      } catch (error) {
        const stderr = String(error.stderr || error.stdout || error.message || "");
        const parsed = parseCompilerDiagnostics(doc, sourceRef.path, stderr);
        diagnostics.set(doc.uri, parsed);
        if (stderr) {
          output.append(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
        } else if (error.message) {
          output.appendLine(error.message);
        }
        if (parsed.length > 0) {
          output.appendLine(`Check found ${parsed.length} diagnostic(s).`);
          await vscode.commands.executeCommand("workbench.actions.view.problems");
          vscode.window.showWarningMessage(
            `Vektor Flow: found ${parsed.length} diagnostic${parsed.length === 1 ? "" : "s"} in ${path.basename(doc.uri.fsPath)}.`
          );
        } else {
          output.appendLine("Check failed without source-linked diagnostics.");
          output.show(true);
          vscode.window.showErrorMessage(
            `Vektor Flow check failed for ${path.basename(doc.uri.fsPath)}. See output for details.`
          );
        }
      } finally {
        await sourceRef.cleanup();
      }
    }
  );
}

function quoteArg(value) {
  return JSON.stringify(String(value));
}

function buildTerminalCommandLine(compiler, cliArgs) {
  const pieces = [compiler.command, ...compiler.args, ...cliArgs].map(quoteArg);
  if (process.platform === "win32") {
    return `& ${pieces.join(" ")}`;
  }
  return pieces.join(" ");
}

module.exports = { activate, deactivate };
