const fs = require("fs");
const path = require("path");
const util = require("util");
const os = require("os");
const vscode = require("vscode");
const { fork } = require("child_process"); // Added fork
const configManager = require("./utils/configManager");

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
      const cacheFilePath = path.join(this.cachePath, "symbols.json");
      if (fs.existsSync(cacheFilePath)) {
        const cacheData = await readFile(cacheFilePath, "utf8");
        this.symbols = JSON.parse(cacheData);
        return true;
      }
    } catch (error) {
      console.error("Failed to load symbol cache:", error);
    }
    return false;
  }

  async saveCache() {
    try {
      const cacheFilePath = path.join(this.cachePath, "symbols.json");
      await writeFile(cacheFilePath, JSON.stringify(this.symbols, null, 2));
      return true;
    } catch (error) {
      console.error("Failed to save symbol cache:", error);
      vscode.window.showErrorMessage(
        `Failed to save symbol cache: ${error.message}`
      );
      return false;
    }
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
    let successCount = 0;
    let errorCount = 0;
    const newSymbols = {}; // Accumulate symbols from workers here

    // Check and potentially prompt for srcExtractionPath *before* starting workers
    const enableSrcExtraction = configManager.getConfigValue(
      "enableSrcExtraction",
      false
    );
    let srcExtractionPath = configManager.getConfigValue(
      "srcExtractionPath",
      ""
    );

    if (enableSrcExtraction && !srcExtractionPath) {
      srcExtractionPath = await this.promptForSrcPath();
      if (!srcExtractionPath) {
        vscode.window.showWarningMessage(
          "Source extraction cancelled. Proceeding without extracting sources."
        );
      } else {
        // Save the selected path for future use
        try {
          await configManager.setConfigValue(
            "srcExtractionPath",
            srcExtractionPath,
            "user"
          );
        } catch (err) {
          console.warn(
            `Failed to save srcExtractionPath setting: ${err.message}`
          );
          vscode.window.showWarningMessage(
            `Could not save source extraction path setting: ${err.message}`
          );
        }
      }
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
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
              console.log(`Skipping ${appPath}: Source files already exist`);
              processedCount++;
              successCount++;
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
                    successCount++;
                    break;
                  case "error":
                    errorCount++;
                    console.error(
                      `Worker error for ${message.appPath}: ${message.message}`,
                      message.stack
                    );
                    vscode.window.showErrorMessage(
                      `Error processing ${path.basename(message.appPath)}: ${
                        message.message
                      }`
                    );
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
                  errorCount++;
                  console.error(
                    `Worker for ${appPath} exited with code ${code}`
                  );
                  vscode.window.showErrorMessage(
                    `Worker for ${path.basename(appPath)} exited unexpectedly.`
                  );
                }
                resolve();
              });

              // Handle worker errors
              worker.on("error", (err) => {
                processedCount++;
                errorCount++;
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

        // Update main symbols object and save cache
        this.symbols = newSymbols;
        await this.saveCache();

        progress.report({ increment: 100, message: "Cache refresh complete." });
        vscode.window.showInformationMessage(
          `Symbol cache refresh finished. Processed: ${processedCount}, Success: ${successCount}, Errors: ${errorCount}.`
        );
      }
    );

    this.isRefreshing = false;
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

  async promptForSrcPath() {
    const options = {
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select folder for source extraction",
    };

    const result = await vscode.window.showOpenDialog(options);
    if (result && result.length > 0) {
      return result[0].fsPath;
    }
    vscode.window.showWarningMessage("Source extraction path not selected.");
    return null;
  }

  getObjectInfo(objectName) {
    return this.symbols[objectName] || null;
  }

  getObjectId(objectName) {
    const obj = this.getObjectInfo(objectName);
    return obj ? obj.Id : null;
  }
}

module.exports = new SymbolCache();
