const vscode = require("vscode");

function registerCommands() {
  return vscode.commands.registerCommand(
    "bc_al_upgradeassistant.showMessage",
    () => {
      vscode.window.showInformationMessage(
        "Hello from BC/AL Upgrade Assistant!"
      );
    }
  );
}
exports.registerCommands = registerCommands;
