const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const glob = require("glob").sync;
const symbolCache = require("../symbolCache");
const { readJsonFile } = require("../jsonUtils");
const fieldCollector = require("./fieldCollector");
const { getSymbolCacheWorker } = require("../symbolCache");

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

/**
 * Initializes the field cache by loading persisted data and triggering a background update.
 * @param {vscode.ExtensionContext} context - Extension context
 */
async function initializeFieldCache(context) {
  console.log("[Cache] Initializing field cache...");
  const globalStoragePath = context.globalStorageUri.fsPath;
  const metadataFilePath = path.join(
    globalStoragePath,
    "fieldCacheMetadata.json"
  );
  const tableCacheFilePath = path.join(
    globalStoragePath,
    "fieldTableCache.json"
  );
  const pageCacheFilePath = path.join(globalStoragePath, "fieldPageCache.json");

  let loadedMetadata = {};
  let loadedTableCache = {};
  let loadedPageCache = {};

  // 1. Load existing cache and metadata
  try {
    await fs.promises.mkdir(globalStoragePath, { recursive: true }); // Ensure directory exists

    if (fs.existsSync(metadataFilePath)) {
      loadedMetadata = JSON.parse(
        await fs.promises.readFile(metadataFilePath, "utf8")
      );
      console.log(
        `[Cache] Loaded field cache metadata (${
          Object.keys(loadedMetadata).length
        } entries).`
      );
    }
    if (fs.existsSync(tableCacheFilePath)) {
      loadedTableCache = JSON.parse(
        await fs.promises.readFile(tableCacheFilePath, "utf8")
      );
      console.log(
        `[Cache] Loaded persisted table field cache (${
          Object.keys(loadedTableCache).length
        } tables).`
      );
    }
    if (fs.existsSync(pageCacheFilePath)) {
      loadedPageCache = JSON.parse(
        await fs.promises.readFile(pageCacheFilePath, "utf8")
      );
      console.log(
        `[Cache] Loaded persisted page source table cache (${
          Object.keys(loadedPageCache).length
        } pages).`
      );
    }

    // Update in-memory cache (Requires setters in fieldCollector.js - to be added)
    fieldCollector.setTableFieldsCache(loadedTableCache);
    fieldCollector.setPageSourceTableCache(loadedPageCache);
    // We don't store metadata in fieldCollector, it's mainly for the worker
  } catch (err) {
    console.error("[Cache] Error loading persisted field cache/metadata:", err);
    // Start fresh if loading fails, clear potentially corrupt in-memory caches
    fieldCollector.setTableFieldsCache({});
    fieldCollector.setPageSourceTableCache({});
  }

  // 2. Get options and trigger worker
  try {
    const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
    const srcExtractionPath = config.get("srcExtractionPath", "");
    let appName = "UnknownApp"; // Default app name

    // Find app.json in the root of the first workspace folder
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const appJsonPath = path.join(rootPath, "app.json");
      if (fs.existsSync(appJsonPath)) {
        try {
          const appJson = readJsonFile(appJsonPath);
          appName = appJson?.name ?? appName;
        } catch (appJsonErr) {
          console.error(
            `[Cache] Error reading app.json at ${appJsonPath}:`,
            appJsonErr
          );
        }
      } else {
        console.warn(
          `[Cache] app.json not found in workspace root: ${rootPath}`
        );
      }
    } else {
      console.warn("[Cache] No workspace folder found to determine app name.");
    }

    if (!srcExtractionPath) {
      console.warn(
        "[Cache] srcExtractionPath not configured. Field cache update skipped."
      );
      return;
    }

    const workerOptions = {
      srcExtractionPath,
      globalStoragePath,
      appName,
    };

    // Get worker instance and send message
    const worker = getSymbolCacheWorker(); // Need to ensure this function exists and returns the worker process
    if (worker) {
      console.log("[Cache] Sending updateFieldCache message to worker.");
      worker.send({ type: "updateFieldCache", options: workerOptions });

      // Add message handler for worker responses *here* or ensure it's handled elsewhere
      // Example: worker.on('message', handleWorkerFieldCacheMessage);
    } else {
      console.error(
        "[Cache] Could not get symbol cache worker instance to update field cache."
      );
    }
  } catch (err) {
    console.error("[Cache] Error triggering field cache worker update:", err);
    vscode.window.showErrorMessage(
      `Failed to trigger field cache update: ${err.message}`
    );
  }
}

module.exports = {
  initializeSymbolCache,
  updateSymbolCacheForFile,
  initializeFieldCache,
};
