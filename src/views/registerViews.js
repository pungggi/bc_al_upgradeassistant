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
  // Add showCollapseAll and canSelectMany options and importantly - add showButtons option
  const referenceView = vscode.window.createTreeView("bc-al-references", {
    treeDataProvider: fileReferenceProvider,
    showCollapseAll: true,
    showButtons: true,
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
  // Also add showButtons option here
  const fileInfoView = vscode.window.createTreeView("bc-al-file-info", {
    treeDataProvider: fileReferenceProvider,
    showCollapseAll: true,
    showButtons: true,
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
        if (!filePath) {
          console.error(
            "openDocumentationReference called with no filePath argument"
          );
          vscode.window.showErrorMessage("No file path provided");
          return;
        }

        try {
          if (!fs.existsSync(filePath)) {
            vscode.window.showErrorMessage(`File not found: ${filePath}`);
            return;
          }

          // Create position object for cursor placement
          const position = new vscode.Position(lineNumber - 1, 0);
          const range = new vscode.Range(position, position);

          // Check if the file is already open in any visible editor
          for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.fileName === filePath) {
              // File is already open, just focus its tab and position cursor
              editor.selection = new vscode.Selection(position, position);
              editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
              return vscode.window.showTextDocument(
                editor.document,
                editor.viewColumn
              );
            }
          }

          // Also check if document is loaded but not visible (in a tab)
          for (const doc of vscode.workspace.textDocuments) {
            if (doc.fileName === filePath) {
              // Document is in a tab but not visible, focus it and position cursor
              return vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: false,
                selection: range,
              });
            }
          }

          // File is not already open, open in a new tab and position cursor
          return vscode.workspace.openTextDocument(filePath).then(
            (doc) => {
              return vscode.window.showTextDocument(doc).then(
                (editor) => {
                  editor.selection = new vscode.Selection(position, position);
                  editor.revealRange(
                    range,
                    vscode.TextEditorRevealType.InCenter
                  );
                  return editor;
                },
                (error) => {
                  console.error(`Error showing document: ${error.message}`);
                  vscode.window.showErrorMessage(
                    `Error showing document: ${error.message}`
                  );
                }
              );
            },
            (error) => {
              console.error(`Error opening document: ${error.message}`);
              vscode.window.showErrorMessage(
                `Failed to open file: ${error.message}`
              );
            }
          );
        } catch (error) {
          console.error(
            `Error handling documentation reference: ${error.message}`,
            error
          );
          vscode.window.showErrorMessage(
            `Error opening documentation reference: ${error.message}`
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

          if (!fs.existsSync(infoFilePath)) {
            // Show error message with a delete button
            vscode.window
              .showErrorMessage(
                `No info file found for ${type} ${id}`,
                { modal: false },
                { title: "Delete Reference", isCloseAffordance: false }
              )
              .then((selection) => {
                if (selection && selection.title === "Delete Reference") {
                  // Get the active editor file path to find the reference file
                  const activeEditor = vscode.window.activeTextEditor;
                  if (!activeEditor) return;

                  // Create an item object with the necessary properties for deletion
                  const item = { type, id, indexFolder };

                  // Execute the delete command
                  vscode.commands.executeCommand(
                    "bc-al-upgradeassistant.deleteReferencedObject",
                    item
                  );
                }
              });
            return;
          }

          const infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));

          if (!infoData.originalPath || !fs.existsSync(infoData.originalPath)) {
            vscode.window.showErrorMessage(
              `Cannot find original file for ${type} ${id} at ${infoData.originalPath}`
            );
            return;
          }

          // Check if the file is already open in any visible editor
          for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.fileName === infoData.originalPath) {
              // File is already open, just focus its tab
              return vscode.window.showTextDocument(
                editor.document,
                editor.viewColumn
              );
            }
          }

          // Also check if document is loaded but not visible (in a tab)
          for (const doc of vscode.workspace.textDocuments) {
            if (doc.fileName === infoData.originalPath) {
              // Document is in a tab but not visible, move it beside and focus it
              return vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: false,
              });
            }
          }

          // File is not already open, open in a new tab beside and focus it
          vscode.workspace
            .openTextDocument(infoData.originalPath)
            .then((doc) => {
              return vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: false, // Focus the new tab
              });
            });
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
        if (!filePath) {
          console.error("openMigrationFile called with no filePath argument");
          vscode.window.showErrorMessage("No file path provided");
          return;
        }

        try {
          if (!fs.existsSync(filePath)) {
            vscode.window.showErrorMessage(`File not found: ${filePath}`);
            return;
          }

          // Check if the file is already open in any visible editor
          for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.fileName === filePath) {
              // File is already open, just focus its tab
              return vscode.window.showTextDocument(
                editor.document,
                editor.viewColumn
              );
            }
          }

          // Also check if document is loaded but not visible (in a tab)
          for (const doc of vscode.workspace.textDocuments) {
            if (doc.fileName === filePath) {
              // Document is in a tab but not visible, move it beside and focus it
              return vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: false,
              });
            }
          }

          // File is not already open, open in a new tab beside and focus it
          return vscode.workspace.openTextDocument(filePath).then(
            (doc) => {
              return vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: false, // Focus the new tab
              });
            },
            (error) => {
              console.error(`Error opening document: ${error.message}`);
              vscode.window.showErrorMessage(
                `Failed to open file: ${error.message}`
              );
            }
          );
        } catch (error) {
          console.error(
            `Error handling migration file: ${error.message}`,
            error
          );
          vscode.window.showErrorMessage(
            `Error opening migration file: ${error.message}`
          );
        }
      }
    )
  );

  // Register command to toggle Done status for all references with the same task ID
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.toggleTaskReferenceDone",
      (item) => {
        if (item && item.filePath && item.taskId) {
          fileReferenceProvider.toggleTaskReferenceDone(
            item.filePath,
            item.taskId
          );
        }
      }
    )
  );

  // Register command to toggle Not Implemented status for all references with the same task ID
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.toggleTaskReferenceNotImplemented",
      (item) => {
        if (item && item.filePath && item.taskId) {
          // Show input box for description when marking as not implemented
          vscode.window
            .showInputBox({
              prompt:
                "Enter a description for why these references are not implemented",
              placeHolder: "Optional description",
            })
            .then((description) => {
              if (description !== undefined) {
                // Check for cancel
                fileReferenceProvider.toggleTaskReferenceNotImplemented(
                  item.filePath,
                  item.taskId,
                  description
                );
              }
            });
        }
      }
    )
  );

  // Register command to set description for all references with the same task ID
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.setTaskReferenceDescription",
      (item) => {
        if (item && item.filePath && item.taskId) {
          vscode.window
            .showInputBox({
              prompt: "Enter a description for this task group",
              placeHolder: "Description",
            })
            .then((description) => {
              if (description !== undefined) {
                // Check for cancel
                fileReferenceProvider.setTaskReferenceDescription(
                  item.filePath,
                  item.taskId,
                  description
                );
              }
            });
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
