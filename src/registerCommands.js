const vscode = require("vscode");
const { extractObjectsWithDialog } = require("./utils/objectExtractor");
const path = require("path");

function registerCommands(context) {
  // Register existing commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc_al_upgradeassistant.showMessage",
      function () {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const document = editor.document;
          const selection = editor.selection;
          const text = document.getText(selection);
          vscode.window.showInformationMessage("Selected text: " + text);
        }
      }
    )
  );

  // Register command to refresh symbol cache
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.refreshSymbolCache",
      async () => {
        try {
          const extension = require("./extension");
          await extension.initializeSymbolCache(context, true);
          vscode.window.showInformationMessage(
            "Symbol cache refreshed successfully."
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Error refreshing symbol cache: ${error.message}`
          );
        }
      }
    )
  );

  // Register command to extract C/AL objects from text file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.splitCalObjects",
      extractObjectsWithDialog
    )
  );

  // Add more commands as needed
}

module.exports = {
  registerCommands,
};
