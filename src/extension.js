const vscode = require("vscode");
const { registerCommands } = require("./registerCommands");
const { registerfileEvents } = require("./events/registerFileEvents");
const {
  syncWorkspaceToExtractionPath,
} = require("./events/registerFileEvents");
const modelHelper = require("./modelHelper");
const path = require("path");
const fs = require("fs");
const { readJsonFile } = require("./jsonUtils");
const {
  initializeSymbolCache,
  initializeFieldCache,
} = require("./utils/cacheHelper"); // Import from new location

const { EXTENSION_ID } = require("./constants");
const { registerViews } = require("./views/registerViews");
const {
  FieldSuggestionActionProvider,
} = require("./providers/fieldSuggestionProvider");
const {
  RecordTriggerActionProvider,
} = require("./providers/recordTriggerActionProvider");
const {
  IntegrationEventActionProvider,
} = require("./providers/integrationEventActionProvider");
const {
  ObjectSuggestionActionProvider,
} = require("./providers/objectSuggestionProvider");
const {
  LayoutPropertiesActionProvider,
} = require("./providers/layoutPropertiesActionProvider");
const { logger } = require("./utils/logger");
const ALObjectHoverProvider = require("./hover/alObjectHoverProvider");

let globalStatusBarItems = {};

// Add an event emitter for file decorations
const fileDecorationEventEmitter = new vscode.EventEmitter();

/**
 * Extension activation handler
 * @param {vscode.ExtensionContext} context - Extension context
 */
async function activate(context) {
  // Initialize the logger
  logger.initialize();

  logger.info(`Activating ${EXTENSION_ID} extension`);

  try {
    // First, register file events which will create the index folder
    logger.info("Registering events...");
    registerfileEvents(context);

    // Then proceed with other registrations
    logger.info("Registering views...");
    const { fileReferenceProvider } = registerViews(context);

    logger.info("Registering commands...");
    registerCommands(context, fileReferenceProvider);

    // Initialize symbol cache
    // Initialize symbol cache (this likely sets up the worker)
    await initializeSymbolCache(context); // Pass context if needed by worker setup

    // Initialize field cache (loads persisted, triggers worker update)
    await initializeFieldCache(context);

    // Set up watchers for symbol downloads
    setupSymbolsWatchers(context);

    // Perform initial sync of workspace AL files to extraction path
    // Run this after event registration and cache initialization
    await syncWorkspaceToExtractionPath();

    // Register command to generate documentation reference summary
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.generateDocumentationSummary",
        async () => await generateDocumentationSummary(fileReferenceProvider)
      )
    );

    modelHelper.initializeModels();

    // Register the AL Object Hover provider for AL files
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        { scheme: "file", language: "al" },
        new ALObjectHoverProvider()
      )
    );
    logger.info(
      "[Extension Activation] ALObjectHoverProvider registered successfully"
    );

    // Register the Object Suggestion provider for AL files
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        { scheme: "file", language: "al" },
        new ObjectSuggestionActionProvider(),
        {
          providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
        }
      )
    );

    // Register command to toggle documentation reference 'not implemented' status
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.toggleDocumentationReferenceNotImplemented",
        async (item) => {
          // Handle direct item click
          if (
            item &&
            item.filePath &&
            item.docId &&
            item.lineNumber !== undefined
          ) {
            // Check the current state
            const refs = fileReferenceProvider._findDocumentationReferences(
              fs.readFileSync(item.filePath, "utf8"),
              item.filePath
            );

            const docRef = refs.find(
              (ref) =>
                ref.id === item.docId && ref.lineNumber === item.lineNumber
            );

            // If not currently marked as not implemented, ask for a description
            let userDescription;
            if (docRef && !docRef.notImplemented) {
              userDescription = await vscode.window.showInputBox({
                prompt: `Enter a reason why it cannot be implemented`,
                placeHolder: "Reason for not implementing",
                value: docRef.userDescription || "",
              });

              // User cancelled
              if (userDescription === undefined) {
                return;
              }
            }

            fileReferenceProvider.toggleDocumentationReferenceNotImplemented(
              item.filePath,
              item.docId,
              item.lineNumber,
              userDescription
            );

            // Update all tabs showing this file
            updateAllTabsForFile(item.filePath, fileReferenceProvider);

            return;
          }

          // Handle editor context menu
          const editor = vscode.window.activeTextEditor;
          if (!editor) return;

          const position = editor.selection.active;
          const docRef = findDocRefAtLine(
            fileReferenceProvider,
            editor.document,
            position.line
          );
          if (!docRef) return;

          // If not currently marked as not implemented, ask for a description
          let userDescription;
          if (!docRef.notImplemented) {
            userDescription = await vscode.window.showInputBox({
              prompt: `Enter a reason why it cannot be implemented`,
              placeHolder: "Reason for not implementing",
              value: docRef.userDescription || "",
            });

            // User cancelled
            if (userDescription === undefined) {
              return;
            }
          }

          fileReferenceProvider.toggleDocumentationReferenceNotImplemented(
            editor.document.uri.fsPath,
            docRef.id,
            docRef.lineNumber,
            userDescription
          );
        }
      )
    );

    // Register command to set description for documentation reference
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.setDocumentationReferenceDescription",
        async (item) => {
          // Handle direct item click
          if (
            item &&
            item.filePath &&
            item.docId &&
            item.lineNumber !== undefined
          ) {
            const currentDescription = item.docRef?.userDescription || "";
            const description = await promptForDescription(
              item.docId,
              currentDescription
            );
            if (description === undefined) return;

            return updateDescription(
              fileReferenceProvider,
              item.filePath,
              item.docId,
              item.lineNumber,
              description
            );
          }

          // Handle editor context menu
          const editor = vscode.window.activeTextEditor;
          if (!editor) return;

          const position = editor.selection.active;
          const docRef = findDocRefAtLine(
            fileReferenceProvider,
            editor.document,
            position.line
          );
          if (!docRef) return;

          const currentDescription = docRef.userDescription || "";
          const description = await promptForDescription(
            docRef.id,
            currentDescription
          );
          if (description === undefined) return;

          updateDescription(
            fileReferenceProvider,
            editor.document.uri.fsPath,
            docRef.id,
            docRef.lineNumber,
            description
          );
        }
      )
    );

    // Watch for changes to settings.json files in workspace folders
    if (vscode.workspace.workspaceFolders) {
      vscode.workspace.workspaceFolders.forEach((folder) => {
        const settingsWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, ".vscode/settings.json")
        );

        // When settings.json changes, refresh file reference view
        settingsWatcher.onDidChange(() => {
          vscode.commands.executeCommand(
            "bc-al-upgradeassistant.refreshReferenceView"
          );
        });

        context.subscriptions.push(settingsWatcher);
      });
    }

    // Add context menu handler for documentation references - replace the existing CodeLens provider
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === "plaintext") {
          setTimeout(() => {
            checkDocumentationReferences(document, fileReferenceProvider);
          }, 100);
        }
      })
    );

    // Check any already open documents too
    if (
      vscode.window.activeTextEditor &&
      vscode.window.activeTextEditor.document.languageId === "plaintext"
    ) {
      setTimeout(() => {
        checkDocumentationReferences(
          vscode.window.activeTextEditor.document,
          fileReferenceProvider
        );
      }, 100);
    }

    // Listen for editor changes
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        // Clear any status bar items for files that are no longer active
        cleanupStatusBarItems();

        if (!editor) {
          vscode.commands.executeCommand(
            "setContext",
            "editorHasDocumentationRef",
            false
          );
          return;
        }

        if (editor.document.languageId === "plaintext") {
          checkDocumentationReferences(editor.document, fileReferenceProvider);
        } else {
          vscode.commands.executeCommand(
            "setContext",
            "editorHasDocumentationRef",
            false
          );
        }
      })
    );

    // Listen for document changes to update references
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "plaintext") {
          checkDocumentationReferences(e.document, fileReferenceProvider);
        }
      })
    );

    // Update command handlers to support editor context
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.toggleDocumentationReferenceDone",
        (item) => {
          // Handle direct item click
          if (
            item &&
            item.filePath &&
            item.docId &&
            item.lineNumber !== undefined
          ) {
            return toggleDocRefDone(fileReferenceProvider, item);
          }

          // Handle editor context menu
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            const position = editor.selection.active;
            const docRef = findDocRefAtLine(
              fileReferenceProvider,
              editor.document,
              position.line
            );
            if (docRef) {
              return toggleDocRefDone(fileReferenceProvider, {
                filePath: editor.document.uri.fsPath,
                docId: docRef.id,
                lineNumber: docRef.lineNumber,
              });
            }
          }
        }
      )
    );

    // Register command to check documentation references and update tab icon
    let disposable = vscode.commands.registerCommand(
      "bc-al-upgradeassistant.checkDocumentation",
      function () {
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (!activeTab) {
          vscode.window.showInformationMessage("No active tab found.");
          return;
        }

        // Check if all documentation references are set to done or not implemented
        const allReferencesDone = checkDocumentationReferences(
          activeTab.input.uri,
          fileReferenceProvider
        );
        if (allReferencesDone) {
          updateTabIcon(activeTab, "done-icon");
        } else {
          updateTabIcon(activeTab, "default-icon");
        }
      }
    );

    context.subscriptions.push(disposable);

    // Check documentation status when a document is opened or changed
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        updateDocumentationStatusIcon(document, fileReferenceProvider);
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        updateDocumentationStatusIcon(e.document, fileReferenceProvider);
      })
    );

    // Add a new function to check documentation references and update tab icon
    function updateDocumentationStatusIcon(document, provider) {
      if (!document || document.languageId !== "plaintext") return;

      const activeTab = vscode.window.tabGroups.activeTabGroup.tabs.find(
        (tab) => tab.input.uri?.fsPath === document.uri.fsPath
      );

      if (!activeTab) return;

      // Clear any existing decorations
      if (activeTab._iconDecorations) {
        activeTab._iconDecorations.forEach((d) => d.dispose());
        activeTab._iconDecorations = [];
      }

      // Check if all documentation references are set to done or not implemented
      const allReferencesDone = checkDocumentationReferences(
        document,
        provider
      );

      if (allReferencesDone) {
        updateTabIcon(activeTab, "done-icon");
      } else {
        updateTabIcon(activeTab, "default-icon");
      }
    }

    // Register a file decoration provider to show documentation status in file explorer
    const fileDecorationProvider = {
      onDidChangeFileDecorations: fileDecorationEventEmitter.event,
      provideFileDecoration: (uri) => {
        // Skip if not a plaintext file
        if (path.extname(uri.fsPath) !== ".txt") return null;

        // Check if file has documentation references and if they are all done
        try {
          const content = fs.readFileSync(uri.fsPath, "utf8");
          const refs = fileReferenceProvider._findDocumentationReferences(
            content,
            uri.fsPath
          );

          if (refs.length === 0) return null;

          const allDone = refs.every((ref) => ref.done || ref.notImplemented);

          if (allDone) {
            return {
              badge: "✓",
              tooltip: "All documentation references completed",
              color: new vscode.ThemeColor("charts.green"),
            };
          } else {
            return {
              badge: "⏳",
              tooltip: "Documentation references in progress",
              color: new vscode.ThemeColor("charts.blue"),
            };
          }
        } catch (error) {
          logger.error("Error providing file decoration:", error);
          return null;
        }
      },
    };

    context.subscriptions.push(
      vscode.window.registerFileDecorationProvider(fileDecorationProvider)
    );

    // Then update your updateTabIcon function to be simpler:
    function updateTabIcon(tab, iconType) {
      if (!tab || !tab.input.uri?.fsPath) return;

      const filePath = tab.input.uri.fsPath;

      // Dispose existing status bar item for this file if it exists
      if (globalStatusBarItems[filePath]) {
        globalStatusBarItems[filePath].dispose();
      }

      const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
      );

      if (iconType === "done-icon") {
        statusBarItem.text = "$(check) Docs Complete";
        statusBarItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground"
        );
        statusBarItem.color = new vscode.ThemeColor(
          "statusBarItem.warningForeground"
        );
        statusBarItem.tooltip = "All documentation references are completed";
      } else {
        statusBarItem.text = "$(warning) Docs In Progress";
        statusBarItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.errorBackground"
        );
        statusBarItem.color = new vscode.ThemeColor(
          "statusBarItem.errorForeground"
        );
        statusBarItem.tooltip =
          "Documentation references are still in progress";
      }

      // Command to jump to next incomplete reference (you can implement this separately)
      statusBarItem.command = "bc-al-upgradeassistant.jumpToNextIncompleteRef";

      // Show the status bar item
      statusBarItem.show();

      // Store in our global tracker instead of on the tab
      globalStatusBarItems[filePath] = statusBarItem;
    }

    // Register command to delete a referenced object
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.deleteReferencedObject",
        async (item) => {
          if (!item || !item.type || !item.id || !item.indexFolder) {
            return;
          }

          try {
            const result = await deleteReferencedObject(
              item,
              fileReferenceProvider
            );
            if (result) {
              // Refresh the view
              fileReferenceProvider.refresh();
            } else {
              vscode.window.showErrorMessage(
                `Failed to delete reference to ${item.type} ${item.id}`
              );
            }
          } catch (error) {
            console.error("Error deleting referenced object:", error);
            vscode.window.showErrorMessage(`Error: ${error.message}`);
          }
        }
      )
    );

    // Register command to add a reference
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.addReference",
        async (objectsGroup) => {
          if (!objectsGroup) return;

          // Get active text editor's file path
          const activeEditor = vscode.window.activeTextEditor;
          if (!activeEditor) {
            vscode.window.showErrorMessage("No active file open");
            return;
          }

          const filePath = activeEditor.document.uri.fsPath;
          if (!filePath) return;

          // Get all AL files in workspace
          const alFiles = await findAlFiles();
          if (!alFiles || alFiles.length === 0) {
            vscode.window.showInformationMessage(
              "No AL files found in the workspace"
            );
            return;
          }

          // Extract object info from AL files
          const objects = [];
          for (const file of alFiles) {
            try {
              const objectInfo = extractAlObjectInfo(file.fsPath);
              if (objectInfo) {
                objects.push({
                  label: `${objectInfo.type} ${objectInfo.id}: ${objectInfo.name}`,
                  // Remove file path from display to make it less verbose
                  objectInfo,
                });
              }
            } catch (err) {
              console.error(`Error processing AL file ${file.fsPath}:`, err);
            }
          }

          if (objects.length === 0) {
            vscode.window.showInformationMessage(
              "No AL objects found in the workspace"
            );
            return;
          }

          // Let user pick an object
          const selected = await vscode.window.showQuickPick(objects, {
            placeHolder: "Select an object to add as reference",
          });

          if (!selected) return;

          // Add reference to the JSON file
          try {
            const result = await addReferenceToFile(
              filePath,
              selected.objectInfo,
              fileReferenceProvider
            );

            if (result) {
              fileReferenceProvider.refresh();
            } else {
              vscode.window.showErrorMessage(
                `Failed to add reference to ${selected.objectInfo.type} ${selected.objectInfo.id}`
              );
            }
          } catch (error) {
            console.error("Error adding reference:", error);
            vscode.window.showErrorMessage(`Error: ${error.message}`);
          }
        }
      )
    );

    // Add a subscription to detect when files are saved
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.languageId === "plaintext") {
          // When a document is saved, recheck its documentation status
          updateAllTabsForFile(document.uri.fsPath, fileReferenceProvider);
        }
      })
    );

    // Implement a refresh command
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.refreshDocumentationStatus",
        () => {
          // Update all open tabs
          vscode.window.tabGroups.all.forEach((group) => {
            group.tabs.forEach((tab) => {
              if (tab.input.uri) {
                updateAllTabsForFile(
                  tab.input.uri.fsPath,
                  fileReferenceProvider
                );
              }
            });
          });

          // Force refresh file explorer
          vscode.commands.executeCommand(
            "workbench.files.action.refreshFilesExplorer"
          );
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.toggleProcedureReferencesDone",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            const success = fileReferenceProvider.toggleProcedureReferencesDone(
              item.filePath,
              item.startLine,
              item.endLine
            );

            if (success) {
              const targetState = true; // We don't know the exact state but it was toggled
              vscode.window.showInformationMessage(
                `All references in procedure ${
                  targetState ? "marked as done" : "marked as not done"
                }`
              );
            } else {
              vscode.window.showInformationMessage(
                "No documentation references found in procedure"
              );
            }
          }
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.toggleProcedureReferencesNotImplemented",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            // Determine if this toggle would set references to "not implemented"
            const fileContent = fs.readFileSync(item.filePath, "utf8");
            const docRefs = fileReferenceProvider._findDocumentationReferences(
              fileContent,
              item.filePath
            );

            // Filter to the procedure's range
            const refsInProcedure = docRefs.filter(
              (ref) =>
                ref.lineNumber >= item.startLine &&
                ref.lineNumber <= item.endLine
            );

            if (refsInProcedure.length === 0) {
              vscode.window.showInformationMessage(
                "No documentation references found in procedure"
              );
              return;
            }

            // Check current state - would we be toggling TO not implemented?
            const notImplCount = refsInProcedure.filter(
              (ref) => ref.notImplemented
            ).length;
            const togglingToNotImplemented =
              notImplCount <= refsInProcedure.length / 2;

            // Only prompt for reason if toggling TO not implemented
            let userDescription;
            if (togglingToNotImplemented) {
              userDescription = await vscode.window.showInputBox({
                prompt:
                  "Enter reason why these references cannot be implemented",
                placeHolder: "Reason for not implementing",
                value: "",
              });

              // User cancelled
              if (userDescription === undefined) {
                return;
              }
            }

            const success =
              fileReferenceProvider.toggleProcedureReferencesNotImplemented(
                item.filePath,
                item.startLine,
                item.endLine,
                userDescription
              );

            if (success) {
              vscode.window.showInformationMessage(
                "All references in procedure updated"
              );
            } else {
              vscode.window.showInformationMessage(
                "No documentation references found in procedure"
              );
            }
          }
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.setProcedureReferencesDescription",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            // Prompt for description
            const description = await vscode.window.showInputBox({
              prompt: "Enter note to apply to all references in this procedure",
              placeHolder: "Note text",
              value: "",
            });

            if (description === undefined) {
              return; // User cancelled
            }

            const success =
              fileReferenceProvider.setProcedureReferencesDescription(
                item.filePath,
                item.startLine,
                item.endLine,
                description
              );

            if (success) {
              vscode.window.showInformationMessage(
                "Note added to all references in procedure"
              );
            } else {
              vscode.window.showInformationMessage(
                "No documentation references found in procedure"
              );
            }
          }
        }
      )
    );

    // Register commands for Triggers
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.toggleTriggerReferencesDone",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            const success = fileReferenceProvider.toggleTriggerReferencesDone(
              item.filePath,
              item.startLine,
              item.endLine
            );

            if (success) {
              vscode.window.showInformationMessage(
                "All references in trigger updated"
              );
            } else {
              vscode.window.showInformationMessage(
                "No documentation references found in trigger"
              );
            }
          }
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.toggleTriggerReferencesNotImplemented",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            // Determine if this toggle would set references to "not implemented"
            const fileContent = fs.readFileSync(item.filePath, "utf8");
            const docRefs = fileReferenceProvider._findDocumentationReferences(
              fileContent,
              item.filePath
            );

            // Filter to the trigger's range
            const refsInTrigger = docRefs.filter(
              (ref) =>
                ref.lineNumber >= item.startLine &&
                ref.lineNumber <= item.endLine
            );

            if (refsInTrigger.length === 0) {
              vscode.window.showInformationMessage(
                "No documentation references found in trigger"
              );
              return;
            }

            // Check current state - would we be toggling TO not implemented?
            const notImplCount = refsInTrigger.filter(
              (ref) => ref.notImplemented
            ).length;
            const togglingToNotImplemented =
              notImplCount <= refsInTrigger.length / 2;

            // Only prompt for reason if toggling TO not implemented
            let userDescription;
            if (togglingToNotImplemented) {
              userDescription = await vscode.window.showInputBox({
                prompt:
                  "Enter reason why these references cannot be implemented",
                placeHolder: "Reason for not implementing",
                value: "",
              });

              // User cancelled
              if (userDescription === undefined) {
                return;
              }
            }

            const success =
              fileReferenceProvider.toggleTriggerReferencesNotImplemented(
                item.filePath,
                item.startLine,
                item.endLine,
                userDescription
              );

            if (success) {
              vscode.window.showInformationMessage(
                "All references in trigger updated"
              );
            } else {
              vscode.window.showInformationMessage(
                "No documentation references found in trigger"
              );
            }
          }
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.setTriggerReferencesDescription",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            // Prompt for description
            const description = await vscode.window.showInputBox({
              prompt: "Enter note to apply to all references in this trigger",
              placeHolder: "Note text",
              value: "",
            });

            if (description === undefined) {
              return; // User cancelled
            }

            const success =
              fileReferenceProvider.setTriggerReferencesDescription(
                item.filePath,
                item.startLine,
                item.endLine,
                description
              );

            if (success) {
              vscode.window.showInformationMessage(
                "Note added to all references in trigger"
              );
            } else {
              vscode.window.showInformationMessage(
                "No documentation references found in trigger"
              );
            }
          }
        }
      )
    );

    // Register commands for Actions
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.toggleActionReferencesDone",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            const success = fileReferenceProvider.toggleActionReferencesDone(
              item.filePath,
              item.startLine,
              item.endLine
            );

            if (success) {
              vscode.window.showInformationMessage(
                "All references in action updated"
              );
            } else {
              vscode.window.showInformationMessage(
                "No documentation references found in action"
              );
            }
          }
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.toggleActionReferencesNotImplemented",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            // Determine if this toggle would set references to "not implemented"
            const fileContent = fs.readFileSync(item.filePath, "utf8");
            const docRefs = fileReferenceProvider._findDocumentationReferences(
              fileContent,
              item.filePath
            );

            // Filter to the action's range
            const refsInAction = docRefs.filter(
              (ref) =>
                ref.lineNumber >= item.startLine &&
                ref.lineNumber <= item.endLine
            );

            if (refsInAction.length === 0) {
              vscode.window.showInformationMessage(
                "No documentation references found in action"
              );
              return;
            }

            // Check current state - would we be toggling TO not implemented?
            const notImplCount = refsInAction.filter(
              (ref) => ref.notImplemented
            ).length;
            const togglingToNotImplemented =
              notImplCount <= refsInAction.length / 2;

            // Only prompt for reason if toggling TO not implemented
            let userDescription;
            if (togglingToNotImplemented) {
              userDescription = await vscode.window.showInputBox({
                prompt:
                  "Enter reason why these references cannot be implemented",
                placeHolder: "Reason for not implementing",
                value: "",
              });

              // User cancelled
              if (userDescription === undefined) {
                return;
              }
            }

            const success =
              fileReferenceProvider.toggleActionReferencesNotImplemented(
                item.filePath,
                item.startLine,
                item.endLine,
                userDescription
              );

            if (success) {
              vscode.window.showInformationMessage(
                "All references in action updated"
              );
            } else {
              vscode.window.showInformationMessage(
                "No documentation references found in action"
              );
            }
          }
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.setActionReferencesDescription",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            // Prompt for description
            const description = await vscode.window.showInputBox({
              prompt: "Enter note to apply to all references in this action",
              placeHolder: "Note text",
              value: "",
            });

            if (description === undefined) {
              return; // User cancelled
            }

            const success =
              fileReferenceProvider.setActionReferencesDescription(
                item.filePath,
                item.startLine,
                item.endLine,
                description
              );

            if (success) {
              vscode.window.showInformationMessage(
                "Note added to all references in action"
              );
            } else {
              vscode.window.showInformationMessage(
                "No documentation references found in action"
              );
            }
          }
        }
      )
    );

    // Register commands for Fields
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.toggleFieldReferencesDone",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            fileReferenceProvider.toggleFieldReferencesDone(
              item.filePath,
              item.startLine,
              item.endLine
            );
          }
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.toggleFieldReferencesNotImplemented",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            // Determine if this toggle would set references to "not implemented"
            const fileContent = fs.readFileSync(item.filePath, "utf8");
            const docRefs = fileReferenceProvider._findDocumentationReferences(
              fileContent,
              item.filePath
            );

            // Filter to the field's range
            const refsInField = docRefs.filter(
              (ref) =>
                ref.lineNumber >= item.startLine &&
                ref.lineNumber <= item.endLine
            );

            if (refsInField.length === 0) {
              vscode.window.showInformationMessage(
                "No documentation references found in field"
              );
              return;
            }

            // Check current state - would we be toggling TO not implemented?
            const notImplCount = refsInField.filter(
              (ref) => ref.notImplemented
            ).length;
            const togglingToNotImplemented =
              notImplCount <= refsInField.length / 2;

            // Only prompt for reason if toggling TO not implemented
            let userDescription;
            if (togglingToNotImplemented) {
              userDescription = await vscode.window.showInputBox({
                prompt:
                  "Enter reason why these references cannot be implemented",
                placeHolder: "Reason for not implementing",
                value: "",
              });

              // User cancelled
              if (userDescription === undefined) {
                return;
              }
            }

            fileReferenceProvider.toggleFieldReferencesNotImplemented(
              item.filePath,
              item.startLine,
              item.endLine,
              userDescription
            );
          }
        }
      )
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.setFieldReferencesDescription",
        async (item) => {
          if (item && item.filePath && item.startLine && item.endLine) {
            // Prompt for description
            const description = await vscode.window.showInputBox({
              prompt: "Enter note to apply to all references in this field",
              placeHolder: "Note text",
              value: "",
            });

            if (description === undefined) {
              return; // User cancelled
            }

            const success = fileReferenceProvider.setFieldReferencesDescription(
              item.filePath,
              item.startLine,
              item.endLine,
              description
            );

            if (success) {
              vscode.window.showInformationMessage(
                "Note added to all references in field"
              );
            } else {
              vscode.window.showInformationMessage(
                "No documentation references found in field"
              );
            }
          }
        }
      )
    );

    // Register command to copy trigger info to clipboard
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.copyTriggerInfo",
        async (text) => {
          await vscode.env.clipboard.writeText(text);
          vscode.window.setStatusBarMessage(`Copied: ${text}`, 2400);
        }
      )
    );

    // Register record trigger action provider
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        { scheme: "file", language: "al" },
        new RecordTriggerActionProvider(),
        {
          providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
        }
      )
    );

    // Register integration event action provider
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        { scheme: "file", language: "al" },
        new IntegrationEventActionProvider(),
        {
          providedCodeActionKinds: [vscode.CodeActionKind.RefactorExtract], // Use RefactorExtract as planned
        }
      )
    );

    // Register field suggestion provider
    const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
    if (config.get("fieldSuggestion.enabled", true)) {
      context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
          { scheme: "file", language: "al" },
          new FieldSuggestionActionProvider(),
          {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
          }
        )
      );

      // Field cache initialization is now handled by initializeFieldCache called earlier
    }

    // Register layout properties transformation provider
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        { scheme: "file", language: "al" },
        new LayoutPropertiesActionProvider(),
        {
          providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite],
        }
      )
    );

    logger.info(`${EXTENSION_ID} extension activated successfully`);
  } catch (error) {
    logger.error("Error during extension activation:", error);
    vscode.window.showErrorMessage(
      `Error activating extension: ${error.message}`
    );
  }
}

/**
 * Set up watchers for downloaded symbols files
 * @param {vscode.ExtensionContext} context Extension context
 */
function setupSymbolsWatchers(context) {
  if (!vscode.workspace.workspaceFolders) return;

  // We can't directly listen for command execution
  // Instead, we'll watch for file changes in the .alpackages directories

  // Create file system watchers for each workspace folder
  for (const folder of vscode.workspace.workspaceFolders) {
    // Try to find the appropriate symbols folder
    let packagePath = null;

    // Check for al.packageCachePath in settings
    try {
      const settingsPath = path.join(
        folder.uri.fsPath,
        ".vscode",
        "settings.json"
      );
      if (fs.existsSync(settingsPath)) {
        const settings = readJsonFile(settingsPath);
        if (settings && settings["al.packageCachePath"]) {
          packagePath = settings["al.packageCachePath"];
          if (!path.isAbsolute(packagePath)) {
            packagePath = path.join(folder.uri.fsPath, packagePath);
          }
        }
      }
    } catch (err) {
      logger.error(`Error reading settings.json:`, err);
    }

    // If no path found, check for app.json and use .alpackages
    if (!packagePath) {
      try {
        const appJsonPath = path.join(folder.uri.fsPath, "app.json");
        if (fs.existsSync(appJsonPath)) {
          packagePath = path.join(folder.uri.fsPath, ".alpackages");
        }
      } catch (err) {
        logger.error(`Error checking for app.json:`, err);
      }
    }

    if (packagePath) {
      const symbolsFolderWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(packagePath), "**/*.app")
      );

      // Handle new symbol files
      symbolsFolderWatcher.onDidCreate(async (uri) => {
        logger.info("New .app file detected:", uri.fsPath);
        // Refresh symbol and field caches when new .app files are detected
        // Use a debounce mechanism if this triggers too frequently on download
        symbolsFolderWatcher.onDidChange(async (uri) =>
          triggerAppFileRefresh(uri, context)
        );
        symbolsFolderWatcher.onDidCreate(async (uri) =>
          triggerAppFileRefresh(uri, context)
        );
        // Consider onDidDelete if necessary to prune cache
      });

      // Debounced function to handle .app file changes
      let appRefreshDebounceTimer;
      async function triggerAppFileRefresh(uri, context) {
        clearTimeout(appRefreshDebounceTimer);
        appRefreshDebounceTimer = setTimeout(async () => {
          logger.info(
            `.app file changed/created: ${uri.fsPath}. Triggering cache refresh.`
          );
          try {
            // Re-initialize/refresh symbol cache (which now uses the worker)
            // Pass true to force reprocessing of this specific app path if needed,
            // or let the mtime check handle it. Let's rely on mtime for now.
            const symbolCache = require("./symbolCache"); // Get the instance
            await symbolCache.refreshCacheInBackground(); // This triggers the worker for symbols

            // Re-initialize field cache (sends message to worker)
            await initializeFieldCache(context);
          } catch (error) {
            logger.error(
              "Error triggering cache refresh on .app change:",
              error
            );
            vscode.window.showErrorMessage(
              `Failed to trigger cache refresh: ${error.message}`
            );
          }
        }, 1500); // Delay to ensure file write is complete and debounce rapid changes
      }

      context.subscriptions.push(symbolsFolderWatcher);
      logger.info(`Watching for symbol changes in: ${packagePath}`);
    }
  }
}

// Removed initializeSymbolCache function (moved to cacheHelper.js)

/**
 * Extension deactivation handler
 */
function deactivate() {
  logger.info(`${EXTENSION_ID} extension deactivated`);

  // Clean up all status bar items
  for (const filePath in globalStatusBarItems) {
    if (globalStatusBarItems[filePath]) {
      globalStatusBarItems[filePath].dispose();
    }
  }
  globalStatusBarItems = {};
}

function findDocRefAtLine(provider, document, line) {
  const refs = provider._findDocumentationReferences(
    document.getText(),
    document.uri.fsPath
  );

  return refs.find((ref) => ref.lineNumber === line + 1);
}

function toggleDocRefDone(provider, item) {
  if (!item || !item.filePath || !item.docId || item.lineNumber === undefined)
    return;

  const newState = provider.toggleDocumentationReferenceDone(
    item.filePath,
    item.docId,
    item.lineNumber
  );

  const statusText = newState ? "marked as done" : "marked as not done";
  vscode.window.setStatusBarMessage(
    `Documentation reference ${item.docId} ${statusText}`,
    3000
  );

  // Update icons for all tabs showing this file
  updateAllTabsForFile(item.filePath, provider);

  return newState;
}

// Add this new function to update all tabs for a specific file
function updateAllTabsForFile(filePath, provider) {
  if (!filePath) return;

  try {
    // Update all tabs in all tab groups
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input.uri?.fsPath === filePath) {
          // Get or open the document to check status
          const document = vscode.workspace.textDocuments.find(
            (doc) => doc.uri.fsPath === filePath
          );

          if (document) {
            const allReferencesDone = checkDocumentationReferences(
              document,
              provider
            );
            updateTabIcon(
              tab,
              allReferencesDone ? "done-icon" : "default-icon"
            );
          } else {
            // If document not already open, read file content directly
            try {
              const content = fs.readFileSync(filePath, "utf8");
              const refs = provider._findDocumentationReferences(
                content,
                filePath
              );
              const allDone =
                refs.length > 0 &&
                refs.every((ref) => ref.done || ref.notImplemented);
              updateTabIcon(tab, allDone ? "done-icon" : "default-icon");
            } catch (err) {
              logger.error(`Error reading file ${filePath}:`, err);
            }
          }
        }
      }
    }

    // Notify VS Code that file decorations have changed for this file
    // This forces the file explorer to re-evaluate this file's decoration
    fileDecorationEventEmitter.fire(vscode.Uri.file(filePath));

    // Also trigger a manual refresh of the file explorer
    setTimeout(() => {
      vscode.commands.executeCommand(
        "workbench.files.action.refreshFilesExplorer"
      );
    }, 100);
  } catch (error) {
    logger.error("Error updating tabs for file:", error);
  }
}

async function promptForDescription(docId, currentDescription) {
  return vscode.window.showInputBox({
    prompt: `Enter description for ${docId}`,
    placeHolder: "Brief description or note",
    value: currentDescription,
  });
}

function updateDescription(provider, filePath, docId, lineNumber, description) {
  const success = provider.setDocumentationReferenceDescription(
    filePath,
    docId,
    lineNumber,
    description
  );

  if (success) {
    vscode.window.setStatusBarMessage(`Description updated for ${docId}`, 3000);
  } else {
    vscode.window.showErrorMessage(`Failed to update description for ${docId}`);
  }
}

/**
 * Check if upgradedObjectFolders has a basePath already configured
 * @param {Object} configManager - Config manager instance
 * @returns {Promise<{proceed: boolean, overwrite: boolean}>} Object indicating whether to proceed and overwrite
 */
async function checkExistingBasePath(configManager) {
  const upgradedObjectFolders = configManager.getConfigValue(
    "upgradedObjectFolders",
    null
  );

  if (!upgradedObjectFolders?.basePath) {
    return { proceed: true, overwrite: true };
  }

  const options = [
    "Yes, overwrite existing configuration",
    "No, but run anyway",
    "Cancel",
  ];

  const selection = await vscode.window.showQuickPick(options, {
    placeHolder: `The setting upgradedObjectFolders already has basePath configured as: ${upgradedObjectFolders.basePath}`,
  });

  if (!selection) {
    return { proceed: false, overwrite: false };
  }

  if (selection === options[0]) {
    return { proceed: true, overwrite: true };
  } else if (selection === options[1]) {
    return { proceed: true, overwrite: false };
  } else {
    return { proceed: false, overwrite: false };
  }
}

async function generateDocumentationSummary(provider) {
  try {
    const allRefs = [];
    const configManager = require("./utils/configManager");

    // Get basePath from upgradedObjectFolders config
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );
    if (!upgradedObjectFolders?.basePath) {
      throw new Error(
        "Base path not configured in upgradedObjectFolders settings"
      );
    }

    // Find all .txt files in the base path
    const txtFiles = await vscode.workspace.findFiles(
      new vscode.RelativePattern(
        vscode.Uri.file(upgradedObjectFolders.basePath),
        "**/*.txt"
      )
    );

    // Process each file
    for (const file of txtFiles) {
      const content = await vscode.workspace.fs.readFile(file);
      const refs = provider._findDocumentationReferences(
        content.toString(),
        file.fsPath
      );
      allRefs.push(
        ...refs.map((ref) =>
          !ref.context
            ? { ...ref, filePath: file.fsPath }
            : ref.context.indexOf(ref.id) === -1
            ? { ...ref, filePath: file.fsPath }
            : (() => {
                let newContext = ref.context.substring(
                  ref.context.indexOf(ref.id)
                );
                if (/[([{};:<]$/.test(newContext))
                  newContext = newContext.slice(0, -1);
                return { ...ref, filePath: file.fsPath, context: newContext };
              })()
        )
      );
    }

    // Early exit if no references found
    if (allRefs.length === 0) {
      vscode.window.showInformationMessage("No documentation references found");
      return;
    }

    // Calculate statistics
    const totalRefs = allRefs.length;
    const doneCount = allRefs.filter((ref) => ref.done).length;
    const notImplementedCount = allRefs.filter(
      (ref) => ref.notImplemented
    ).length;
    const pendingCount = totalRefs - doneCount - notImplementedCount;

    const donePercent = ((doneCount / totalRefs) * 100).toFixed(1);
    const notImplementedPercent = (
      (notImplementedCount / totalRefs) *
      100
    ).toFixed(1);
    const pendingPercent = ((pendingCount / totalRefs) * 100).toFixed(1);

    // Get current date and time
    const now = new Date();
    const generationTime = now.toLocaleString();

    // Create statistics section
    const statsSection =
      `## Statistics (Generated on ${generationTime})\n\n` +
      `- Total References: ${totalRefs}\n` +
      `- ✅ Done: ${doneCount} (${donePercent}%)\n` +
      `- ❌ Not Implemented: ${notImplementedCount} (${notImplementedPercent}%)\n` +
      `- ⏳ Pending: ${pendingCount} (${pendingPercent}%)\n\n`;

    // Create file-based report
    let fileContent = `# Documentation References by File\n\n${statsSection}`;

    const fileGroups = groupBy(allRefs, "filePath");

    for (const [file, refs] of Object.entries(fileGroups)) {
      const groupStatus = getCompoundStatus(refs);
      fileContent += `### ${path.basename(file)} (${groupStatus})\n\n`;
      for (const ref of refs) {
        const status = ref.notImplemented
          ? "❌ Not Implemented"
          : ref.done
          ? "✅ Done"
          : "⏳ Pending";
        const userInfo = ref.userId ? `${ref.userId}` : "";
        const dateInfo = ref.lastModified
          ? ` (${new Date(ref.lastModified).toLocaleString()})`
          : "";
        const code = "```";
        fileContent += `- ${status} ${code} ${userInfo}${dateInfo} ${code} ${ref.context}\n`;
        if (ref.userDescription) {
          fileContent += `  - Note: ${ref.userDescription}\n`;
        }
      }
      fileContent += `\n`;
    }

    // ID-based report with userId
    let idContent = `# Documentation References by ID\n\n${statsSection}`;
    const idGroups = groupBy(allRefs, (ref) => extractFullId(ref.context));
    for (const [id, refs] of Object.entries(idGroups)) {
      const groupStatus = getCompoundStatus(refs);
      idContent += `### ${id} (${groupStatus})\n\n`;
      for (const ref of refs) {
        const status = ref.notImplemented
          ? "❌ Not Implemented"
          : ref.done
          ? "✅ Done"
          : "⏳ Pending";
        const userInfo = ref.userId ? `${ref.userId}` : "";
        const dateInfo = ref.lastModified
          ? ` (${new Date(ref.lastModified).toLocaleString()})`
          : "";
        const code = "```";
        idContent += `- ${status} ${code} ${userInfo}${dateInfo} ${code}  ${path.basename(
          ref.filePath
        )}:${ref.lineNumber} | ${ref.context}\n`;
        if (ref.userDescription) {
          idContent += `  - Note: ${ref.userDescription}\n`;
        }
      }
      idContent += `\n`;
    }

    // Show both reports in separate windows
    const fileDoc = await vscode.workspace.openTextDocument({
      content: fileContent,
      language: "markdown",
    });
    const idDoc = await vscode.workspace.openTextDocument({
      content: idContent,
      language: "markdown",
    });
    await vscode.window.showTextDocument(fileDoc, {
      viewColumn: vscode.ViewColumn.One,
    });
    await vscode.window.showTextDocument(idDoc, {
      viewColumn: vscode.ViewColumn.Two,
    });
  } catch (error) {
    console.error("Error generating documentation summary:", error);
    vscode.window.showErrorMessage(
      `Failed to generate documentation summary: ${error.message}`
    );
  }
}

function groupBy(array, key) {
  return array.reduce((result, item) => {
    const groupKey = typeof key === "function" ? key(item) : item[key];
    (result[groupKey] = result[groupKey] || []).push(item);
    return result;
  }, {});
}

function extractFullId(context) {
  if (!context) return "Unknown";
  const match = context.match(/(#[A-Z]+\d+\/\d+:\d+)/);
  return match ? match[1] : "Unknown";
}

function getCompoundStatus(refs) {
  const allDone = refs.every((ref) => ref.done && !ref.notImplemented);
  const allNotImplemented = refs.every(
    (ref) => ref.notImplemented && !ref.done
  );
  const hasPending = refs.some((ref) => !ref.done && !ref.notImplemented);
  const mixedDoneNotImplemented =
    refs.every((ref) => ref.done || ref.notImplemented) && !hasPending;

  if (hasPending) {
    return "⏳ Pending";
  } else if (allDone || mixedDoneNotImplemented) {
    return "✅ Done";
  } else if (allNotImplemented) {
    return "❌ Not Implemented";
  } else {
    return "Mixed";
  }
}

function checkDocumentationReferences(document, provider) {
  if (!document || !provider) return false;

  try {
    const refs = provider._findDocumentationReferences(
      document.getText(),
      document.uri.fsPath
    );

    // If no references, return false
    if (refs.length === 0) return false;

    // Return true if all references are either done or not implemented
    return refs.every((ref) => ref.done || ref.notImplemented);
  } catch (error) {
    console.error("Error checking documentation references:", error);
    return false;
  }
}

function updateTabIcon(tab, iconType) {
  if (!tab || !tab.input.uri?.fsPath) return;

  const filePath = tab.input.uri.fsPath;

  // Dispose existing status bar item for this file if it exists
  if (globalStatusBarItems[filePath]) {
    globalStatusBarItems[filePath].dispose();
  }

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );

  if (iconType === "done-icon") {
    statusBarItem.text = "$(check) Docs Complete";
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
    statusBarItem.color = new vscode.ThemeColor(
      "statusBarItem.warningForeground"
    );
    statusBarItem.tooltip = "All documentation references are completed";
  } else {
    statusBarItem.text = "$(warning) Docs In Progress";
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground"
    );
    statusBarItem.color = new vscode.ThemeColor(
      "statusBarItem.errorForeground"
    );
    statusBarItem.tooltip = "Documentation references are still in progress";
  }

  // Command to jump to next incomplete reference (you can implement this separately)
  statusBarItem.command = "bc-al-upgradeassistant.jumpToNextIncompleteRef";

  // Show the status bar item
  statusBarItem.show();

  // Store in our global tracker instead of on the tab
  globalStatusBarItems[filePath] = statusBarItem;
}

function cleanupStatusBarItems() {
  // Dispose all status bar items except for the current file
  const currentFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
  for (const filePath in globalStatusBarItems) {
    if (filePath !== currentFilePath) {
      globalStatusBarItems[filePath].dispose();
      delete globalStatusBarItems[filePath];
    }
  }
}

/**
 * Delete a referenced object from the JSON file
 * @param {Object} item The referenced object item
 * @param {FileReferenceProvider} provider The file reference provider
 * @returns {Promise<boolean>} Whether the deletion was successful
 */
async function deleteReferencedObject(item, provider) {
  if (!provider || !provider.activeEditor) return false;

  const filePath = provider.activeEditor.document.uri.fsPath;
  if (!filePath) return false;

  // Get the reference file path
  const indexFolder = item.indexFolder;
  const fileName = path.basename(filePath);
  const referenceFileName = fileName.replace(/\.txt$/, ".json");
  const referenceFilePath = path.join(indexFolder, referenceFileName);

  try {
    // Read the reference file
    if (!fs.existsSync(referenceFilePath)) return false;
    const referenceData = JSON.parse(
      fs.readFileSync(referenceFilePath, "utf8")
    );

    if (
      !referenceData.referencedWorkingObjects ||
      !Array.isArray(referenceData.referencedWorkingObjects)
    ) {
      return false;
    }

    // Find the object to delete
    const index = referenceData.referencedWorkingObjects.findIndex(
      (ref) => ref.type === item.type && ref.number.toString() === item.id
    );

    // Remove the object
    if (index === -1) return false;
    referenceData.referencedWorkingObjects.splice(index, 1);

    // Write the updated file
    fs.writeFileSync(referenceFilePath, JSON.stringify(referenceData, null, 2));
    return true;
  } catch (error) {
    console.error("Error deleting referenced object:", error);
    return false;
  }
}

/**
 * Find all AL files in the workspace
 * @returns {Promise<vscode.Uri[]>} The AL files
 */
async function findAlFiles() {
  return vscode.workspace.findFiles("**/*.al", "**/node_modules/**");
}

/**
 * Extract AL object info from file
 * @param {string} filePath Path to the AL file
 * @returns {{type: string, id: string, name: string}|null} Object info or null
 */
function extractAlObjectInfo(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");

    // Look for object declarations
    const patterns = [
      // tableextension, pageextension, etc.
      /\b(tableextension|pageextension|reportextension|codeunitextension)\s+(\d+)\s+["']([^"']+)["']/i,
      // table, page, report, codeunit, etc.
      /\b(table|page|report|codeunit|query|xmlport|enum|profile|interface)\s+(\d+)\s+["']([^"']+)["']/i,
      // permissionset
      /\b(permissionset)\s+(\w+)\s+/i,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        return {
          type: match[1],
          id: match[2],
          name: match[3] || match[2], // For permissionsets with no numeric ID
        };
      }
    }

    return null;
  } catch (error) {
    console.error("Error extracting AL object info:", error);
    return null;
  }
}

/**
 * Add a reference to a file
 * @param {string} filePath The file to add the reference to
 * @param {Object} objectInfo The object information
 * @param {FileReferenceProvider} provider The file reference provider
 * @returns {Promise<boolean>} Whether the addition was successful
 */
async function addReferenceToFile(filePath, objectInfo, provider) {
  if (!filePath || !objectInfo || !provider) return false;

  // Find the .index folder
  const indexFolder = provider._findIndexFolder();
  if (!indexFolder) return false;

  // Get reference file path
  const fileName = path.basename(filePath);
  const referenceFileName = fileName.replace(/\.txt$/, ".json");
  const referenceFilePath = path.join(indexFolder, referenceFileName);

  try {
    // Read existing reference file if it exists
    let referenceData = {};
    if (fs.existsSync(referenceFilePath)) {
      referenceData = JSON.parse(fs.readFileSync(referenceFilePath, "utf8"));
    }

    // Initialize referencedWorkingObjects array if it doesn't exist
    if (!referenceData.referencedWorkingObjects) {
      referenceData.referencedWorkingObjects = [];
    }

    // Check if reference already exists
    const exists = referenceData.referencedWorkingObjects.some(
      (ref) =>
        ref.type === objectInfo.type && ref.number.toString() === objectInfo.id
    );
    if (exists) {
      vscode.window.showInformationMessage(
        `Reference to ${objectInfo.type} ${objectInfo.id} already exists`
      );
      return true;
    }

    // Add new reference
    referenceData.referencedWorkingObjects.push({
      type: objectInfo.type,
      number: parseInt(objectInfo.id),
    });

    // Write updated file
    fs.writeFileSync(referenceFilePath, JSON.stringify(referenceData, null, 2));

    // Also create object folder and info.json in the .index structure
    const objectTypeFolder = path.join(
      indexFolder,
      objectInfo.type.toLowerCase()
    );
    const objectIdFolder = path.join(objectTypeFolder, objectInfo.id);

    // Create folders if they don't exist
    if (!fs.existsSync(objectTypeFolder)) {
      fs.mkdirSync(objectTypeFolder, { recursive: true });
    }

    if (!fs.existsSync(objectIdFolder)) {
      fs.mkdirSync(objectIdFolder, { recursive: true });
    }

    // Get the original AL file path - update this to use the full fsPath from the selected file
    // Instead of depending on objectInfo.detail which might not be populated
    let originalPath = "";
    if (objectInfo.fsPath) {
      originalPath = objectInfo.fsPath;
    } else {
      // Try to find the AL file in the workspace by object type and ID
      const alFiles = await findAlFiles();

      for (const file of alFiles) {
        try {
          const fileContent = fs.readFileSync(file.fsPath, "utf8");
          const regex = new RegExp(
            `\\b${objectInfo.type}\\s+${objectInfo.id}\\b`,
            "i"
          );

          if (regex.test(fileContent)) {
            originalPath = file.fsPath;
            break;
          }
        } catch (err) {
          // Continue to next file if there's an error
          console.error(`Error reading file ${file.fsPath}:`, err);
        }
      }
    }

    // Create or update info.json file with all required fields
    const infoFilePath = path.join(objectIdFolder, "info.json");
    const infoData = {
      originalPath: originalPath,
      fileName: path.basename(originalPath || ""),
      objectType: objectInfo.type.toLowerCase(),
      objectNumber: objectInfo.id,
      indexedAt: new Date().toISOString(),
      referencedMigrationFiles: [filePath], // Include current file as a referenced migration file
    };

    fs.writeFileSync(infoFilePath, JSON.stringify(infoData, null, 2));

    return true;
  } catch (error) {
    logger.error("Error adding reference:", error);
    return false;
  }
}

module.exports = {
  activate,
  deactivate,
  // initializeSymbolCache, // Removed export
  checkExistingBasePath,
};
