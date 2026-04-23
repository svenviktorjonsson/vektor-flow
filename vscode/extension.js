"use strict";

const path = require("path");
const vscode = require("vscode");

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const runFile = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Vektor Flow: no active editor.");
      return;
    }
    const doc = editor.document;
    const isVkf =
      doc.languageId === "vektorflow" ||
      doc.fileName.toLowerCase().endsWith(".vkf");
    if (!isVkf) {
      vscode.window.showWarningMessage(
        "Vektor Flow: open a .vkf file to run."
      );
      return;
    }
    const config = vscode.workspace.getConfiguration("vektorflow");
    const python = config.get("pythonPath", "python");
    const filePath = doc.uri.fsPath;
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const cwd = folder?.uri.fsPath ?? path.dirname(filePath);
    const term = vscode.window.createTerminal({
      name: "Vektor Flow",
      cwd,
    });
    term.show(true);
    const quoted = JSON.stringify(filePath);
    term.sendText(`${python} -m vektorflow.cli ${quoted}`, true);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("vektorflow.runFile", runFile)
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
