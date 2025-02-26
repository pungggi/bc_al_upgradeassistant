const vscode = require("vscode");

const {
  isEventSubscriberTemplate,
  modifyEventSubscriberTemplate,
} = require("./ALCode");
const { registerCommands } = require("./registerCommands");

// Function to monitor and modify the clipboard
async function monitorClipboard() {
  let lastClipboardContent = "";

  setInterval(async () => {
    try {
      const clipboardContent = await vscode.env.clipboard.readText();

      // Check if the clipboard has changed and matches any AL code pattern
      if (
        clipboardContent !== lastClipboardContent &&
        isEventSubscriberTemplate(clipboardContent)
      ) {
        vscode.window.showInformationMessage(clipboardContent);
        lastClipboardContent = clipboardContent;

        // Modify AL code
        const modifiedContent = modifyEventSubscriberTemplate(clipboardContent);
        vscode.window.showInformationMessage(modifiedContent);

        // Write back to clipboard
        await vscode.env.clipboard.writeText(modifiedContent);
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Error monitoring clipboard: ${error.message}`
      );
    }
  }, 1300);
}

function activate(context) {
  let disposable = registerCommands();
  monitorClipboard();

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
