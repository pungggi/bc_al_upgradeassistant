const vscode = require("vscode");
const { extractObjectsWithDialog } = require("./utils/objectExtractor");
const path = require("path");

function registerCommands(context) {
  registerRefreshSymbolCacheCommand(context);
  registerSplitCalObjectsCommand(context);
}

function registerRefreshSymbolCacheCommand(context) {
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
}

function registerSplitCalObjectsCommand(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.splitCalObjects",
      extractObjectsWithDialog
    )
  );
}

module.exports = {
  registerCommands,
};
