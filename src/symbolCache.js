const fs = require("fs");
const path = require("path");
const util = require("util");
const os = require("os");
const JSZip = require("jszip");

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

        // Read the zip file as buffer
        const zipData = await readFile(appPath);
        const zip = await JSZip.loadAsync(zipData);
        // Extract files to extractDir
        await Promise.all(
          Object.keys(zip.files).map(async (filename) => {
            const file = zip.files[filename];
            const filePath = path.join(extractDir, filename);
            if (file.dir) {
              await mkdir(filePath, { recursive: true });
            } else {
              await mkdir(path.dirname(filePath), { recursive: true });
              const content = await file.async("nodebuffer");
              await writeFile(filePath, content);
            }
          })
        );

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
            const buffer = await readFile(symbolFilePath, "utf8");

            // Check for BOM and skip if present
            let content = buffer.toString("utf8");
            if (content.charCodeAt(0) === 0xfeff) {
              content = content.substring(1);
            }

            // Attempt to find valid JSON by trimming any extra content
            try {
              symbolData = JSON.parse(content);
            } catch (initialParseError) {
              console.warn(
                `Initial JSON parsing failed: ${initialParseError.message}`
              );

              // Try to sanitize the content by finding the outermost valid JSON structure
              const match = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
              if (match) {
                try {
                  symbolData = JSON.parse(match[0]);
                  console.log(
                    "Successfully parsed JSON after sanitizing content"
                  );
                } catch (sanitizeError) {
                  console.error(
                    `Failed to parse sanitized JSON: ${sanitizeError.message}`
                  );
                  throw initialParseError; // Rethrow the original error
                }
              } else {
                throw initialParseError; // Rethrow the original error
              }
            }
          } catch (jsonError) {
            console.warn(`JSON parsing failed: ${jsonError.message}`);

            // Log additional details about the error
            if (jsonError.message.includes("out of memory")) {
              console.error(
                "The symbol file is too large to process in memory. Consider splitting it into smaller files."
              );
            } else if (jsonError.message.includes("Unexpected")) {
              console.error(
                "The symbol file contains unexpected characters that prevent proper JSON parsing."
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

  getObjectInfo(objectName) {
    return this.symbols[objectName] || null;
  }

  getObjectId(objectName) {
    const obj = this.getObjectInfo(objectName);
    return obj ? obj.Id : null;
  }
}

module.exports = new SymbolCache();
