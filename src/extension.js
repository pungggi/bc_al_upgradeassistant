const vscode = require("vscode");
const { getWebviewContent } = require("./webviewContent");

// This method is called when your extension is activated
function activate(context) {
  // Command registration
  let disposable = vscode.commands.registerCommand(
    "bc_al_upgradeassistant.showMessage",
    function () {
      vscode.window.showInformationMessage("Hello from My Extension!");
    }
  );

  // Create Webview
  let panel = vscode.window.createWebviewPanel(
    "dragDropPanel",
    "Drag & Drop Example",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    }
  );

  panel.webview.html = getWebviewContent();

  panel.webview.onDidReceiveMessage((message) => {
    if (message.command === "fileDropped") {
      vscode.window.showInformationMessage("File content received!");
      console.log(message.content);
    }
  });

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
