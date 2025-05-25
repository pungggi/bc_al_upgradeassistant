const vscode = require("vscode");
const { extractObjectsFromPath } = require("./utils/objectExtractor");
const path = require("path");
const claude = require("./claude");
const configManager = require("./utils/configManager");
const {
  initializeSymbolCache,
  initializeFieldCache,
} = require("./utils/cacheHelper");
const { registerCommandOnce } = require("./utils/commandHelper");
const { EXTENSION_ID } = require("./constants");
const { registerClipboardMonitor } = require("./clipboardMonitor");
const { suggestFieldNames } = require("./commands/fieldSuggestionCommand");
const {
  openLayoutFileExternally,
} = require("./commands/openLayoutFileExternally");

function registerOpenLayoutFileExternallyCommand(context) {
  registerCommandOnce(
    context,
    "bc-al-upgradeassistant.openLayoutFileExternally",
    openLayoutFileExternally
  );
}

function registerCommands(context, fileReferenceProvider) {
  registerOpenLayoutFileExternallyCommand(context);
  registerRefreshSymbolCacheCommand(context);
  registerRefreshFieldCacheCommand(context);
  registerSplitCalObjectsByPathCommand(context);
  registerPromptClaudeCommand(context);
  registerModelCommands(context);
  registerClipboardMonitor(context);

  // Field name suggestion command
  registerCommandOnce(
    context,
    "bc-al-upgradeassistant.suggestFieldNames",
    suggestFieldNames
  );

  // Command to copy generated Integration Event subscriber snippet
  registerCommandOnce(
    context,
    "al.copyIntegrationEventSubscriber",
    (snippet) => {
      if (snippet) {
        vscode.env.clipboard.writeText(snippet);
        vscode.window.showInformationMessage(
          "Event Subscriber snippet copied to clipboard."
        );
      } else {
        vscode.window.showWarningMessage("No snippet provided to copy.");
      }
    }
  );

  // Command to transform Codeunit 1 method calls
  registerCommandOnce(
    context,
    "bc-al-upgradeassistant.transformCodeunit1Method",
    async (args) => {
      if (!args || !args.document || !args.mapping) {
        vscode.window.showWarningMessage("Invalid transformation arguments.");
        return;
      }

      const { document, range, lineText, methodName, mapping } = args;
      const editor = vscode.window.activeTextEditor;

      if (!editor || editor.document !== document) {
        vscode.window.showWarningMessage("Document is not active in editor.");
        return;
      }

      // Generate the transformed call
      const paramMatch = lineText.match(new RegExp(`${methodName}\\s*\\(([^)]*)\\)`));
      const parameters = paramMatch ? paramMatch[1] : '';
      const newCall = `${mapping.newCodeunit}.${mapping.newMethod}(${parameters})`;

      // Replace the original method call with the new one
      const transformedLine = lineText.replace(
        new RegExp(`${methodName}\\s*\\([^)]*\\)`),
        newCall
      );

      // Apply the edit
      const edit = new vscode.WorkspaceEdit();
      const line = document.lineAt(range.start.line);
      edit.replace(document.uri, line.range, transformedLine);

      const success = await vscode.workspace.applyEdit(edit);
      if (success) {
        vscode.window.showInformationMessage(
          `Transformed ${methodName} to ${mapping.newCodeunit}.${mapping.newMethod}`
        );

        // Show info about variable declaration if needed
        const varDeclaration = `${mapping.newCodeunit}: Codeunit ${mapping.codeunitId};`;
        vscode.window.showInformationMessage(
          `Don't forget to add variable declaration: ${varDeclaration}`,
          "Copy Variable Declaration"
        ).then(selection => {
          if (selection === "Copy Variable Declaration") {
            vscode.env.clipboard.writeText(varDeclaration);
            vscode.window.showInformationMessage("Variable declaration copied to clipboard.");
          }
        });
      } else {
        vscode.window.showErrorMessage("Failed to apply transformation.");
      }
    }
  );

  // Command to copy Codeunit 1 transformation info
  registerCommandOnce(
    context,
    "bc-al-upgradeassistant.copyCodeunit1TransformationInfo",
    async (args) => {
      if (!args || !args.mapping) {
        vscode.window.showWarningMessage("Invalid transformation info.");
        return;
      }

      const { methodName, mapping, transformedCall } = args;
      const varDeclaration = `${mapping.newCodeunit}: Codeunit ${mapping.codeunitId};`;

      const info = `// Codeunit 1 Transformation\n` +
                  `// Original: ${methodName}()\n` +
                  `// New: ${transformedCall}\n` +
                  `// Variable needed: ${varDeclaration}\n` +
                  `// Codeunit: ${mapping.codeunitId} (${mapping.newCodeunit})`;

      await vscode.env.clipboard.writeText(info);
      vscode.window.showInformationMessage(
        `Transformation info for ${methodName} copied to clipboard.`
      );
    }
  );

  // Command to show info for Codeunit 1 methods without direct replacements
  registerCommandOnce(
    context,
    "bc-al-upgradeassistant.showCodeunit1Info",
    async (args) => {
      if (!args || !args.mapping) {
        vscode.window.showWarningMessage("Invalid method info.");
        return;
      }

      const { methodName, mapping } = args;

      // Show information message with options
      const options = ["Copy Info", "Open Documentation"];
      const selection = await vscode.window.showInformationMessage(
        `${methodName}: ${mapping.description}`,
        ...options
      );

      if (selection === "Copy Info") {
        const info = `// Codeunit 1 Method: ${methodName}\n` +
                    `// Status: ${mapping.description}\n` +
                    `// Note: This method has no direct replacement in Business Central.\n` +
                    `// Consider using events or alternative implementations.`;

        await vscode.env.clipboard.writeText(info);
        vscode.window.showInformationMessage(
          `Info for ${methodName} copied to clipboard.`
        );
      } else if (selection === "Open Documentation") {
        // Open Microsoft documentation
        vscode.env.openExternal(vscode.Uri.parse(
          "https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/upgrade/transitioning-from-codeunit1"
        ));
      }
    }
  );

  // Register filter commands
  if (fileReferenceProvider) {
    registerCommandOnce(
      context,
      "bc-al-upgradeassistant.filterDoneTasks",
      () => {
        fileReferenceProvider.setFilterMode('done');
      }
    );

    registerCommandOnce(
      context,
      "bc-al-upgradeassistant.filterNotDoneTasks",
      () => {
        fileReferenceProvider.setFilterMode('notDone');
      }
    );

    registerCommandOnce(
      context,
      "bc-al-upgradeassistant.clearTaskFilters",
      () => {
        fileReferenceProvider.setFilterMode('all');
      }
    );
  } else {
    console.error("FileReferenceProvider not available for registering filter commands.");
    const errorMessage = "Filter commands are unavailable as the File Reference Provider could not be initialized.";
    registerCommandOnce(context, "bc-al-upgradeassistant.filterDoneTasks", () => vscode.window.showErrorMessage(errorMessage));
    registerCommandOnce(context, "bc-al-upgradeassistant.filterNotDoneTasks", () => vscode.window.showErrorMessage(errorMessage));
    registerCommandOnce(context, "bc-al-upgradeassistant.clearTaskFilters", () => vscode.window.showErrorMessage(errorMessage));
  }
}

function registerRefreshSymbolCacheCommand(context) {
  registerCommandOnce(
    context,
    `${EXTENSION_ID}.refreshSymbolCache`,
    async () => {
      try {
        // Show progress notification
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Refreshing caches",
            cancellable: false,
          },
          async (progress) => {
            // First refresh symbol cache
            progress.report({ message: "Refreshing symbol cache..." });
            const processed = await initializeSymbolCache(true);

            // Then refresh field cache with force refresh enabled
            progress.report({ message: "Refreshing field cache..." });
            await initializeFieldCache(context, true);

            vscode.window.showInformationMessage(
              `Caches refreshed successfully. Processed ${processed} app files for symbols and updated field definitions from workspace and dependencies.`
            );
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error refreshing caches: ${error.message}`
        );
      }
    }
  );
}

function registerRefreshFieldCacheCommand(context) {
  registerCommandOnce(
    context,
    `${EXTENSION_ID}.refreshFieldCache`,
    async () => {
      try {
        // Show progress notification
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Refreshing field cache",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Scanning workspace folders..." });

            // Force refresh the field cache
            await initializeFieldCache(context, true);

            vscode.window.showInformationMessage(
              "Field cache refreshed successfully. All workspace tables and fields have been updated."
            );
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error refreshing field cache: ${error.message}`
        );
      }
    }
  );
}

function registerSplitCalObjectsByPathCommand(context) {
  registerCommandOnce(
    context,
    `${EXTENSION_ID}.splitCalObjectsByPath`,
    extractObjectsFromPath
  );
}

function registerPromptClaudeCommand(context) {
  registerCommandOnce(context, `${EXTENSION_ID}.runPrompt`, async () => {
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
        vscode.window.showErrorMessage("No code selected or document is empty");
        return;
      }

      // Show prompt selection dialog
      const selectedPrompt = await claude.showPromptSelectionDialog();
      if (!selectedPrompt) {
        return; // User cancelled
      }

      // Check if auto-save is enabled
      const autoSave = configManager.getConfigValue("autoSaveAlCode", false);

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

      // Calculate size in KB for display
      const codeSizeKB = (code.length / 1024).toFixed(2);

      // Show enhanced progress notification
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running ${selectedPrompt.commandName}`,
          cancellable: false,
        },
        async (progress) => {
          // Initialize progress tracking
          let processedChunks = 0;
          let totalChunks = 0;

          progress.report({
            message: `Preparing code (${codeSizeKB} KB)...`,
          });

          // Read the configured language model backend
          const backendSetting = vscode.workspace
            .getConfiguration("bc_al_upgradeassistant")
            .get("languageModelBackend", "Claude API");
          const backendName =
            backendSetting === "VS Code Language Model API"
              ? "VS Code LM API"
              : "Claude API";

          try {
            // Call Claude API with enhanced progress callback
            const response = await claude.executePrompt(
              selectedPrompt,
              code,
              (progressData) => {
                if (progressData.chunksTotal && progressData.chunksTotal > 0) {
                  totalChunks = progressData.chunksTotal;
                  processedChunks = progressData.chunksProcessed || 0;

                  const percent = Math.round(
                    (processedChunks / totalChunks) * 100
                  );
                  progress.report({
                    message: `Processing with ${backendName}: ${processedChunks}/${totalChunks} chunks (${percent}%) of ${codeSizeKB} KB`,
                    increment: progressData.increment,
                  });
                } else {
                  progress.report(progressData);
                }
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
                  response,
                  editor.document.uri.fsPath
                );

                if (savedFiles.length > 0) {
                  // Only show UI for opening files, no additional completion notification
                  if (savedFiles.length === 1) {
                    const openFile = await vscode.window.showInformationMessage(
                      `File saved to: ${savedFiles[0]}`,
                      "Open File"
                    );

                    if (openFile === "Open File") {
                      const savedDoc = await vscode.workspace.openTextDocument(
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
                `${backendName} error: ${error.message}`
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
                `${backendName} error: ${error.message}`
              );
            }
          }
        }
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Error running Claude: ${error.message}`);
    }
  });
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

  // Command to set default Claude model
  registerCommandOnce(
    context,
    `${EXTENSION_ID}.setDefaultClaudeModel`,
    async () => {
      const selectedModel = await modelHelper.selectModel();
      if (selectedModel) {
        await configManager.setConfigValue("claude.model", selectedModel.id);
        vscode.window.showInformationMessage(
          `Default Claude model set to ${selectedModel.name}`
        );
      }
    }
  );
}

module.exports = {
  registerCommands,
};
