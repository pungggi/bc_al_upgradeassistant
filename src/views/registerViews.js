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
    refreshViewCommand,
    fileReferenceProvider
  );

  console.log("BC/AL Reference views registered");
}

module.exports = {
  registerViews,
};
