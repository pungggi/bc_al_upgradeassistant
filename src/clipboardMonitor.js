const vscode = require("vscode");
const {
  isEventSubscriberTemplate,
  modifyEventSubscriberTemplate,
} = require("./ALCode");

let lastClipboardContent = "";

/**
 * Checks if the current document is a Business Central AL codeunit
 * @param {vscode.TextDocument} document - The document to check
 * @returns {boolean} - Whether the document is an AL codeunit
 */
function isAlCodeunit(document) {
  if (!document || document.languageId !== "al") {
    return false;
  }

  // Get the content and find the first non-whitespace line
  const content = document.getText();
  const lines = content.split("\n");

  // Find the first non-empty line
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine) {
      // Check if the first non-whitespace line contains "codeunit" definition
      const codeunitPattern = /codeunit\s+\d+\s+["']?[^"']+["']?/i;
      return codeunitPattern.test(trimmedLine);
    }
  }

  return false;
}

/**
 * Process clipboard content if it matches AL event subscriber template
 * @returns {Promise<void>}
 */
async function processClipboard() {
  try {
    const clipboardContent = await vscode.env.clipboard.readText();

    // Check if clipboard content matches AL event subscriber pattern
    if (
      clipboardContent !== lastClipboardContent &&
      isEventSubscriberTemplate(clipboardContent)
    ) {
      lastClipboardContent = clipboardContent;
      // Modify AL code
      const modifiedContent = modifyEventSubscriberTemplate(clipboardContent);

      // Write back to clipboard
      await vscode.env.clipboard.writeText(modifiedContent);
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Error processing clipboard: ${error.message}`
    );
  }
}

/**
 * Function to register clipboard check on focus change
 * @param {vscode.ExtensionContext} context - Extension context
 */
function registerClipboardMonitor(context) {
  // Register editor focus change event
  const disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && isAlCodeunit(editor.document)) {
      processClipboard();
    }
  });

  context.subscriptions.push(disposable);

  // Initial check for current editor
  const editor = vscode.window.activeTextEditor;
  if (editor && isAlCodeunit(editor.document)) {
    processClipboard();
  }
}

module.exports = {
  registerClipboardMonitor,
};
