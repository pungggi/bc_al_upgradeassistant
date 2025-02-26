const vscode = require("vscode");

// This method is called when your extension is activated
function activate(context) {
  // Command registration
  let disposable = vscode.commands.registerCommand(
    "bc_al_upgradeassistant.showMessage",
    function () {
      vscode.window.showInformationMessage("Hello ppl!");
    }
  );

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
