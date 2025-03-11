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
    // Register all commands and events at once
    registerCommands(context);
    registerEvents(context);
    registerViews(context); // Register the custom views with context passed

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

module.exports = {
  activate,
  deactivate,
  initializeSymbolCache,
};
