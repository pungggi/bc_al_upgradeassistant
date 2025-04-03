const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const glob = require("glob").sync;
const symbolCache = require("../symbolCache");
const { readJsonFile } = require("../jsonUtils");

/**
 * Initialize symbol cache.
 * Moved from extension.js to break circular dependency.
 * @param {boolean} force - Whether to force refresh the cache
 * @returns {Promise<number>} Number of processed files
 */
async function initializeSymbolCache(force = false) {
  try {
    console.log("[Cache] Initializing symbol cache. Force:", force);

    if (force) {
      console.log("[Cache] Forcing cache clear");
      symbolCache.clearCache();
    }

    console.log(
      "[Cache] Current symbol count:",
      Object.keys(symbolCache.symbols).length
    );
    let appPaths = [];
    const defaultLocations = [];

    // Add workspace folders paths
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const folderPath = folder.uri.fsPath;

        // Check .vscode/settings.json for al.packageCachePath
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
              if (!path.isAbsolute(packagePath)) {
                packagePath = path.join(folderPath, packagePath);
              }
              defaultLocations.push(path.join(packagePath, "*.app"));
              continue;
            }
          }
        } catch (err) {
          console.error(`Error reading settings.json:`, err);
        }

        // Check for app.json
        try {
          const appJsonPath = path.join(folderPath, "app.json");
          if (fs.existsSync(appJsonPath)) {
            defaultLocations.push(
              path.join(folderPath, ".alpackages", "*.app")
            );
            continue;
          }
        } catch (err) {
          console.error(`Error checking for app.json:`, err);
        }

        // Default to .alpackages if no other configuration found
        defaultLocations.push(path.join(folderPath, ".alpackages", "*.app"));
      }
    }

    // Find all app files
    console.log("[Cache] Default locations to search:", defaultLocations); // Log the patterns we will search
    for (const pattern of defaultLocations) {
      console.log(`[Cache] Searching for .app files with pattern: ${pattern}`); // Log the current pattern
      try {
        const files = glob(pattern); // Note: glob.sync was imported, so no await needed
        console.log(
          `[Cache] Found ${files.length} files for pattern ${pattern}:`,
          files
        ); // Log the result of glob
        appPaths = [...appPaths, ...files];
      } catch (err) {
        console.error(
          `[Cache] Error finding app files with pattern ${pattern}:`,
          err
        );
      }
    }

    // Initialize the cache with found paths
    console.log("[Cache] Found app paths:", appPaths);
    await symbolCache.initialize(appPaths);
    console.log(
      "[Cache] After initialization symbol count:",
      Object.keys(symbolCache.symbols).length
    );

    let processed = 0;
    // Only refresh if paths were found or force is true
    if (appPaths.length > 0 || force) {
      await symbolCache.refreshCacheInBackground();
      processed = appPaths.length; // Return the number of paths that were processed
    } else {
      console.log("No .app paths found, skipping background cache refresh.");
    }

    return processed;
  } catch (error) {
    console.error("Error initializing symbol cache:", error);
    vscode.window.showErrorMessage(
      `Failed to initialize symbol cache: ${error.message}`
    );
    throw error; // Re-throw error to indicate failure
  }
}

/**
 * Update symbol cache for a specific file
 * @param {string} filePath - Path to the file
 * @returns {Promise<boolean>} - True if the cache was updated
 */
async function updateSymbolCacheForFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return false;
    }

    // Check if this is a relevant file type that needs to be added to the cache
    if (!filePath.toLowerCase().endsWith(".app")) {
      return false;
    }

    // Add the file to the cache without refreshing all files
    await symbolCache.addFileToCache(filePath);

    return true;
  } catch (error) {
    console.error(`Error updating symbol cache for file ${filePath}:`, error);
    return false;
  }
}

module.exports = {
  initializeSymbolCache,
  updateSymbolCacheForFile,
};
