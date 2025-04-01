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
const readdir = util.promisify(fs.readdir); // Re-enabled for checkIfAppCanBeSkipped

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
    this.symbols = {};
    this.procedures = {}; // Store procedures by objectType:objectName
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

      if (fs.existsSync(symbolsFilePath)) {
        const symbolsData = await readFile(symbolsFilePath, "utf8");
        this.symbols = JSON.parse(symbolsData);
      }

      if (fs.existsSync(proceduresFilePath)) {
        const proceduresData = await readFile(proceduresFilePath, "utf8");
        this.procedures = JSON.parse(proceduresData);
      }

      return true;
    } catch (error) {
      console.error("Failed to load symbol cache:", error);
    }
    return false;
  }

  async saveCache() {
    try {
      const symbolsFilePath = path.join(this.cachePath, "symbols.json");
      const proceduresFilePath = path.join(this.cachePath, "procedures.json");

      await writeFile(symbolsFilePath, JSON.stringify(this.symbols, null, 2));
      await writeFile(
        proceduresFilePath,
        JSON.stringify(this.procedures, null, 2)
      );
      return true;
    } catch (error) {
      console.error("Failed to save symbol cache:", error);
      vscode.window.showErrorMessage(
        `Failed to save symbol cache: ${error.message}`
      );
      return false;
    }
  }

  clearCache() {
    this.symbols = {};
    this.procedures = {};
    this.saveCache();
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
    const newSymbols = {}; // Accumulate symbols from workers here

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

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window, // changed from Notification to Window
          title: "Refreshing AL Symbol Cache",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0, message: "Starting..." });

          const workerPromises = this.appPaths.map((appPath) =>
            // First check if we can skip this app
            this.checkIfAppCanBeSkipped(
              appPath,
              enableSrcExtraction,
              srcExtractionPath
            ).then((skipApp) => {
              if (skipApp) {
                processedCount++;
                const increment = (1 / totalApps) * 100;
                progress.report({
                  increment,
                  message: `Skipped ${path.basename(
                    appPath
                  )} (already processed)...`,
                });
                return Promise.resolve();
              }

              // If not skipping, create and handle the worker
              return new Promise((resolve) => {
                const workerPath = path.join(__dirname, "symbolCacheWorker.js");

                // Create worker with inspector disabled to avoid port conflicts
                const worker = fork(workerPath, [], {
                  stdio: "pipe",
                  execArgv: [], // Prevent inspector inheritance
                });

                // Handle messages from worker
                worker.on("message", (message) => {
                  switch (message.type) {
                    case "success":
                      Object.assign(newSymbols, message.symbols);
                      if (message.procedures) {
                        Object.assign(this.procedures, message.procedures);
                      }
                      break;
                    case "error":
                      console.error(
                        `Worker error for ${message.appPath}: ${message.message}`,
                        message.stack
                      );
                      // Filter out specific known non-critical errors
                      const isZipFileError = message.message
                        .toLowerCase()
                        .includes("is this a zip file");
                      if (!isZipFileError) {
                        const errorMessage = `Error processing ${path.basename(
                          message.appPath
                        )}: ${message.message.trim()}`;
                        vscode.window.showErrorMessage(errorMessage, {
                          modal: false,
                          detail: message.stack,
                        });
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

                // Handle worker exit
                worker.on("exit", (code) => {
                  processedCount++;
                  const increment = (1 / totalApps) * 100;
                  progress.report({
                    increment,
                    message: `Processed ${processedCount}/${totalApps} apps...`,
                  });
                  if (code !== 0) {
                    console.error(
                      `Worker for ${appPath} exited with code ${code}`
                    );
                    vscode.window.showErrorMessage(
                      `Worker for ${path.basename(
                        appPath
                      )} exited unexpectedly.`
                    );
                  }
                  resolve();
                });

                // Handle worker errors
                worker.on("error", (err) => {
                  processedCount++;
                  console.error(`Failed to start worker for ${appPath}:`, err);
                  vscode.window.showErrorMessage(
                    `Failed to start worker for ${path.basename(appPath)}: ${
                      err.message
                    }`
                  );
                  const increment = (1 / totalApps) * 100;
                  progress.report({
                    increment,
                    message: `Processed ${processedCount}/${totalApps} apps...`,
                  });
                  resolve();
                });

                // Handle worker stdout/stderr
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

                // Send initial message to worker
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
              });
            })
          );

          // Wait for all workers to complete
          await Promise.all(workerPromises);

          // Update main symbols and procedures objects and save cache
          this.symbols = newSymbols;
          await this.saveCache();

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

  async checkIfAppCanBeSkipped(
    appPath,
    enableSrcExtraction,
    srcExtractionPath
  ) {
    if (!enableSrcExtraction || !srcExtractionPath) {
      return false;
    }

    try {
      // Calculate the expected source extraction directory path
      const fileName = path.parse(appPath).name;
      if (!fileName) return false;

      const nameParts = fileName.split("_");
      const extractedAppName =
        nameParts.length > 1 ? nameParts[1] || "Unknown" : fileName;
      const extractedAppVersion =
        nameParts.length > 2 ? nameParts[2] || "1.0" : "1.0";
      const sanitizedAppName = extractedAppName.replace(/[<>:"/\\|?*]/g, "_");
      const extractDir = path.join(
        srcExtractionPath,
        sanitizedAppName,
        extractedAppVersion
      );

      // Check if target directory exists and contains AL files
      if (fs.existsSync(extractDir)) {
        const files = await readdir(extractDir);
        return files.some((file) => file.endsWith(".al"));
      }
    } catch (err) {
      console.error(`Error checking if app can be skipped: ${err.message}`);
    }

    return false;
  }

  // Removed promptForSrcPath() as it's now in configManager.js

  getObjectInfo(objectName) {
    return this.symbols[objectName] || null;
  }

  getObjectId(objectName) {
    const obj = this.getObjectInfo(objectName);
    return obj ? obj.Id : null;
  }
}

module.exports = new SymbolCache();
