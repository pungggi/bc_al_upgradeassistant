const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const FileReferenceProvider = require("./fileReferenceProvider");

/**
 * Register the BC/AL reference views
 * @param {vscode.ExtensionContext} context The extension context
 */
function registerViews(context) {
  // Create the tree data provider
  const fileReferenceProvider = new FileReferenceProvider();

  // Register the tree view
  const treeView = vscode.window.createTreeView("bc-al-references", {
    treeDataProvider: fileReferenceProvider,
    showCollapseAll: true,
  });

  // Add another tree view in explorer section for quick access
  const explorerView = vscode.window.createTreeView("bc-al-file-info", {
    treeDataProvider: fileReferenceProvider,
    showCollapseAll: true,
  });

  // Register command to open a referenced object
  const openObjectCommand = vscode.commands.registerCommand(
    "bc-al-upgradeassistant.openReferencedObject",
    (type, id, indexFolder) => {
      try {
        const objectFolder = path.join(indexFolder, type.toLowerCase(), id);
        const infoFilePath = path.join(objectFolder, "info.json");

        if (fs.existsSync(infoFilePath)) {
          const infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));

          if (infoData.originalPath && fs.existsSync(infoData.originalPath)) {
            // Open the file
            vscode.workspace
              .openTextDocument(infoData.originalPath)
              .then((doc) => vscode.window.showTextDocument(doc));
          } else {
            vscode.window.showErrorMessage(
              `Cannot find original file for ${type} ${id}`
            );
          }
        } else {
          vscode.window.showErrorMessage(
            `No info file found for ${type} ${id}`
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error opening referenced object: ${error.message}`
        );
      }
    }
  );

  // Register command to open a migration file
  const openMigrationFileCommand = vscode.commands.registerCommand(
    "bc-al-upgradeassistant.openMigrationFile",
    (filePath) => {
      try {
        if (fs.existsSync(filePath)) {
          // Open the file
          vscode.workspace
            .openTextDocument(filePath)
            .then((doc) => vscode.window.showTextDocument(doc));
        } else {
          vscode.window.showErrorMessage(`File not found: ${filePath}`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error opening migration file: ${error.message}`
        );
      }
    }
  );

  // Register command to open documentation reference at specific line
  const openDocRefCommand = vscode.commands.registerCommand(
    "bc-al-upgradeassistant.openDocumentationReference",
    (itemOrPath, lineNumber) => {
      try {
        let filePath = "";
        let line = 0;

        if (itemOrPath && itemOrPath.filePath && itemOrPath.lineNumber) {
          // Called from tree item context menu
          filePath = itemOrPath.filePath;
          line = itemOrPath.lineNumber;
        } else if (
          typeof itemOrPath === "string" &&
          typeof lineNumber === "number"
        ) {
          // Called with direct arguments
          filePath = itemOrPath;
          line = lineNumber;
        }

        if (filePath && fs.existsSync(filePath)) {
          // Open the file and position at the line
          vscode.workspace.openTextDocument(filePath).then((doc) => {
            const editor = vscode.window.showTextDocument(doc);
            return editor.then((e) => {
              // Convert to 0-based line number
              const position = new vscode.Position(line - 1, 0);
              e.selection = new vscode.Selection(position, position);
              e.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
              );
            });
          });
        } else {
          vscode.window.showErrorMessage(`File not found: ${filePath}`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error opening documentation reference: ${error.message}`
        );
      }
    }
  );

  // Register command to toggle documentation reference done state
  const toggleDocRefDoneCommand = vscode.commands.registerCommand(
    "bc-al-upgradeassistant.toggleDocumentationReferenceDone",
    (item) => {
      try {
        console.log(
          "Toggle documentation reference command called with item:",
          item
        );

        // Extract arguments from the tree item
        if (item && item.filePath && item.docId && item.lineNumber) {
          // Called from tree item context menu
          fileReferenceProvider.toggleDocumentationReferenceDone(
            item.filePath,
            item.docId,
            item.lineNumber
          );
        } else if (Array.isArray(item)) {
          // Called with array arguments
          const [filePath, id, lineNumber] = item;
          fileReferenceProvider.toggleDocumentationReferenceDone(
            filePath,
            id,
            lineNumber
          );
        } else {
          vscode.window.showErrorMessage(
            `Invalid arguments for toggle documentation reference command`
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error toggling documentation reference state: ${error.message}`
        );
      }
    }
  );

  // Register command to open documentation URL
  const openDocUrlCommand = vscode.commands.registerCommand(
    "bc-al-upgradeassistant.openDocumentationUrl",
    (item) => {
      try {
        console.log("Open documentation URL command called with item:", item);
        let url = "";

        // Extract URL from the tree item or arguments
        if (item && item.docUrl) {
          // Called from tree item context menu
          url = item.docUrl;
        } else if (typeof item === "string") {
          // Called with direct URL string
          url = item;
        } else if (Array.isArray(item) && item.length > 0) {
          // Called with array containing URL
          url = item[0];
        }

        if (url) {
          vscode.env.openExternal(vscode.Uri.parse(url));
        } else {
          vscode.window.showErrorMessage(
            "No URL available for this documentation reference"
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error opening documentation URL: ${error.message}`
        );
      }
    }
  );

  // Register command to refresh the view
  const refreshViewCommand = vscode.commands.registerCommand(
    "bc-al-upgradeassistant.refreshReferenceView",
    () => {
      fileReferenceProvider.refresh();
    }
  );

  // Add all disposables to context
  context.subscriptions.push(
    treeView,
    explorerView,
    openObjectCommand,
    openMigrationFileCommand,
    openDocRefCommand,
    toggleDocRefDoneCommand,
    openDocUrlCommand,
    refreshViewCommand,
    fileReferenceProvider
  );

  console.log("BC/AL Reference views registered");
}

module.exports = {
  registerViews,
};
