"use strict";

const path = require("path");
const vscode = require("vscode");
const { findFunctionSymbolAt, parseFunctionSymbols } = require("./docIndex");

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

  const hoverProvider = vscode.languages.registerHoverProvider("vektorflow", {
    provideHover(document, position) {
      const text = document.getText();
      let symbol = findFunctionSymbolAt(text, position.line, position.character);

      if (!symbol) {
        const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
        if (!range) return null;
        const word = document.getText(range);
        const candidates = parseFunctionSymbols(text).filter((entry) => entry.name === word);
        if (!candidates.length) return null;
        symbol =
          candidates
            .filter((entry) => entry.line <= position.line)
            .sort((a, b) => b.line - a.line)[0] || candidates[0];
      }

      const md = new vscode.MarkdownString();
      md.appendCodeblock(symbol.signature, "vektorflow");
      md.appendMarkdown("\n\nFunction");
      if (symbol.docstring) {
        md.appendMarkdown(`\n\nDoc:\n${symbol.docstring}`);
      }
      return new vscode.Hover(md);
    },
  });

  context.subscriptions.push(hoverProvider);
}

function deactivate() {}

module.exports = { activate, deactivate };
