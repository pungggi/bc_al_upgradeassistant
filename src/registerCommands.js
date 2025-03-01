const vscode = require("vscode");
const { extractObjectsWithDialog } = require("./utils/objectExtractor");
const { initializeSymbolCache } = require("./extension");

/**
 * Register all commands used by the extension
 * @param {vscode.ExtensionContext} context
 */
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
        await initializeSymbolCache(context, true);
        vscode.window.showInformationMessage("Symbol cache refreshed");
      }
    )
  );

  // Register command to extract C/AL objects from text file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.extractCalObjects",
      extractObjectsWithDialog
    )
  );

  // Add more commands as needed
}

module.exports = {
  registerCommands,
};
