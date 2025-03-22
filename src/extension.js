const vscode = require("vscode");
const { registerCommands } = require("./registerCommands");
const { registerEvents } = require("./registerEvents");
const modelHelper = require("./modelHelper");
const path = require("path");
const fs = require("fs");
const glob = require("glob").sync;
const symbolCache = require("./symbolCache");
const { readJsonFile } = require("./jsonUtils");
const ExtendedObjectHoverProvider = require("./hover/extendedObjectHoverProvider");
const { EXTENSION_ID } = require("./constants");
const { registerViews } = require("./views/registerViews");

let globalStatusBarItems = {};

// Add an event emitter for file decorations
const fileDecorationEventEmitter = new vscode.EventEmitter();

/**
 * Extension activation handler
 * @param {vscode.ExtensionContext} context - Extension context
 */
async function activate(context) {
  console.log(`Activating ${EXTENSION_ID} extension`);

  try {
    // Register all commands, events or views  at once
    registerCommands(context);
    registerEvents(context);
    const { fileReferenceProvider } = registerViews(context);

    // Initialize symbol cache
    await initializeSymbolCache(context, false);

    // Register command to generate documentation reference summary
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.generateDocumentationSummary",
        async () => await generateDocumentationSummary(fileReferenceProvider)
      )
    );

    modelHelper.initializeModels();

    // Register the CodeLens provider for AL files
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(
        { scheme: "file", language: "al" },
        new ExtendedObjectHoverProvider()
      )
    );

    // Register command to toggle documentation reference 'not implemented' status
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "bc-al-upgradeassistant.toggleDocumentationReferenceNotImplemented",
        (item) => {
          // Handle direct item click
          if (
            item &&
            item.filePath &&
            item.docId &&
            item.lineNumber !== undefined
          ) {
            const newState =
              fileReferenceProvider.toggleDocumentationReferenceNotImplemented(
                item.filePath,
                item.docId,
                item.lineNumber
              );
            const statusText = newState
              ? "marked as not implemented"
              : "marked as to be implemented";
            vscode.window.setStatusBarMessage(
              `Documentation reference ${item.docId} ${statusText}`,
              2200
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

          const newState =
            fileReferenceProvider.toggleDocumentationReferenceNotImplemented(
              editor.document.uri.fsPath,
              docRef.id,
              docRef.lineNumber
            );
          const statusText = newState
            ? "marked as not implemented"
            : "marked as to be implemented";
          vscode.window.setStatusBarMessage(
            `Documentation reference ${docRef.id} ${statusText}`,
            2200
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
          console.error("Error providing file decoration:", error);
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
              vscode.window.showInformationMessage(
                `Deleted reference to ${item.type} ${item.id}`
              );
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

    console.log(`${EXTENSION_ID} extension activated successfully`);
  } catch (error) {
    console.error("Error during extension activation:", error);
    vscode.window.showErrorMessage(
      `Error activating extension: ${error.message}`
    );
  }
}

/**
 * Initialize symbol cache
 * @param {vscode.ExtensionContext} context - Extension context
 * @param {boolean} force - Whether to force refresh
 * @returns {Promise<number>} Number of processed files
 */
async function initializeSymbolCache(context, force = false) {
  try {
    let appPaths = [];

    // Common locations for .app files
    const defaultLocations = [];

    // Add workspace folders first
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const folderPath = folder.uri.fsPath;

        // Try to read .vscode/settings.json to find al.packageCachePath
        try {
          const settingsPath = path.join(
            folderPath,
            ".vscode",
            "settings.json"
          );
          if (fs.existsSync(settingsPath)) {
            const settings = readJsonFile(settingsPath);
            if (settings && settings["al.packageCachePath"]) {
              let packagePath = settings["al.packageCachePath"];
              // Handle relative paths
              if (!path.isAbsolute(packagePath)) {
                packagePath = path.join(folderPath, packagePath);
              }
              defaultLocations.push(path.join(packagePath, "*.app"));
              console.log(`Using al.packageCachePath: ${packagePath}`);
              continue; // Skip the default locations for this workspace folder
            }
          }
        } catch (err) {
          console.error(`Error reading settings.json:`, err);
        }

        // If no al.packageCachePath found, try to locate app.json
        try {
          const appJsonPath = path.join(folderPath, "app.json");
          if (fs.existsSync(appJsonPath)) {
            defaultLocations.push(
              path.join(folderPath, ".alpackages", "*.app")
            );
            console.log(`Using app.json location: ${folderPath}/.alpackages`);
            continue;
          }
        } catch (err) {
          console.error(`Error checking for app.json:`, err);
        }

        // If neither settings.json nor app.json found, use default .alpackages
        defaultLocations.push(path.join(folderPath, ".alpackages", "*.app"));
      }
    }

    // Process each app file location
    for (const pattern of defaultLocations) {
      try {
        const files = await glob(pattern);
        appPaths = [...appPaths, ...files];
      } catch (err) {
        console.error(`Error finding app files with pattern ${pattern}:`, err);
      }
    }

    // Initialize the cache
    await symbolCache.initialize(appPaths);

    // If forcing refresh or cache is empty, process the app files
    let processed = 0;
    if (force || Object.keys(symbolCache.symbols).length === 0) {
      processed = await symbolCache.processAppFiles();
      if (!force) {
        vscode.window.showInformationMessage(
          `Processed ${processed} app files for symbols`
        );
      }
    }

    return processed;
  } catch (error) {
    console.error("Error initializing symbol cache:", error);
    vscode.window.showErrorMessage(
      `Failed to initialize symbol cache: ${error.message}`
    );
    throw error;
  }
}

/**
 * Extension deactivation handler
 */
function deactivate() {
  console.log(`${EXTENSION_ID} extension deactivated`);

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
              console.error(`Error reading file ${filePath}:`, err);
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
    console.error("Error updating tabs for file:", error);
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

  if (!fs.existsSync(referenceFilePath)) return false;

  try {
    // Read the reference file
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

    if (index === -1) return false;

    // Remove the object
    referenceData.referencedWorkingObjects.splice(index, 1);

    // Write the updated file
    fs.writeFileSync(referenceFilePath, JSON.stringify(referenceData, null, 2));

    return true;
  } catch (error) {
    console.error("Error deleting referenced object:", error);
    return false;
  }
}

module.exports = {
  activate,
  deactivate,
  initializeSymbolCache,
  checkExistingBasePath,
};
