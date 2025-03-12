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
              3000
            );
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
            3000
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
            checkForDocumentationRefs(document, fileReferenceProvider);
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
        checkForDocumentationRefs(
          vscode.window.activeTextEditor.document,
          fileReferenceProvider
        );
      }, 100);
    }

    // Listen for editor changes
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) {
          vscode.commands.executeCommand(
            "setContext",
            "editorHasDocumentationRef",
            false
          );
          return;
        }

        if (editor.document.languageId === "plaintext") {
          checkForDocumentationRefs(editor.document, fileReferenceProvider);
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
          checkForDocumentationRefs(e.document, fileReferenceProvider);
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
}

function findDocRefAtLine(provider, document, line) {
  const refs = provider._findDocumentationReferences(
    document.getText(),
    document.uri.fsPath
  );

  return refs.find((ref) => ref.lineNumber === line + 1);
}

function toggleDocRefDone(provider, item) {
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
}

/**
 * Check if document has documentation references and set context
 * @param {vscode.TextDocument} document The document to check
 * @param {Object} provider The file reference provider
 */
function checkForDocumentationRefs(document, provider) {
  try {
    const refs = provider._findDocumentationReferences(
      document.getText(),
      document.uri.fsPath
    );

    const hasRefs = refs.length > 0;
    console.log(
      `File ${document.fileName} has documentation refs: ${
        hasRefs ? "YES" : "NO"
      }`
    );

    vscode.commands.executeCommand(
      "setContext",
      "editorHasDocumentationRef",
      hasRefs
    );
  } catch (error) {
    console.error("Error checking for documentation refs:", error);
    vscode.commands.executeCommand(
      "setContext",
      "editorHasDocumentationRef",
      false
    );
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

module.exports = {
  activate,
  deactivate,
  initializeSymbolCache,
};
