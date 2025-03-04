const fs = require("fs");
const path = require("path");
const util = require("util");
const os = require("os");
const Seven = require("node-7z");
const sevenBin = require("7zip-bin");
const vscode = require("vscode");

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const mkdir = util.promisify(fs.mkdir);
const readdir = util.promisify(fs.readdir);
const rmdir = util.promisify(fs.rmdir);

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
    this._objectIdMap = new Map();
    this.initialize();
  }

  async initialize(appPaths = []) {
    this.appPaths = appPaths;

    // Ensure cache directory exists
    try {
      await mkdir(this.cachePath, { recursive: true });
      await mkdir(this.extractPath, { recursive: true });
    } catch (err) {
      if (err.code !== "EEXIST") {
        console.error("Error creating directories:", err);
      }
    }

    await this.loadCache();
    try {
      await this.refreshCache();
    } catch (error) {
      console.error("Error initializing symbol cache:", error);
    }
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
      return false;
    }
  }

  async extractSymbolsFromApp(appPath) {
    try {
      // Create a unique temp directory for this extraction
      const appFileName = path.basename(appPath);
      const extractDir = path.join(
        this.extractPath,
        appFileName.replace(/\./g, "_")
      );

      try {
        // Make sure the extraction directory exists and is empty
        await mkdir(extractDir, { recursive: true });

        // Get path to 7zip binary
        const pathTo7zip = sevenBin.path7za;

        // Create a stream to extract the app file
        const extractStream = Seven.extractFull(appPath, extractDir, {
          $bin: pathTo7zip,
          $progress: true,
        });

        // Wait for extraction to complete
        await new Promise((resolve, reject) => {
          extractStream.on("end", () => resolve());
          extractStream.on("error", (err) => reject(err));
        });

        console.log(`Extracted ${appPath} to ${extractDir}`);

        // Search for SymbolReference.json in the extracted files
        const symbolFilePath = await this.findSymbolReferenceFile(extractDir);

        if (!symbolFilePath) {
          console.warn(`No SymbolReference.json found in ${appPath}`);
          return false;
        }

        // Read the symbol file with improved error handling
        try {
          let symbolData;

          try {
            // Try again with raw buffer and manually handling BOM
            const buffer = await readFile(symbolFilePath);

            // Check for BOM and skip if present
            let content = buffer.toString("utf8");
            if (content.charCodeAt(0) === 0xfeff) {
              content = content.substring(1);
            }

            symbolData = JSON.parse(content);
          } catch (jsonError) {
            console.warn(`JSON parsing failed: ${jsonError.message}`);

            // Log additional details about the error
            if (jsonError.message.includes("out of memory")) {
              console.error(
                "The symbol file is too large to process in memory. Consider splitting it into smaller files."
              );
            }
            return false;
          }

          // Process symbol data
          if (symbolData) {
            for (const obj of symbolData.Tables) {
              if (obj.Name) {
                this.symbols[obj.Name] = obj;
              }
            }
            for (const obj of symbolData.Pages) {
              if (obj.Name) {
                this.symbols[obj.Name] = obj;
              }
            }
            for (const obj of symbolData.Reports) {
              if (obj.Name) {
                this.symbols[obj.Name] = obj;
              }
            }
            await this.saveCache();
            return true;
          } else {
            console.warn(
              `Symbol data from ${symbolFilePath} has invalid format`
            );
            console.log(
              `Symbol data keys: ${Object.keys(symbolData || {}).join(", ")}`
            );
          }
        } catch (readError) {
          console.error(
            `Error reading symbols file ${symbolFilePath}: ${readError.message}`
          );
        }
      } finally {
        // Clean up extraction directory
        try {
          await this.removeDirectory(extractDir);
        } catch (cleanupErr) {
          console.warn(
            `Failed to clean up extraction directory: ${cleanupErr.message}`
          );
        }
      }
    } catch (error) {
      console.error(`Failed to extract symbols from ${appPath}:`, error);
      console.error(error.stack);
    }
    return false;
  }

  // Helper function to find SymbolReference.json in extracted directory
  async findSymbolReferenceFile(dir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively search subdirectories
        const found = await this.findSymbolReferenceFile(fullPath);
        if (found) return found;
      } else if (entry.name === "SymbolReference.json") {
        return fullPath;
      }
    }

    return null;
  }

  // Helper function to recursively remove a directory
  async removeDirectory(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.removeDirectory(fullPath);
      } else {
        await fs.promises.unlink(fullPath).catch(() => {});
      }
    }

    await rmdir(dir).catch(() => {});
  }

  async processAppFiles() {
    let processed = 0;
    for (const appPath of this.appPaths) {
      if (await this.extractSymbolsFromApp(appPath)) {
        processed++;
      }
    }
    return processed;
  }

  async refreshCache() {
    // Clear existing cache
    this._objectIdMap.clear();

    // Get all AL files in the workspace
    const alFiles = await vscode.workspace.findFiles("**/*.al");

    for (const file of alFiles) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        this.processDocument(document);
      } catch (error) {
        console.error(`Error processing file ${file.fsPath}:`, error);
      }
    }
  }

  processDocument(document) {
    const text = document.getText();

    // Match object definitions (table, page, report, etc.)
    const objectRegex = /(\w+)\s+(\d+)\s+"([^"]+)"/g;
    let match;

    while ((match = objectRegex.exec(text)) !== null) {
      const [, , objectId, objectName] = match;
      this._objectIdMap.set(objectName, objectId);
      console.log(`Added to symbol cache: ${objectName} = ${objectId}`);
    }
  }

  getObjectInfo(objectName) {
    return this.symbols[objectName] || null;
  }

  getObjectId(objectName) {
    console.log(`Looking up: ${objectName} in cache`);
    console.log(
      `Cache contents: ${[...this._objectIdMap.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`
    );
    return this._objectIdMap.get(objectName);
  }
}

module.exports = new SymbolCache();
