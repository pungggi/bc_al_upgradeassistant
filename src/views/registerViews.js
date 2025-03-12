const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const FileReferenceProvider = require("./fileReferenceProvider");

/**
 * Register all views for the extension
 * @param {vscode.ExtensionContext} context Extension context
 * @returns {Object} Object containing the registered providers
 */
function registerViews(context) {
  // Create the file reference provider
  const fileReferenceProvider = new FileReferenceProvider();
  fileReferenceProvider.initialize(context);

  // Register the tree data provider for BC/AL file references in the activity bar
  const referenceView = vscode.window.createTreeView("bc-al-references", {
    treeDataProvider: fileReferenceProvider,
    showCollapseAll: true,
  });

  // Update expanded state when items are expanded/collapsed
  referenceView.onDidExpandElement((e) => {
    if (e.element.id) {
      fileReferenceProvider.setItemExpandedState(e.element.id, true);
    }
  });

  referenceView.onDidCollapseElement((e) => {
    if (e.element.id) {
      fileReferenceProvider.setItemExpandedState(e.element.id, false);
    }
  });

  // Register the tree data provider for BC/AL file references in the explorer sidebar
  const fileInfoView = vscode.window.createTreeView("bc-al-file-info", {
    treeDataProvider: fileReferenceProvider,
    showCollapseAll: true,
  });

  // Update expanded state when items are expanded/collapsed
  fileInfoView.onDidExpandElement((e) => {
    if (e.element.id) {
      fileReferenceProvider.setItemExpandedState(e.element.id, true);
    }
  });

  fileInfoView.onDidCollapseElement((e) => {
    if (e.element.id) {
      fileReferenceProvider.setItemExpandedState(e.element.id, false);
    }
  });

  // Register refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.refreshReferenceView",
      () => {
        fileReferenceProvider.refresh();
      }
    )
  );

  // Register command to open a documentation reference
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.openDocumentationReference",
      (filePath, lineNumber) => {
        vscode.workspace.openTextDocument(filePath).then((doc) => {
          vscode.window.showTextDocument(doc).then((editor) => {
            const position = new vscode.Position(lineNumber - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
              new vscode.Range(position, position),
              vscode.TextEditorRevealType.InCenter
            );
          });
        });
      }
    )
  );

  // Register command to toggle documentation reference as done
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.toggleDocumentationReferenceDone",
      (item) => {
        if (
          item &&
          item.filePath &&
          item.docId &&
          item.lineNumber !== undefined
        ) {
          const newState =
            fileReferenceProvider.toggleDocumentationReferenceDone(
              item.filePath,
              item.docId,
              item.lineNumber
            );
          const statusText = newState ? "marked as done" : "marked as not done";
          vscode.window.setStatusBarMessage(
            `Documentation reference ${item.docId} ${statusText}`,
            3000
          );
        }
      }
    )
  );

  // Register command to open documentation URL
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.openDocumentationUrl",
      (item) => {
        if (item && item.docUrl) {
          vscode.env.openExternal(vscode.Uri.parse(item.docUrl));
        } else {
          vscode.window.showWarningMessage("No documentation URL available");
        }
      }
    )
  );

  // Register command to open a referenced object
  context.subscriptions.push(
    vscode.commands.registerCommand(
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
    )
  );

  // Register command to open a migration file
  context.subscriptions.push(
    vscode.commands.registerCommand(
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
    )
  );

  // Add the providers to dispose when the extension is deactivated
  context.subscriptions.push(fileReferenceProvider);

  // Return the providers for use in other parts of the extension
  return { fileReferenceProvider };
}

module.exports = { registerViews };
