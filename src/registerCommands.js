const vscode = require("vscode");
const { extractObjectsWithDialog } = require("./utils/objectExtractor");
const path = require("path");
const claude = require("./claude");
const configManager = require("./utils/configManager");
const { registerCommandOnce } = require("./utils/commandHelper");
const { EXTENSION_ID } = require("./constants");

function registerCommands(context) {
  registerRefreshSymbolCacheCommand(context);
  registerSplitCalObjectsCommand(context);
  registerPromptClaudeCommand(context);
  registerModelCommands(context);
}

function registerRefreshSymbolCacheCommand(context) {
  registerCommandOnce(
    context,
    `${EXTENSION_ID}.refreshSymbolCache`,
    async () => {
      try {
        const extension = require("./extension");
        const processed = await extension.initializeSymbolCache(context, true);
        vscode.window.showInformationMessage(
          `Symbol cache refreshed successfully. Processed ${processed} app files for symbols.`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error refreshing symbol cache: ${error.message}`
        );
      }
    }
  );
}

function registerSplitCalObjectsCommand(context) {
  registerCommandOnce(
    context,
    `${EXTENSION_ID}.splitCalObjects`,
    extractObjectsWithDialog
  );
}

function registerPromptClaudeCommand(context) {
  registerCommandOnce(
    context,
    `${EXTENSION_ID}.selectClaudePrompt`,
    async () => {
      try {
        // Get the active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("No active editor found");
          return;
        }

        // Get selected text or full document
        const selection = editor.selection;
        const code = selection.isEmpty
          ? editor.document.getText()
          : editor.document.getText(selection);

        if (!code || code.trim().length === 0) {
          vscode.window.showErrorMessage(
            "No code selected or document is empty"
          );
          return;
        }

        // Show prompt selection dialog
        const selectedPrompt = await claude.showPromptSelectionDialog();
        if (!selectedPrompt) {
          return; // User cancelled
        }

        // Check if auto-save is enabled
        const autoSave = configManager.getConfigValue(
          "claude.autoSaveAlCode",
          false
        );

        // If auto-save is enabled, don't create an editor for the response
        let document = null;

        if (!autoSave) {
          // Create and show a new editor for the response
          document = await vscode.workspace.openTextDocument({
            content: `# ${selectedPrompt.commandName}\n\nProcessing your request...\n\nCode length: ${code.length} characters`,
            language: "markdown",
          });

          await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.Beside,
          });
        }

        // Show progress notification
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Running ${selectedPrompt.commandName}`,
            cancellable: false,
          },
          async (progress) => {
            try {
              // Call Claude API
              const response = await claude.executePrompt(
                selectedPrompt,
                code,
                (progressData) => {
                  progress.report(progressData);
                }
              );

              // Update the response document with the result if we created one
              if (!autoSave && document) {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                  document.uri,
                  new vscode.Range(0, 0, document.lineCount, 0),
                  `# ${selectedPrompt.commandName}\n\n${response}`
                );

                await vscode.workspace.applyEdit(edit);
              }

              // Handle auto-saving AL code blocks
              if (autoSave) {
                try {
                  const savedFiles = await claude.extractAndSaveAlCodeBlocks(
                    response
                  );

                  if (savedFiles.length > 0) {
                    // Only show UI for opening files, no additional completion notification
                    if (savedFiles.length === 1) {
                      const openFile =
                        await vscode.window.showInformationMessage(
                          `File saved to: ${savedFiles[0]}`,
                          "Open File"
                        );

                      if (openFile === "Open File") {
                        const savedDoc =
                          await vscode.workspace.openTextDocument(
                            savedFiles[0]
                          );
                        await vscode.window.showTextDocument(savedDoc);
                      }
                    } else {
                      const openFiles =
                        await vscode.window.showInformationMessage(
                          `${savedFiles.length} files saved successfully`,
                          "View Files"
                        );

                      if (openFiles === "View Files") {
                        // Let user select which file to open
                        const fileItems = savedFiles.map((file) => ({
                          label: path.basename(file),
                          description: file,
                          filePath: file,
                        }));

                        const selectedFile = await vscode.window.showQuickPick(
                          fileItems,
                          {
                            placeHolder: "Select file to open",
                            canPickMany: false,
                          }
                        );

                        if (selectedFile) {
                          const savedDoc =
                            await vscode.workspace.openTextDocument(
                              selectedFile.filePath
                            );
                          await vscode.window.showTextDocument(savedDoc);
                        }
                      }
                    }
                  } else {
                    // If auto-save is enabled but no AL code blocks were found, show the response in an editor
                    document = await vscode.workspace.openTextDocument({
                      content: `# ${selectedPrompt.commandName}\n\nNo AL code blocks were found in the response.\n\n${response}`,
                      language: "markdown",
                    });

                    await vscode.window.showTextDocument(document, {
                      viewColumn: vscode.ViewColumn.Beside,
                    });
                  }
                } catch (saveError) {
                  // If auto-save fails, show the response in an editor
                  document = await vscode.workspace.openTextDocument({
                    content: `# ${selectedPrompt.commandName}\n\nError auto-saving AL code: ${saveError.message}\n\n${response}`,
                    language: "markdown",
                  });

                  await vscode.window.showTextDocument(document, {
                    viewColumn: vscode.ViewColumn.Beside,
                  });

                  vscode.window.showErrorMessage(
                    `Error auto-saving AL code: ${saveError.message}`
                  );
                }
              }
            } catch (error) {
              // Handle API error
              if (autoSave) {
                // Just show error message if auto-save is enabled
                vscode.window.showErrorMessage(
                  `Claude API error: ${error.message}`
                );
              } else if (document) {
                // Update the response document with the error
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                  document.uri,
                  new vscode.Range(0, 0, document.lineCount, 0),
                  `# Error: ${selectedPrompt.commandName}\n\n${error.message}`
                );

                await vscode.workspace.applyEdit(edit);
                vscode.window.showErrorMessage(
                  `Claude API error: ${error.message}`
                );
              }
            }
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error running Claude: ${error.message}`
        );
      }
    }
  );
}

/**
 * Register model-related commands
 * @param {vscode.ExtensionContext} context - Extension context
 */
function registerModelCommands(context) {
  const modelHelper = require("./modelHelper");

  // Command to select model
  registerCommandOnce(context, `${EXTENSION_ID}.selectModel`, async () => {
    const selectedModel = await modelHelper.selectModel();
    if (selectedModel) {
      vscode.window.showInformationMessage(
        `Model set to ${selectedModel.name}`
      );
    }
  });
}

module.exports = {
  registerCommands,
};
