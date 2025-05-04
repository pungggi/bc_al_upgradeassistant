const fs = require("fs");
const path = require("path");
const util = require("util");
const os = require("os");
const vscode = require("vscode");
const { fork } = require("child_process");
const { readJsonFile } = require("./jsonUtils");

const configManager = require("./utils/configManager");

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
    } catch (err) {
      // Ignore EEXIST, log others
      if (err.code !== "EEXIST") {
        console.error("Error creating cache/extract directories:", err);
        vscode.window.showErrorMessage(
          `Failed to create cache directories: ${err.message}`
        );
      }
    }

    await this.loadCache(); // Load symbols, procedures, metadata
    ensureWorkerIsRunning(); // Ensure worker is running after loading cache
  }

  async loadCache() {
    try {
      const symbolsFilePath = path.join(this.cachePath, "symbols.json");
      const proceduresFilePath = path.join(this.cachePath, "procedures.json");

      console.log("SymbolCache: Loading cache from:", {
        symbolsPath: symbolsFilePath,
        proceduresPath: proceduresFilePath,
        metadataPath: this.metadataPath,
      });

      // Load Symbols
      if (fs.existsSync(symbolsFilePath)) {
        const symbolsData = await readFile(symbolsFilePath, "utf8");
        this.symbols = JSON.parse(symbolsData);
        console.log("SymbolCache: Loaded symbols:", {
          count: Object.keys(this.symbols).length,
        });
      } else {
        console.log("SymbolCache: No symbols file found.");
        this.symbols = {};
      }

      // Load Procedures
      if (fs.existsSync(proceduresFilePath)) {
        const proceduresData = await readFile(proceduresFilePath, "utf8");
        this.procedures = JSON.parse(proceduresData);
        console.log("SymbolCache: Loaded procedures:", {
          count: Object.keys(this.procedures).length,
        });
      } else {
        console.log("SymbolCache: No procedures file found.");
        this.procedures = {};
      }

      // Load Metadata
      if (fs.existsSync(this.metadataPath)) {
        const metadataData = await readFile(this.metadataPath, "utf8");
        this.metadata = JSON.parse(metadataData);
        console.log("SymbolCache: Loaded metadata:", {
          count: Object.keys(this.metadata).length,
        });
      } else {
        console.log("SymbolCache: No metadata file found.");
        this.metadata = {};
      }

      return true;
    } catch (error) {
      console.error("Failed to load symbol cache:", error);
      // Reset caches on load error to prevent using corrupted data
      this.symbols = {};
      this.procedures = {};
      this.metadata = {};
    }
    return false;
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
      console.log("SymbolCache: Saved symbols, procedures, and metadata.");
      return true;
    } catch (error) {
      console.error("Failed to save symbol cache:", error);
      vscode.window.showErrorMessage(
        `Failed to save symbol cache: ${error.message}`
      );
      return false;
    }
  }

  async clearCache() {
    console.log("SymbolCache: Clearing cache and metadata.");
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
    // Use the new logic with single worker and message passing
    if (this.isRefreshing || activeRefreshJobs.size > 0) {
      vscode.window.showInformationMessage(
        "Symbol cache refresh already in progress."
      );
      return;
    }
    if (!this.appPaths || this.appPaths.length === 0) {
      console.log("[CacheRefresh] No app paths configured for symbol caching.");
      return;
    }

    this.isRefreshing = true; // Mark as refreshing
    activeRefreshJobs.clear(); // Clear previous job tracking
    let skippedCount = 0;
    let jobsSent = 0;

    // Get srcExtractionPath using the new centralized function
    const { getSrcExtractionPath } = require("./utils/configManager");
    const enableSrcExtraction = configManager.getConfigValue(
      "enableSrcExtraction",
      false
    );
    const srcExtractionPath = enableSrcExtraction
      ? await getSrcExtractionPath()
      : null; // Use await here

    if (enableSrcExtraction && !srcExtractionPath) {
      vscode.window.showWarningMessage(
        "Source extraction path not configured. Cannot extract sources."
      );
    }

    console.log(
      `[CacheRefresh] Starting background refresh for ${this.appPaths.length} apps...`
    );
    ensureWorkerIsRunning(); // Ensure worker is ready

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Refreshing AL Symbol Cache",
          cancellable: true,
        },
        async (progress, token) => {
          progressReporter = progress; // Store for handleWorkerMessage
          progress.report({ increment: 0, message: "Checking apps..." });

          for (const appPath of this.appPaths) {
            if (token.isCancellationRequested) {
              console.log("[CacheRefresh] Cancellation requested.");
              break;
            }
            try {
              // Check if app version matches dependencies
              const appDir = path.dirname(appPath);
              const srcExtractionPath = await getSrcExtractionPath();

              // Skip if app version is not in dependencies
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

              const stats = await fs.promises.stat(appPath);
              const currentMtimeMs = stats.mtimeMs;
              const cachedMtimeMs = this.metadata[appPath]?.mtimeMs;

              if (cachedMtimeMs && currentMtimeMs === cachedMtimeMs) {
                console.log(
                  `[CacheRefresh] Skipping ${path.basename(
                    appPath
                  )} - unchanged mtime`
                );
                skippedCount++;
                continue;
              }

              // Track job
              activeRefreshJobs.set(appPath, { mtimeMs: currentMtimeMs });

              // Optional delay (consider removing or making very short)
              const config = vscode.workspace.getConfiguration(
                "bc-al-upgradeassistant"
              );
              let processingDelay = config.get(
                "symbolCache.processingDelay",
                0
              ); // Default to 0 delay
              if (typeof processingDelay !== "number" || processingDelay < 0)
                processingDelay = 0;
              if (processingDelay > 0) {
                // console.log(`[CacheRefresh] Applying ${processingDelay}ms delay for ${path.basename(appPath)}`); // Verbose
                await new Promise((resolveDelay) =>
                  setTimeout(resolveDelay, processingDelay)
                );
              }

              // Track job and send message
              jobsSent++;
              workerInstance.send({
                type: "process",
                appPath,
                options: {
                  cachePath: this.cachePath,
                  extractPath: this.extractPath,
                  enableSrcExtraction,
                  srcExtractionPath,
                },
              });
              progress.report({
                message: `Processing ${path.basename(
                  appPath
                )}... (${jobsSent}/${this.appPaths.length - skippedCount})`,
              });
            } catch (statError) {
              console.error(
                `[CacheRefresh] Error getting stats for ${appPath}:`,
                statError
              );
              // Optionally remove from metadata if file is inaccessible?
              // delete this.metadata[appPath];
            }
          } // End for loop

          console.log(
            `[CacheRefresh] Finished sending messages. ${jobsSent} jobs sent, ${skippedCount} skipped.`
          );
          progress.report({ message: `Processing ${jobsSent} apps...` });

          // If no jobs were sent (all skipped or errors), complete immediately
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
  // console.log(`[Main] Received worker message: ${message.type}`); // Verbose logging

  if (!symbolCacheInstance) {
    console.error(
      "[Main] handleWorkerMessage called before symbolCacheInstance is initialized."
    );
    return;
  }

  switch (message.type) {
    // --- Symbol Processing ---
    case "success":
      // console.log(`[Main] Worker success for ${path.basename(message.appPath || 'N/A')}`); // Verbose
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
        // console.log(`[Main] Completed symbol job for ${path.basename(message.appPath)}. Remaining jobs: ${activeRefreshJobs.size}`); // Verbose
        checkRefreshCompletion(); // Check if all jobs are done
      } else {
        console.warn(
          `[Main] Received success for untracked/already completed job: ${message.appPath}`
        );
      }
      break;
    case "error":
      console.error(
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
        // console.log(`[Main] Completed symbol job (with error) for ${path.basename(message.appPath)}. Remaining jobs: ${activeRefreshJobs.size}`); // Verbose
        checkRefreshCompletion();
      } else {
        console.warn(
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
      console.warn(
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
      console.log(
        `[Main] Received field cache data. Tables: ${
          Object.keys(message.tableFieldsCache || {}).length
        }, Pages: ${Object.keys(message.pageSourceTableCache || {}).length}`
      );
      // Update in-memory cache via fieldCollector setters
      fieldCollector.setTableFieldsCache(message.tableFieldsCache);
      fieldCollector.setPageSourceTableCache(message.pageSourceTableCache);
      break;
    case "fieldCacheError":
      console.error(`[Main] Field cache worker error: ${message.message}`);
      vscode.window.showErrorMessage(
        `Field cache update failed: ${message.message}`
      );
      break;

    default:
      console.warn(
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
    console.log("[Main] All symbol refresh jobs completed.");
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
    // console.log('[Main] Worker already running.');
    return; // Worker is active
  }

  console.log("[Main] Starting symbol/field cache worker...");
  const workerPath = path.join(__dirname, "symbolCacheWorker.js");
  workerInstance = fork(workerPath, [], { stdio: "pipe", execArgv: [] });

  workerInstance.on("message", handleWorkerMessage);

  workerInstance.on("exit", (code) => {
    console.error(`[Main] Worker exited with code ${code}`);
    workerInstance = null; // Reset instance so it can be restarted
    // Optionally notify user or attempt restart
    vscode.window.showErrorMessage(
      `Symbol/Field Cache worker process stopped unexpectedly (code ${code}). Some features might be unavailable until restart.`
    );
  });

  workerInstance.on("error", (err) => {
    console.error("[Main] Worker failed to start or crashed:", err);
    workerInstance = null; // Reset instance
    vscode.window.showErrorMessage(
      `Symbol/Field Cache worker process failed: ${err.message}`
    );
  });

  workerInstance.stdout.on("data", (data) =>
    console.log(`Worker stdout: ${data}`)
  );
  workerInstance.stderr.on("data", (data) =>
    console.error(`Worker stderr: ${data}`)
  );

  console.log("[Main] Worker started.");
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
