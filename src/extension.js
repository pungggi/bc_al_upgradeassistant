const vscode = require("vscode");
const { registerCommands } = require("./registerCommands");
const modelHelper = require("./modelHelper");
const path = require("path");
const fs = require("fs");
const glob = require("glob").sync;

// Add symbolCache reference
const symbolCache = {
  symbols: {},
  initialize: async function (paths) {
    console.log(`Initializing symbol cache with ${paths.length} app paths`);
    return true;
  },
  processAppFiles: async function () {
    console.log("Processing app files for symbols");
    return 0;
  },
};

/**
 * Extension activation handler
 * @param {vscode.ExtensionContext} context - Extension context
 */
async function activate(context) {
  console.log("Activating BC/AL Upgrade Assistant extension");

  try {
    // Register all commands at once
    registerCommands(context);

    // Register model-related commands
    modelHelper.registerModelCommands(context);

    // Initialize symbol cache
    await initializeSymbolCache(context, false);

    console.log("BC/AL Upgrade Assistant extension activated successfully");
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
    // Get paths from settings
    const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
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
            const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
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
  console.log("BC/AL Upgrade Assistant extension deactivated");
}

module.exports = {
  activate,
  deactivate,
  initializeSymbolCache,
};
