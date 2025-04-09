const fs = require("fs");
const path = require("path");
const util = require("util");
const os = require("os");
const vscode = require("vscode");
const { fork } = require("child_process"); // Added fork
const configManager = require("./utils/configManager");
const { getSrcExtractionPath } = require("./utils/configManager"); // Import the new function

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const mkdir = util.promisify(fs.mkdir);
// const readdir = util.promisify(fs.readdir); // No longer needed here

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
    this.metadataPath = path.join(this.cachePath, "cache_metadata.json"); // Path for metadata
    this.symbols = {};
    this.procedures = {}; // Store procedures by objectType:objectName
    this.metadata = {}; // Store { appPath: { mtimeMs: number } }
    this.appPaths = [];
    this.isRefreshing = false;
  }

  async initialize(appPaths = []) {
    this.appPaths = appPaths;

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

    await this.loadCache();
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
    if (this.isRefreshing) {
      vscode.window.showInformationMessage(
        "Symbol cache refresh already in progress."
      );
      return;
    }
    if (!this.appPaths || this.appPaths.length === 0) {
      console.log("No app paths configured for symbol caching.");
      return;
    }

    this.isRefreshing = true;
    const totalApps = this.appPaths.length;
    let processedCount = 0;
    let skippedCount = 0; // Initialize skipped count
    const newSymbols = {}; // Accumulate symbols from workers here
    const newProcedures = {}; // Accumulate procedures from workers here
    const updatedMetadataEntries = {}; // Track metadata updates for this run

    // Get srcExtractionPath using the new centralized function
    const enableSrcExtraction = configManager.getConfigValue(
      "enableSrcExtraction",
      false
    );
    const srcExtractionPath = enableSrcExtraction
      ? await getSrcExtractionPath() // This handles prompting and saving
      : null;

    // If extraction is enabled but path is still null (e.g., user cancelled prompt), show warning
    if (enableSrcExtraction && !srcExtractionPath) {
      vscode.window.showWarningMessage(
        "Source extraction path not configured or provided. Cannot extract sources from .app files."
      );
      // Continue without extraction for .app files
    }

    console.log("[CacheRefresh] Starting background refresh...");
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Refreshing AL Symbol Cache",
          cancellable: false,
        },
        async (progress) => {
          console.log("[CacheRefresh] Progress reported, starting workers..."); // Log progress start
          progress.report({ increment: 0, message: "Starting..." });

          const workerPromises = this.appPaths.map((appPath) => {
            return new Promise((resolve) => {
              // Removed async from executor
              // IIAFE to handle async operations safely
              (async () => {
                let currentMtimeMs; // Declare here to be accessible later
                try {
                  // --- Optimization Start ---
                  const stats = await fs.promises.stat(appPath);
                  currentMtimeMs = stats.mtimeMs; // Assign here
                  const cachedMtimeMs = this.metadata[appPath]?.mtimeMs;

                  if (cachedMtimeMs && currentMtimeMs === cachedMtimeMs) {
                    console.log(
                      `[CacheRefresh] Skipping ${path.basename(
                        appPath
                      )} - already cached and unchanged.`
                    );
                    skippedCount++;
                    processedCount++; // Increment processed count even for skipped files
                    const increment = (1 / totalApps) * 100;
                    progress.report({
                      increment,
                      message: `Processed ${processedCount}/${totalApps} apps (skipped ${skippedCount})...`,
                    });
                    resolve(); // Resolve outer promise immediately
                    return; // Exit IIAFE
                  }
                  // --- Optimization End ---

                  // --- Add Configurable Delay Start ---
                  const isNewOrChanged = !(
                    cachedMtimeMs && currentMtimeMs === cachedMtimeMs
                  );
                  if (isNewOrChanged) {
                    const config = vscode.workspace.getConfiguration(
                      "bc-al-upgradeassistant"
                    );
                    let processingDelay = config.get(
                      "symbolCache.processingDelay",
                      25000
                    );
                    if (
                      typeof processingDelay !== "number" ||
                      processingDelay < 100
                    ) {
                      console.warn(
                        `[CacheRefresh] Invalid processingDelay value (${processingDelay}). Using default 25000ms.`
                      );
                      processingDelay = 25000;
                    }
                    console.log(
                      `[CacheRefresh] Applying ${processingDelay}ms delay for new/changed app: ${path.basename(
                        appPath
                      )}`
                    );
                    await new Promise((resolveDelay) =>
                      setTimeout(resolveDelay, processingDelay)
                    );
                    console.log(
                      `[CacheRefresh] Delay finished for: ${path.basename(
                        appPath
                      )}`
                    );
                  }
                  // --- Add Delay End ---

                  const workerPath = path.join(
                    __dirname,
                    "symbolCacheWorker.js"
                  );
                  const worker = fork(workerPath, [], {
                    stdio: "pipe",
                    execArgv: [],
                  });

                  let workerSucceeded = false;

                  worker.on("message", (message) => {
                    switch (message.type) {
                      case "success":
                        console.log(
                          `[CacheRefresh] Worker success for ${path.basename(
                            message.appPath
                          )}. Symbols: ${
                            Object.keys(message.symbols || {}).length
                          }, Procedures: ${
                            Object.keys(message.procedures || {}).length
                          }`
                        );
                        Object.assign(newSymbols, message.symbols);
                        if (message.procedures) {
                          Object.assign(newProcedures, message.procedures);
                        }
                        // Store metadata only if worker succeeded
                        updatedMetadataEntries[message.appPath] = {
                          mtimeMs: currentMtimeMs, // Use currentMtimeMs captured in IIAFE scope
                        };
                        workerSucceeded = true;
                        break;
                      case "error":
                        console.error(
                          `Worker error for ${message.appPath}: ${message.message}`,
                          message.stack
                        );
                        if (
                          !message.message
                            ?.toLowerCase()
                            .includes("is this a zip file")
                        ) {
                          vscode.window.showErrorMessage(
                            `Error processing ${path.basename(
                              message.appPath
                            )}: ${message.message?.trim() || "Unknown error"}`,
                            { modal: false, detail: message.stack }
                          );
                        }
                        break;
                      case "progress":
                        progress.report({
                          message: `Processing ${path.basename(appPath)}: ${
                            message.message
                          }`,
                        });
                        break;
                      case "warning":
                        console.warn(
                          `Worker warning for ${appPath}: ${message.message}`
                        );
                        vscode.window.showWarningMessage(
                          `Warning processing ${path.basename(appPath)}: ${
                            message.message
                          }`
                        );
                        break;
                    }
                  });

                  worker.on("exit", (code) => {
                    processedCount++;
                    const increment = (1 / totalApps) * 100;
                    progress.report({
                      increment,
                      message: `Processed ${processedCount}/${totalApps} apps (skipped ${skippedCount})...`,
                    });
                    if (code !== 0 && !workerSucceeded) {
                      console.error(
                        `Worker for ${appPath} exited with code ${code}`
                      );
                      vscode.window.showErrorMessage(
                        `Worker for ${path.basename(
                          appPath
                        )} exited unexpectedly (code ${code}).`
                      );
                      // Ensure metadata isn't kept if worker failed after potentially succeeding initially
                      delete updatedMetadataEntries[appPath];
                    }
                    resolve(); // Resolve outer promise
                  });

                  worker.on("error", (err) => {
                    // This handles errors *starting* the worker (e.g., fork fails)
                    processedCount++;
                    console.error(
                      `Failed to start worker for ${appPath}:`,
                      err
                    );
                    vscode.window.showErrorMessage(
                      `Failed to start worker for ${path.basename(appPath)}: ${
                        err.message
                      }`
                    );
                    const increment = (1 / totalApps) * 100;
                    progress.report({
                      increment,
                      message: `Processed ${processedCount}/${totalApps} apps (skipped ${skippedCount})...`,
                    });
                    resolve(); // Resolve outer promise
                  });

                  worker.stdout.on("data", (data) =>
                    console.log(
                      `Worker stdout (${path.basename(appPath)}): ${data}`
                    )
                  );
                  worker.stderr.on("data", (data) =>
                    console.error(
                      `Worker stderr (${path.basename(appPath)}): ${data}`
                    )
                  );

                  // Send message to worker only after listeners are attached
                  worker.send({
                    type: "process",
                    appPath,
                    options: {
                      cachePath: this.cachePath,
                      extractPath: this.extractPath,
                      enableSrcExtraction,
                      srcExtractionPath,
                    },
                  });
                } catch (statError) {
                  // Handle error getting file stats (e.g., file deleted during refresh)
                  console.error(
                    `[CacheRefresh] Error getting stats for ${appPath}:`,
                    statError
                  );
                  processedCount++;
                  const increment = (1 / totalApps) * 100;
                  progress.report({
                    increment,
                    message: `Processed ${processedCount}/${totalApps} apps (skipped ${skippedCount})...`,
                  });
                  resolve(); // Resolve the outer promise even if stat fails
                }
              })(); // Invoke the IIAFE
            }); // Close Promise constructor call
          }); // Close map call

          // Wait for all workers to complete
          await Promise.all(workerPromises);

          // Update main symbols, procedures, and metadata objects, then save cache
          console.log(
            `[CacheRefresh] Finished processing workers. Found ${
              Object.keys(newSymbols).length
            } new symbols, ${
              Object.keys(newProcedures).length
            } new procedure sets. Skipped ${skippedCount} unchanged apps.`
          );

          // Merge new data with existing cache (important if skipping files)
          // Overwrite existing symbols/procedures for processed apps, keep others
          this.symbols = { ...this.symbols, ...newSymbols };
          this.procedures = { ...this.procedures, ...newProcedures };
          // Prune metadata for apps that are no longer in the configured appPaths
          const currentAppPathsSet = new Set(this.appPaths);
          const prunedMetadata = {};
          for (const appPath in this.metadata) {
            if (currentAppPathsSet.has(appPath)) {
              prunedMetadata[appPath] = this.metadata[appPath];
            } else {
              console.log(
                `[CacheRefresh] Pruning metadata for removed app: ${appPath}`
              );
            }
          }

          this.metadata = { ...prunedMetadata, ...updatedMetadataEntries }; // Update metadata after pruning and merging new entries

          // Optional: Prune metadata for apps that no longer exist in appPaths?
          // Could be done here by comparing Object.keys(this.metadata) with this.appPaths

          console.log(
            `[CacheRefresh] Updated main cache. Symbol count: ${
              Object.keys(this.symbols).length
            }, Procedure count: ${
              Object.keys(this.procedures).length
            }, Metadata count: ${Object.keys(this.metadata).length}`
          );

          await this.saveCache(); // Save symbols, procedures, AND metadata

          // Report final progress then return immediately
          progress.report({
            increment: 100,
            message: "Cache refresh complete",
          });
          return; // removed delay to ensure message disappears promptly
        }
      );
    } catch (error) {
      console.error("Error refreshing symbol cache:", error);
      vscode.window.showErrorMessage(
        `Symbol cache refresh failed: ${error.message}`
      );
    } finally {
      this.isRefreshing = false;
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
}

module.exports = new SymbolCache();
