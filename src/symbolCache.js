const fs = require("fs");
const path = require("path");
const util = require("util");
const os = require("os");
const vscode = require("vscode");
const { fork } = require("child_process");
const { readJsonFile } = require("./jsonUtils");

const configManager = require("./utils/configManager");
const { getSrcExtractionPath } = require("./utils/configManager");
const { logger } = require("./utils/logger");

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const mkdir = util.promisify(fs.mkdir);
const fieldCollector = require("./utils/fieldCollector");

class SymbolCache {
  constructor() {
    this.cachePath = path.join(
      os.tmpdir(),
      "bc_al_upgradeassistant",
      "symbolcache"
    );
    this.extractPath = path.join(
      os.tmpdir(),
      "bc_al_upgradeassistant",
      "extract"
    );
    this.metadataPath = path.join(this.cachePath, "cache_metadata.json");
    // Add per-app cache paths
    this.appCachesPath = path.join(this.cachePath, "app_caches");
    this.symbols = {};
    this.procedures = {}; // Store procedures by objectType:objectName
    this.metadata = {}; // Store { appPath: { mtimeMs: number } }
    this.dependencies = []; // Store app version dependencies from app.json
    this.appPaths = [];
    this.isRefreshing = false; // Tracks if symbol refresh is active
  }

  async initialize(appPaths = []) {
    this.appPaths = appPaths || [];
    await this.loadDependencies(); // Load dependencies first

    // Ensure cache directories exist
    try {
      await mkdir(this.cachePath, { recursive: true });
      await mkdir(this.extractPath, { recursive: true });
      await mkdir(this.appCachesPath, { recursive: true });
    } catch (err) {
      // Ignore EEXIST, log others
      if (err.code !== "EEXIST") {
        logger.error("Error creating cache directories:", err);
        vscode.window.showErrorMessage(
          `Failed to create cache directories: ${err.message}`
        );
      }
    }

    await this.loadCache(); // Load symbols, procedures, metadata
    ensureWorkerIsRunning(); // Ensure worker is running after loading cache
  }

  // Get app-specific cache file paths
  getAppCachePaths(appPath) {
    const appFileName = path.basename(appPath);
    const appCacheDir = path.join(
      this.appCachesPath,
      appFileName.replace(/\./g, "_")
    );
    return {
      symbolsPath: path.join(appCacheDir, "symbols.json"),
      proceduresPath: path.join(appCacheDir, "procedures.json"),
      metadataPath: path.join(appCacheDir, "metadata.json"),
    };
  }

  async loadCache() {
    try {
      // Load global metadata first
      if (fs.existsSync(this.metadataPath)) {
        const metadataData = await readFile(this.metadataPath, "utf8");
        this.metadata = JSON.parse(metadataData);
        logger.info("SymbolCache: Loaded metadata:", {
          appCount: Object.keys(this.metadata).length,
        });
      } else {
        logger.info("SymbolCache: No metadata file found.");
        this.metadata = {};
      }

      // Load each app's cache if it exists
      for (const appPath of this.appPaths) {
        await this.loadAppCache(appPath);
      }
    } catch (error) {
      logger.error("SymbolCache: Error loading cache:", error);
      this.symbols = {};
      this.procedures = {};
    }
  }

  async loadAppCache(appPath) {
    try {
      const { symbolsPath, proceduresPath } = this.getAppCachePaths(appPath);

      if (fs.existsSync(symbolsPath)) {
        const symbolsData = await readFile(symbolsPath, "utf8");
        const appSymbols = JSON.parse(symbolsData);
        // Merge with main symbols cache
        Object.assign(this.symbols, appSymbols);
        logger.info(
          `SymbolCache: Loaded symbols for ${path.basename(appPath)}:`,
          {
            count: Object.keys(appSymbols).length,
          }
        );
      }

      if (fs.existsSync(proceduresPath)) {
        const proceduresData = await readFile(proceduresPath, "utf8");
        const appProcedures = JSON.parse(proceduresData);
        // Merge with main procedures cache
        Object.assign(this.procedures, appProcedures);
        logger.info(
          `SymbolCache: Loaded procedures for ${path.basename(appPath)}:`,
          {
            count: Object.keys(appProcedures).length,
          }
        );
      }
    } catch (error) {
      logger.error(`SymbolCache: Error loading cache for ${appPath}:`, error);
    }
  }

  async saveCache() {
    try {
      const symbolsFilePath = path.join(this.cachePath, "symbols.json");
      const proceduresFilePath = path.join(this.cachePath, "procedures.json");

      // Use Promise.all for concurrent writes
      await Promise.all([
        writeFile(symbolsFilePath, JSON.stringify(this.symbols, null, 2)),
        writeFile(proceduresFilePath, JSON.stringify(this.procedures, null, 2)),
        writeFile(this.metadataPath, JSON.stringify(this.metadata, null, 2)), // Save metadata
      ]);
      logger.info("SymbolCache: Saved symbols, procedures, and metadata.");
      return true;
    } catch (error) {
      logger.error("Failed to save symbol cache:", error);
      vscode.window.showErrorMessage(
        `Failed to save symbol cache: ${error.message}`
      );
      return false;
    }
  }

  async clearCache() {
    logger.info("SymbolCache: Clearing cache and metadata.");
    this.symbols = {};
    this.procedures = {};
    this.metadata = {}; // Clear metadata object
    // Attempt to save the cleared state (which also removes/empties files)
    await this.saveCache();
  }

  // Procedure-related methods
  getProcedures(objectType, objectName) {
    const key = `${objectType}:${objectName}`;
    return this.procedures[key] || [];
  }

  setProcedures(objectType, objectName, procedures) {
    const key = `${objectType}:${objectName}`;
    this.procedures[key] = procedures;
  }

  getAllObjectsWithProcedures() {
    return Object.keys(this.procedures);
  }

  async refreshCacheInBackground() {
    if (this.isRefreshing || activeRefreshJobs.size > 0) {
      vscode.window.showInformationMessage(
        "Symbol cache refresh already in progress."
      );
      return;
    }
    if (!this.appPaths || this.appPaths.length === 0) {
      logger.info("[CacheRefresh] No app paths configured for symbol caching.");
      return;
    }

    this.isRefreshing = true;
    activeRefreshJobs.clear();
    let skippedCount = 0;
    let jobsSent = 0;

    const enableSrcExtraction = configManager.getConfigValue(
      "enableSrcExtraction",
      false
    );
    const srcExtractionPath = enableSrcExtraction
      ? await getSrcExtractionPath()
      : null;

    // Get the configured log level
    const logLevel = configManager.getConfigValue("logLevel", "normal");

    // Initialize the logger with the configured log level
    logger.setLogLevel(logLevel);

    if (enableSrcExtraction && !srcExtractionPath) {
      vscode.window.showWarningMessage(
        "Source extraction path not configured. Cannot extract sources."
      );
    }

    logger.info(
      `[CacheRefresh] Starting background refresh for ${this.appPaths.length} apps...`
    );
    ensureWorkerIsRunning();

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Refreshing AL Symbol Cache",
          cancellable: true,
        },
        async (progress, token) => {
          progressReporter = progress;
          progress.report({ increment: 0, message: "Checking apps..." });

          for (const appPath of this.appPaths) {
            if (token.isCancellationRequested) {
              console.log("[CacheRefresh] Cancellation requested.");
              break;
            }
            try {
              // Check if app version matches dependencies
              const appDir = path.dirname(appPath);
              const appVersion = this.getAppVersionFromPath(
                appDir,
                srcExtractionPath
              );
              if (
                appVersion &&
                this.dependencies.length > 0 &&
                !this.dependencies.includes(appVersion)
              ) {
                console.log(
                  `[CacheRefresh] Skipping ${path.basename(
                    appPath
                  )} - version ${appVersion} not in dependencies`
                );
                skippedCount++;
                continue;
              }

              // Check if app cache exists and is up to date
              const stats = await fs.promises.stat(appPath);
              const currentMtimeMs = stats.mtimeMs;
              const cachedMtimeMs = this.metadata[appPath]?.mtimeMs;
              const { symbolsPath, proceduresPath } =
                this.getAppCachePaths(appPath);
              const cacheExists =
                fs.existsSync(symbolsPath) && fs.existsSync(proceduresPath);

              if (
                cacheExists &&
                cachedMtimeMs &&
                currentMtimeMs === cachedMtimeMs
              ) {
                console.log(
                  `[CacheRefresh] Skipping ${path.basename(
                    appPath
                  )} - cache exists`
                );
                skippedCount++;
                continue;
              }

              // Track job
              activeRefreshJobs.set(appPath, { mtimeMs: currentMtimeMs });

              // Send message to worker with app-specific cache paths
              jobsSent++;
              workerInstance.send({
                type: "process",
                appPath,
                options: {
                  cachePath: this.cachePath,
                  extractPath: this.extractPath,
                  enableSrcExtraction,
                  srcExtractionPath,
                  appCachePath: path.dirname(symbolsPath),
                  logLevel, // Pass the configured log level to the worker
                },
              });
              progress.report({
                message: `Processing ${path.basename(
                  appPath
                )}... (${jobsSent}/${this.appPaths.length - skippedCount})`,
              });
            } catch (error) {
              console.error(
                `[CacheRefresh] Error processing ${appPath}:`,
                error
              );
            }
          }
          console.log(
            `[CacheRefresh] Finished sending messages. ${jobsSent} jobs sent, ${skippedCount} skipped.`
          );
          progress.report({ message: `Processing ${jobsSent} apps...` });

          if (activeRefreshJobs.size === 0) {
            console.log(
              "[CacheRefresh] No apps needed processing or all failed stats check."
            );
            checkRefreshCompletion(); // Will save cache, set isRefreshing=false etc.
          }
          // Otherwise, completion is handled by checkRefreshCompletion when last job finishes
        }
      );
    } catch (error) {
      console.error("[CacheRefresh] Error during withProgress:", error);
      vscode.window.showErrorMessage(
        `Symbol cache refresh failed: ${error.message}`
      );
      this.isRefreshing = false; // Ensure flag is reset on error
      progressReporter = null;
      activeRefreshJobs.clear(); // Clear jobs on error
    } finally {
      // Ensure isRefreshing is eventually set to false, handled by checkRefreshCompletion or error catch
    }
  }

  getObjectInfo(objectName) {
    const info = this.symbols[objectName] || null;
    console.log("SymbolCache: Getting object info:", {
      objectName,
      found: !!info,
      info,
    });
    return info;
  }

  getObjectId(objectName) {
    const obj = this.getObjectInfo(objectName);
    return obj ? obj.Id : null;
  }

  /**
   * Get app version by checking srcExtractionPath subdirectories
   * @param {string} appDir - Directory containing the .app file
   * @param {string} srcExtractionPath - Base path for extracted source files
   * @returns {string|null} - Version string or null if not found
   */
  getAppVersionFromPath(appDir, srcExtractionPath) {
    if (!srcExtractionPath || !fs.existsSync(srcExtractionPath)) {
      return null;
    }

    // Example path structure: srcExtractionPath/21.0.0.0/...
    const versionDirs = fs.readdirSync(srcExtractionPath).filter(
      (dir) =>
        fs.statSync(path.join(srcExtractionPath, dir)).isDirectory() &&
        /^\d+\.\d+\.\d+\.\d+$/.test(dir) // Only include version-like directories
    );

    // Find matching version directory
    for (const version of versionDirs) {
      if (appDir.includes(version)) {
        return version;
      }
    }
    return null;
  }

  /**
   * Load dependencies from app.json in workspace root
   */
  async loadDependencies() {
    try {
      if (!vscode.workspace.workspaceFolders?.length) {
        console.log("[SymbolCache] No workspace folders found");
        return;
      }

      const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const appJsonPath = path.join(rootPath, "app.json");

      if (!fs.existsSync(appJsonPath)) {
        console.log("[SymbolCache] No app.json found in workspace root");
        return;
      }

      const appJson = readJsonFile(appJsonPath);
      this.dependencies = appJson.dependencies?.map((dep) => dep.version) || [];
      console.log("[SymbolCache] Loaded dependencies:", this.dependencies);
    } catch (error) {
      console.error("[SymbolCache] Error loading dependencies:", error);
      this.dependencies = [];
    }
  }
}

// --- Instance Creation and Helper Functions ---

const symbolCacheInstance = new SymbolCache(); // Create the singleton instance

let workerInstance = null; // Module-level variable for the single worker
let activeRefreshJobs = new Map(); // Track ongoing app processing jobs { appPath: { mtimeMs: number } }
let progressReporter = null; // To hold the progress object from withProgress

/**
 * Handles messages received from the single worker process.
 * Updates the symbolCacheInstance state.
 * @param {object} message - The message object from the worker.
 */
function handleWorkerMessage(message) {
  // logger.verbose(`[Main] Received worker message: ${message.type}`); // Verbose logging

  if (!symbolCacheInstance) {
    logger.error(
      "[Main] handleWorkerMessage called before symbolCacheInstance is initialized."
    );
    return;
  }

  switch (message.type) {
    // --- Symbol Processing ---
    case "success":
      // logger.verbose(`[Main] Worker success for ${path.basename(message.appPath || 'N/A')}`); // Verbose
      // Update instance state
      Object.assign(symbolCacheInstance.symbols, message.symbols);
      Object.assign(symbolCacheInstance.procedures, message.procedures);

      // Update metadata using mtime stored when the job started
      if (activeRefreshJobs.has(message.appPath)) {
        const jobInfo = activeRefreshJobs.get(message.appPath);
        symbolCacheInstance.metadata[message.appPath] = {
          mtimeMs: jobInfo.mtimeMs,
        };
        activeRefreshJobs.delete(message.appPath); // Mark job as complete
        // logger.verbose(`[Main] Completed symbol job for ${path.basename(message.appPath)}. Remaining jobs: ${activeRefreshJobs.size}`); // Verbose
        checkRefreshCompletion(); // Check if all jobs are done
      } else {
        logger.warn(
          `[Main] Received success for untracked/already completed job: ${message.appPath}`
        );
      }
      break;
    case "error":
      logger.error(
        `[Main] Worker error for ${message.appPath || "N/A"}: ${
          message.message
        }`,
        message.stack
      );
      if (!message.message?.toLowerCase().includes("is this a zip file")) {
        // Don't show user error for non-zip files
        vscode.window.showErrorMessage(
          `Error processing ${path.basename(message.appPath || "App")}: ${
            message.message?.trim() || "Unknown error"
          }`,
          { modal: false, detail: message.stack } // Keep showing details
        );
      }
      // Mark job as complete even on error to avoid hanging
      if (activeRefreshJobs.has(message.appPath)) {
        activeRefreshJobs.delete(message.appPath);
        // logger.verbose(`[Main] Completed symbol job (with error) for ${path.basename(message.appPath)}. Remaining jobs: ${activeRefreshJobs.size}`); // Verbose
        checkRefreshCompletion();
      } else {
        logger.warn(
          `[Main] Received error for untracked/already completed job: ${message.appPath}`
        );
      }
      break;
    case "progress":
      // Update progress UI if the reporter is available
      if (progressReporter) {
        progressReporter.report({ message: message.message });
      }
      break;
    case "warning":
      logger.warn(
        `[Main] Worker warning for ${message.appPath || "N/A"}: ${
          message.message
        }`
      );
      vscode.window.showWarningMessage(
        // Keep showing warnings
        `Warning processing ${path.basename(message.appPath || "App")}: ${
          message.message
        }`
      );
      break;

    // --- Field Cache Processing ---
    case "fieldCacheData":
      logger.info(
        `[Main] Received field cache data. Tables: ${
          Object.keys(message.tableFieldsCache || {}).length
        }, Pages: ${Object.keys(message.pageSourceTableCache || {}).length}`
      );
      // Update in-memory cache via fieldCollector setters
      fieldCollector.setTableFieldsCache(message.tableFieldsCache);
      fieldCollector.setPageSourceTableCache(message.pageSourceTableCache);
      break;
    case "fieldCacheError":
      logger.error(`[Main] Field cache worker error: ${message.message}`);
      vscode.window.showErrorMessage(
        `Field cache update failed: ${message.message}`
      );
      break;

    default:
      logger.warn(
        `[Main] Received unknown worker message type: ${message.type}`
      );
  }
}

/**
 * Checks if all tracked symbol refresh jobs are complete and saves the cache if so.
 */
async function checkRefreshCompletion() {
  if (
    symbolCacheInstance &&
    symbolCacheInstance.isRefreshing &&
    activeRefreshJobs.size === 0
  ) {
    logger.info("[Main] All symbol refresh jobs completed.");
    await symbolCacheInstance.saveCache(); // Save the final state
    symbolCacheInstance.isRefreshing = false;
    progressReporter = null; // Clear reporter
    vscode.window.setStatusBarMessage("Symbol cache refresh complete.", 5000);
  }
}

/**
 * Ensures the single worker process is running and attaches the message handler.
 */
function ensureWorkerIsRunning() {
  if (workerInstance && !workerInstance.killed && workerInstance.connected) {
    // logger.verbose('[Main] Worker already running.');
    return; // Worker is active
  }

  logger.info("[Main] Starting symbol/field cache worker...");
  const workerPath = path.join(__dirname, "symbolCacheWorker.js");
  workerInstance = fork(workerPath, [], { stdio: "pipe", execArgv: [] });

  // Set the log level in the worker
  const logLevel = configManager.getConfigValue("logLevel", "normal");
  workerInstance.send({
    type: "setLogLevel",
    logLevel,
  });

  workerInstance.on("message", handleWorkerMessage);

  workerInstance.on("exit", (code) => {
    logger.error(`[Main] Worker exited with code ${code}`);
    workerInstance = null; // Reset instance so it can be restarted
    // Optionally notify user or attempt restart
    vscode.window.showErrorMessage(
      `Symbol/Field Cache worker process stopped unexpectedly (code ${code}). Some features might be unavailable until restart.`
    );
  });

  workerInstance.on("error", (err) => {
    logger.error("[Main] Worker failed to start or crashed:", err);
    workerInstance = null; // Reset instance
    vscode.window.showErrorMessage(
      `Symbol/Field Cache worker process failed: ${err.message}`
    );
  });

  workerInstance.stdout.on("data", (data) =>
    logger.verbose(`Worker stdout: ${data}`)
  );
  workerInstance.stderr.on("data", (data) =>
    logger.error(`Worker stderr: ${data}`)
  );

  logger.info("[Main] Worker started.");
}

/**
 * Gets the current worker instance. Used by cacheHelper.
 * @returns {ChildProcess | null} The worker process instance or null.
 */
function getSymbolCacheWorker() {
  return workerInstance;
}

// --- Exports ---
module.exports = symbolCacheInstance; // Export the singleton instance
module.exports.getSymbolCacheWorker = getSymbolCacheWorker;
module.exports.ensureWorkerIsRunning = ensureWorkerIsRunning;
