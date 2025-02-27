const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const {
  initializeCache,
  updateCacheForFile,
  removeFromCache,
  getCacheStats,
  isInitialized,
} = require("./cache/objectCache");
const { provideExtensionHover } = require("./providers/hoverProvider");

const {
  isEventSubscriberTemplate,
  modifyEventSubscriberTemplate,
} = require("./ALCode");

const { registerCommands } = require("./registerCommands");

// Function to monitor and modify the clipboard
async function monitorClipboard() {
  let lastClipboardContent = "";

  setInterval(async () => {
    try {
      const clipboardContent = await vscode.env.clipboard.readText();

      // Check if the clipboard has changed and matches any AL code pattern
      if (
        clipboardContent !== lastClipboardContent &&
        isEventSubscriberTemplate(clipboardContent)
      ) {
        vscode.window.showInformationMessage(clipboardContent);
        lastClipboardContent = clipboardContent;

        // Modify AL code
        const modifiedContent = modifyEventSubscriberTemplate(clipboardContent);
        vscode.window.showInformationMessage(modifiedContent);

        // Write back to clipboard
        await vscode.env.clipboard.writeText(modifiedContent);
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Error monitoring clipboard: ${error.message}`
      );
    }
  }, 1300);
}

/**
 * Loads and caches all AL objects in the workspace and .alpackages folder
 */
async function loadAndCacheObjects() {
  const alObjects = {};
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders) {
    return alObjects;
  }

  // Process each workspace folder
  for (const folder of workspaceFolders) {
    // Load symbols from AL files in the workspace
    await loadSymbolsFromWorkspace(folder, alObjects);

    // Load symbols from .alpackages folder
    await loadSymbolsFromAlPackages(folder, alObjects);
  }

  return alObjects;
}

/**
 * Loads symbols from AL files in the workspace
 * @param {vscode.WorkspaceFolder} folder
 * @param {Object} alObjects
 */
async function loadSymbolsFromWorkspace(folder, alObjects) {
  // ...existing workspace symbol loading code...
}

/**
 * Loads symbols from .alpackages folder
 * @param {vscode.WorkspaceFolder} folder
 * @param {Object} alObjects
 */
async function loadSymbolsFromAlPackages(folder, alObjects) {
  try {
    const alPackagesPath = path.join(folder.uri.fsPath, ".alpackages");

    // Check if .alpackages directory exists
    if (!fs.existsSync(alPackagesPath)) {
      console.log(".alpackages directory not found in:", folder.uri.fsPath);
      return;
    }

    const files = fs.readdirSync(alPackagesPath);

    // Find all .app files in .alpackages
    const appFiles = files.filter((file) => file.endsWith(".app"));

    for (const appFile of appFiles) {
      try {
        const appFilePath = path.join(alPackagesPath, appFile);
        // Extract symbol information from the .app file using the AL Language extension's API
        await extractSymbolsFromAppFile(appFilePath, alObjects);
      } catch (err) {
        console.error(`Error processing app file ${appFile}:`, err);
      }
    }
  } catch (err) {
    console.error("Error processing .alpackages directory:", err);
  }
}

/**
 * Extracts symbols from an app file using the AL Language extension's API
 * @param {string} appFilePath
 * @param {Object} alObjects
 */
async function extractSymbolsFromAppFile(appFilePath, alObjects) {
  try {
    // Use the AL Language extension's API to extract symbols
    const alExtension = vscode.extensions.getExtension("ms-dynamics-smb.al");

    if (!alExtension) {
      console.log(
        "AL Language extension not found. Cannot extract symbols from app files."
      );
      return;
    }

    if (!alExtension.isActive) {
      await alExtension.activate();
    }

    // Access the AL Language extension API
    const api = alExtension.exports;

    // If the API provides a way to extract symbols from app files
    if (
      api &&
      api.symbolsService &&
      api.symbolsService.loadSymbolsFromAppPackage
    ) {
      const symbols = await api.symbolsService.loadSymbolsFromAppPackage(
        appFilePath
      );

      // Process and add the symbols to alObjects
      processSymbols(symbols, alObjects);
    } else {
      // Fallback implementation if direct API is not available
      // This is a simplified approach that may need to be adjusted
      // based on the actual AL extension API capabilities
      const symbols = await extractSymbolsAlternate(appFilePath);
      processSymbols(symbols, alObjects);
    }
  } catch (err) {
    console.error(`Error extracting symbols from ${appFilePath}:`, err);
  }
}

/**
 * Alternative method to extract symbols if direct API is not available
 * @param {string} appFilePath
 * @returns {Array} extracted symbols
 */
async function extractSymbolsAlternate(appFilePath) {
  // This is a placeholder implementation
  // In a real implementation, you might:
  // 1. Use child_process to run a tool that can extract symbols
  // 2. Parse the app file directly if format is known
  // 3. Use another extension's capabilities
  console.log(
    `Using alternative method to extract symbols from ${appFilePath}`
  );
  return [];
}

/**
 * Process extracted symbols and add them to alObjects
 * @param {Array} symbols
 * @param {Object} alObjects
 */
function processSymbols(symbols, alObjects) {
  if (!symbols || !Array.isArray(symbols)) {
    return;
  }

  for (const symbol of symbols) {
    if (symbol.type && symbol.name && symbol.id) {
      const key = `${symbol.type} ${symbol.id}`;
      alObjects[key] = symbol;
    }
  }
}

function activate(context) {
  let disposable = registerCommands();

  // Initialize the cache when the extension activates
  initializeCache();

  // monitore clipboard for eventsubscribtions
  monitorClipboard();

  // Register the hover provider
  const hoverProviderDisposable = vscode.languages.registerHoverProvider("al", {
    provideHover(document, position, token) {
      return provideExtensionHover(document, position, token);
    },
  });

  // Register a command to refresh the extension info cache - KEEP THIS ONE AND MODIFY IT
  const refreshCacheDisposable = vscode.commands.registerCommand(
    "bc_al_upgradeassistant.refreshExtensionInfoCache",
    async () => {
      vscode.window.showInformationMessage(
        "Refreshing extension info cache..."
      );
      try {
        // Initialize cache with enhanced functionality to include .alpackages
        initializeCache(true);

        // Also load symbols from .alpackages
        const alObjects = await loadAndCacheObjects();
        context.workspaceState.update("alObjects", alObjects);

        vscode.window.showInformationMessage(
          "Extension info cache refreshed successfully!"
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Error refreshing cache: ${err.message}`
        );
      }
    }
  );

  // Register file system watcher to update the cache when AL files change
  const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.al");
  fileWatcher.onDidChange((uri) => updateCacheForFile(uri));
  fileWatcher.onDidCreate((uri) => updateCacheForFile(uri));
  fileWatcher.onDidDelete((uri) => removeFromCache(uri));

  context.subscriptions.push(
    refreshCacheDisposable,
    fileWatcher,
    hoverProviderDisposable
  );

  // Register command to refresh the object cache
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.refreshObjectCache",
      async () => {
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Refreshing AL object cache...",
            cancellable: false,
          },
          async (progress) => {
            try {
              progress.report({ message: "Scanning workspace files..." });
              await initializeCache();
              const stats = getCacheStats();

              let message = "AL object cache refreshed successfully.";
              if (stats.objectTypes) {
                const counts = Object.entries(stats.objectTypes)
                  .map(([type, count]) => `${type}: ${count}`)
                  .join(", ");
                message += ` Found ${counts}`;
              }

              vscode.window.showInformationMessage(message);
            } catch (error) {
              vscode.window.showErrorMessage(
                `Failed to refresh AL object cache: ${error.message}`
              );
            }
          }
        );
      }
    )
  );

  // Initialize cache on extension activation
  if (!isInitialized()) {
    initializeCache().catch((error) => {
      console.error("Failed to initialize cache on activation:", error);
    });
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
