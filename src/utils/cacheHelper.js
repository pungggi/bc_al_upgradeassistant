const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const glob = require("glob").sync;
const symbolCache = require("../symbolCache");
const { readJsonFile } = require("../jsonUtils");
const fieldCollector = require("./fieldCollector");
const { getSymbolCacheWorker } = require("../symbolCache");
const { getObjectDefinition } = require("../../al-parser-lib/alparser");
const { extractProceduresFromObjects } = require("./procedureExtractor");
const { logger } = require("./logger");

/**
 * Initialize symbol cache.
 * Moved from extension.js to break circular dependency.
 * @param {boolean} force - Whether to force refresh the cache
 * @returns {Promise<number>} Number of processed files
 */
async function initializeSymbolCache(force = false) {
  try {
    logger.info("[Cache] Initializing symbol cache. Force:", force);

    if (force) {
      logger.info("[Cache] Forcing cache clear");
      symbolCache.clearCache();
    }

    logger.info(
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
          logger.error(`Error reading settings.json:`, err);
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
          logger.error(`Error checking for app.json:`, err);
        }

        // Default to .alpackages if no other configuration found
        defaultLocations.push(path.join(folderPath, ".alpackages", "*.app"));
      }
    }

    // Find all app files
    logger.info("[Cache] Default locations to search:", defaultLocations); // Log the patterns we will search
    for (const pattern of defaultLocations) {
      logger.info(`[Cache] Searching for .app files with pattern: ${pattern}`); // Log the current pattern
      try {
        const files = glob(pattern); // Note: glob.sync was imported, so no await needed
        logger.info(
          `[Cache] Found ${files.length} files for pattern ${pattern}:`,
          files
        ); // Log the result of glob
        appPaths = [...appPaths, ...files];
      } catch (err) {
        logger.error(
          `[Cache] Error finding app files with pattern ${pattern}:`,
          err
        );
      }
    }

    // Initialize the cache with found paths
    logger.info("[Cache] Found app paths:", appPaths);
    await symbolCache.initialize(appPaths);
    logger.info(
      "[Cache] After initialization symbol count:",
      Object.keys(symbolCache.symbols).length
    );

    // Process AL files in the workspace
    await processWorkspaceAlFiles();

    let processed = 0;
    // Only refresh if paths were found or force is true
    if (appPaths.length > 0 || force) {
      await symbolCache.refreshCacheInBackground();
      processed = appPaths.length; // Return the number of paths that were processed
    } else {
      logger.info("No .app paths found, skipping background cache refresh.");
    }

    return processed;
  } catch (error) {
    logger.error("Error initializing symbol cache:", error);
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
    logger.error(`Error updating symbol cache for file ${filePath}:`, error);
    return false;
  }
}

/**
 * Initializes the field cache by loading persisted data and triggering a background update.
 * @param {vscode.ExtensionContext} context - Extension context
 */
async function initializeFieldCache(context) {
  logger.info("[Cache] Initializing field cache...");
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
      logger.info(
        `[Cache] Loaded field cache metadata (${
          Object.keys(loadedMetadata).length
        } entries).`
      );
    }
    if (fs.existsSync(tableCacheFilePath)) {
      loadedTableCache = JSON.parse(
        await fs.promises.readFile(tableCacheFilePath, "utf8")
      );
      logger.info(
        `[Cache] Loaded persisted table field cache (${
          Object.keys(loadedTableCache).length
        } tables).`
      );
    }
    if (fs.existsSync(pageCacheFilePath)) {
      loadedPageCache = JSON.parse(
        await fs.promises.readFile(pageCacheFilePath, "utf8")
      );
      logger.info(
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
    logger.error("[Cache] Error loading persisted field cache/metadata:", err);
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
          logger.error(
            `[Cache] Error reading app.json at ${appJsonPath}:`,
            appJsonErr
          );
        }
      } else {
        logger.warn(
          `[Cache] app.json not found in workspace root: ${rootPath}`
        );
      }
    } else {
      logger.warn("[Cache] No workspace folder found to determine app name.");
    }

    if (!srcExtractionPath) {
      logger.warn(
        "[Cache] srcExtractionPath not configured. Field cache update skipped."
      );
      return;
    }

    // Get the configured log level
    const logLevel = config.get("logLevel", "normal");

    const workerOptions = {
      srcExtractionPath,
      globalStoragePath,
      appName,
      logLevel, // Pass the log level to the worker
    };

    // Get worker instance and send message
    const worker = getSymbolCacheWorker(); // Need to ensure this function exists and returns the worker process
    if (worker) {
      logger.info("[Cache] Sending updateFieldCache message to worker.");
      worker.send({ type: "updateFieldCache", options: workerOptions });

      // Add message handler for worker responses *here* or ensure it's handled elsewhere
      // Example: worker.on('message', handleWorkerFieldCacheMessage);
    } else {
      logger.error(
        "[Cache] Could not get symbol cache worker instance to update field cache."
      );
    }
  } catch (err) {
    logger.error("[Cache] Error triggering field cache worker update:", err);
    vscode.window.showErrorMessage(
      `Failed to trigger field cache update: ${err.message}`
    );
  }
}

/**
 * Find all AL files in the workspace
 * @returns {Promise<string[]>} Array of AL file paths
 */
async function findWorkspaceAlFiles() {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }

  const alFiles = [];

  for (const folder of vscode.workspace.workspaceFolders) {
    try {
      const folderPath = folder.uri.fsPath;
      const pattern = new vscode.RelativePattern(folderPath, "**/*.al");
      const files = await vscode.workspace.findFiles(
        pattern,
        "**/node_modules/**"
      );

      files.forEach((file) => {
        alFiles.push(file.fsPath);
      });
    } catch (error) {
      logger.error(
        `[Cache] Error finding AL files in workspace folder ${folder.uri.fsPath}:`,
        error
      );
    }
  }

  logger.info(`[Cache] Found ${alFiles.length} AL files in workspace`);
  return alFiles;
}

/**
 * Process AL files in the workspace and add their symbols/procedures to the cache
 * @returns {Promise<void>}
 */
async function processWorkspaceAlFiles() {
  try {
    const alFiles = await findWorkspaceAlFiles();

    if (alFiles.length === 0) {
      logger.info("[Cache] No AL files found in workspace");
      return;
    }

    logger.info(`[Cache] Processing ${alFiles.length} AL files...`);
    let symbolsAdded = 0;
    let proceduresAdded = 0;

    for (const filePath of alFiles) {
      try {
        const content = await fs.promises.readFile(filePath, "utf8");

        // Extract object definition
        const objectDef = getObjectDefinition(content);
        if (objectDef) {
          // Add to symbols cache
          symbolCache.symbols[objectDef.Name] = objectDef;
          symbolsAdded++;

          // Extract procedures
          const proceduresResult = extractProceduresFromObjects(filePath);
          if (proceduresResult && proceduresResult.procedures.length > 0) {
            symbolCache.setProcedures(
              proceduresResult.objectType,
              proceduresResult.objectName,
              proceduresResult.procedures
            );
            proceduresAdded += proceduresResult.procedures.length;
          }
        }
      } catch (fileError) {
        logger.error(
          `[Cache] Error processing AL file ${filePath}:`,
          fileError
        );
      }
    }

    logger.info(
      `[Cache] Added ${symbolsAdded} symbols and ${proceduresAdded} procedures from AL files`
    );
  } catch (error) {
    logger.error("[Cache] Error processing workspace AL files:", error);
  }
}

/**
 * Process a single AL file and update the cache
 * @param {string} filePath - Path to the AL file
 * @returns {Promise<boolean>} - True if the cache was updated
 */
async function processAlFile(filePath) {
  try {
    if (!filePath || !filePath.toLowerCase().endsWith(".al")) {
      return false;
    }

    const content = await fs.promises.readFile(filePath, "utf8");

    // Extract object definition
    const objectDef = getObjectDefinition(content);
    if (!objectDef) {
      return false;
    }

    // Add to symbols cache
    symbolCache.symbols[objectDef.Name] = objectDef;

    // Extract procedures
    const proceduresResult = extractProceduresFromObjects(filePath);
    if (proceduresResult && proceduresResult.procedures.length > 0) {
      symbolCache.setProcedures(
        proceduresResult.objectType,
        proceduresResult.objectName,
        proceduresResult.procedures
      );
    }

    return true;
  } catch (error) {
    logger.error(`[Cache] Error processing AL file ${filePath}:`, error);
    return false;
  }
}

module.exports = {
  initializeSymbolCache,
  updateSymbolCacheForFile,
  initializeFieldCache,
  processWorkspaceAlFiles,
  processAlFile,
  findWorkspaceAlFiles,
};
