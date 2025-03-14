const fs = require("fs");
const path = require("path");
const configManager = require("../utils/configManager");
const { fileEvents } = require("../utils/alFileSaver");
const { postCorrections } = require("./utils/postCorrections");
const vscode = require("vscode");

function createIndexFolder() {
  try {
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );
    if (upgradedObjectFolders && upgradedObjectFolders.basePath) {
      const indexFolderPath = path.join(
        upgradedObjectFolders.basePath,
        ".index"
      );
      if (!fs.existsSync(indexFolderPath)) {
        fs.mkdirSync(indexFolderPath, { recursive: true });
        console.log(`Created index folder at: ${indexFolderPath}`);
      }
    }
  } catch (error) {
    console.error("Error creating index folder:", error);
  }
}

/**
 * Updates the index for AL files by processing either a single file or scanning an entire directory
 * @param {Object} [fileInfo] - Information about the specific file to process
 * @returns {void}
 * @throws {Error} When file processing fails or configuration is invalid
 * @description
 * This function maintains an index of AL files by:
 * 1. Processing a single AL file if fileInfo is provided
 * 2. Scanning all AL files in the base directory if no fileInfo is provided
 * The index is stored in a .index directory within the configured base path
 * Each AL object gets its own folder structure: .index/[objectType]/[objectNumber]/
 */
function updateFileIndex(fileInfo) {
  try {
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );
    if (!upgradedObjectFolders || !upgradedObjectFolders.basePath) {
      console.warn("Base path not configured for upgraded objects");
      return;
    }

    const basePath = upgradedObjectFolders.basePath;
    const indexPath = path.join(basePath, ".index");

    // If we have specific file info, just process that file
    if (fileInfo && fileInfo.path) {
      if (path.extname(fileInfo.path).toLowerCase() === ".al") {
        processAlFile(fileInfo.path, indexPath, fileInfo.orginFilePath);
      }
    } else {
      // Otherwise, scan all .al files in the base directory
      deepScanForAlFiles(basePath, indexPath);
    }
  } catch (error) {
    console.error("Error updating file index:", error);
  }
}

function deepScanForAlFiles(basePath, indexPath) {
  try {
    walkDirectoryForAlFiles(basePath, basePath, indexPath);
  } catch (error) {
    console.error(`Error scanning for .al files in ${basePath}:`, error);
  }
}

/**
 * Recursively walks through a directory structure to find and process AL files
 * @param {string} currentPath - The directory path currently being processed
 * @param {string} basePath - The root directory path of the project
 * @param {string} indexPath - The path to the index directory where metadata will be stored
 * @returns {void}
 * @throws {Error} When directory reading fails or there's an error walking the directory
 * @description
 * This function recursively traverses the directory structure starting from currentPath,
 * skipping the index directory, and processes all .al files it finds by calling processAlFile()
 */
function walkDirectoryForAlFiles(currentPath, basePath, indexPath) {
  try {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      // Skip the .index directory
      if (entry.isDirectory() && fullPath !== indexPath) {
        // Recursively walk subdirectories
        walkDirectoryForAlFiles(fullPath, basePath, indexPath);
      } else if (
        entry.isFile() &&
        path.extname(entry.name).toLowerCase() === ".al"
      ) {
        // Process .al files
        processAlFile(fullPath, indexPath, "orginFilePath");
      }
    }
  } catch (error) {
    console.error(`Error walking directory ${currentPath}:`, error);
  }
}

/**
 * Processes an AL file by extracting object information and creating an index entry
 * @param
 * @param {string} indexPath - The path to the index directory where metadata will be stored
 * @throws {Error} When file reading or processing fails
 */
function processAlFile(filePath, indexPath, orginFilePath) {
  try {
    // Read the file content
    const content = fs.readFileSync(filePath, "utf8");

    // Extract object type and number using regex
    // This regex should match all AL object types
    const objectTypeRegex =
      /\b(table|tableextension|page|pageextension|report|reportextension|codeunit|query|xmlport|enum|enumextension|profile|interface)\b\s+(\d+)\s+["']([^"']+)["']/i;
    const objectMatch = content.match(objectTypeRegex);

    if (!objectMatch) {
      console.warn(
        `Could not determine object type and number for ${filePath}`
      );
      return;
    }

    const objectType = objectMatch[1].toLowerCase();
    const objectNumber = objectMatch[2];

    // Create object type folder
    const objectTypeFolder = path.join(indexPath, objectType);
    if (!fs.existsSync(objectTypeFolder)) {
      fs.mkdirSync(objectTypeFolder, { recursive: true });
    }

    // Create object number folder
    const objectNumberFolder = path.join(objectTypeFolder, objectNumber);
    if (!fs.existsSync(objectNumberFolder)) {
      fs.mkdirSync(objectNumberFolder, { recursive: true });
    }

    // Create file information to store
    const fileInfo = {
      originalPath: filePath,
      fileName: path.basename(filePath),
      objectType,
      objectNumber,
      indexedAt: new Date().toISOString(),
      referencedMigrationFiles:
        orginFilePath && orginFilePath !== "orginFilePath"
          ? [orginFilePath]
          : [],
    };

    // Save file info to index
    fs.writeFileSync(
      path.join(objectNumberFolder, "info.json"),
      JSON.stringify(fileInfo, null, 2),
      "utf8"
    );

    console.log(`Indexed ${objectType} ${objectNumber} from ${filePath}`);

    // Create migration object reference file
    if (
      orginFilePath &&
      typeof orginFilePath === "string" &&
      orginFilePath !== "orginFilePath"
    ) {
      const sourceFileName = path.basename(orginFilePath);

      // Extract object type and number from file name (e.g., "Page5_Currencies.txt", "Table27_Item.txt")
      const sourceFileNameMatch = sourceFileName.match(
        /^([a-zA-Z]+)(\d+)_.+\.txt$/
      );

      if (sourceFileNameMatch) {
        // Create JSON filename based on source file name (replacing .txt with .json)
        const referenceFileName = sourceFileName.replace(/\.txt$/, ".json");
        const referenceFilePath = path.join(indexPath, referenceFileName);

        let referenceData = {
          referencedWorkingObjects: [],
        };

        // If file exists, read current data
        if (fs.existsSync(referenceFilePath)) {
          try {
            referenceData = JSON.parse(
              fs.readFileSync(referenceFilePath, "utf8")
            );
          } catch (parseError) {
            console.error(
              `Error parsing existing reference file ${referenceFilePath}:`,
              parseError
            );
          }
        }

        // Add current object reference if not already in the array
        const objectReference = { type: objectType, number: objectNumber };
        const exists = referenceData.referencedWorkingObjects.some(
          (ref) => ref.type === objectType && ref.number === objectNumber
        );

        if (!exists) {
          referenceData.referencedWorkingObjects.push(objectReference);

          // Write back to file
          fs.writeFileSync(
            referenceFilePath,
            JSON.stringify(referenceData, null, 2),
            "utf8"
          );

          console.log(
            `Updated migration reference in ${referenceFileName} for ${objectType} ${objectNumber}`
          );
        }
      } else {
        console.warn(
          `Could not extract object type and number from migration filename: ${sourceFileName}`
        );
      }
    }
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
}

/**
 * Set up a file system watcher for AL files to detect and respond to changes
 * @param {vscode.ExtensionContext} context - The extension context
 */
function setupFileWatcher(context) {
  try {
    // Watch for changes to .al files in the workspace
    const alFileWatcher = vscode.workspace.createFileSystemWatcher("**/*.al");

    // Handle changes to .al files
    alFileWatcher.onDidChange(async (uri) => {
      try {
        // Get the file content to analyze changes
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();

        // Process the changed file
        handleAlFileChange(uri.fsPath, content);
      } catch (error) {
        console.error(`Error handling file change for ${uri.fsPath}:`, error);
      }
    });

    // Handle creation of new .al files
    alFileWatcher.onDidCreate(async (uri) => {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();

        // Process the new file
        handleAlFileCreate(uri.fsPath, content);
      } catch (error) {
        console.error(`Error handling file creation for ${uri.fsPath}:`, error);
      }
    });

    // Handle deletion of .al files
    alFileWatcher.onDidDelete((uri) => {
      try {
        // Process the deleted file
        handleAlFileDelete(uri.fsPath);
      } catch (error) {
        console.error(`Error handling file deletion for ${uri.fsPath}:`, error);
      }
    });

    if (context && context.subscriptions) {
      context.subscriptions.push(alFileWatcher);
    }
  } catch (error) {
    console.error("Error setting up file watcher:", error);
  }
}

/**
 * Process changes to an existing AL file
 * @param {string} filePath - Path to the changed AL file
 * @param {string} content - Content of the file
 */
function handleAlFileChange(filePath, content) {
  try {
    // Extract object information from the AL file
    const objectTypeRegex =
      /\b(table|tableextension|page|pageextension|report|reportextension|codeunit|query|xmlport|enum|enumextension|profile|interface)\b\s+(\d+)\s+["']([^"']+)["']/i;
    const objectMatch = content.match(objectTypeRegex);

    if (!objectMatch) {
      console.warn(`Could not extract object info from ${filePath}`);
      return;
    }

    const objectType = objectMatch[1].toLowerCase();
    const objectNumber = objectMatch[2];

    // Get the base path for indexes
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );
    if (!upgradedObjectFolders || !upgradedObjectFolders.basePath) {
      return;
    }

    const basePath = upgradedObjectFolders.basePath;
    const indexPath = path.join(basePath, ".index");

    // Look for the current index entry for this file
    const objectTypeFolder = path.join(indexPath, objectType);
    const objectNumberFolder = path.join(objectTypeFolder, objectNumber);
    const infoFilePath = path.join(objectNumberFolder, "info.json");

    // If the info file exists, update its information
    if (fs.existsSync(infoFilePath)) {
      const infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));

      // Update relevant fields
      infoData.lastUpdated = new Date().toISOString();

      // If the file path has changed, update that too
      if (infoData.originalPath !== filePath) {
        infoData.originalPath = filePath;
        infoData.fileName = path.basename(filePath);
      }

      // Write back the updated info
      fs.writeFileSync(infoFilePath, JSON.stringify(infoData, null, 2), "utf8");
      console.log(`Updated index info for ${filePath}`);
    } else {
      // If no index exists for this object, create one
      createNewIndexEntry(filePath, objectType, objectNumber, indexPath);
    }
  } catch (error) {
    console.error(`Error handling AL file change for ${filePath}:`, error);
  }
}

/**
 * Process the creation of a new AL file
 * @param {string} filePath - Path to the new AL file
 * @param {string} content - Content of the file
 */
function handleAlFileCreate(filePath, content) {
  try {
    // Extract object information from the AL file
    const objectTypeRegex =
      /\b(table|tableextension|page|pageextension|report|reportextension|codeunit|query|xmlport|enum|enumextension|profile|interface)\b\s+(\d+)\s+["']([^"']+)["']/i;
    const objectMatch = content.match(objectTypeRegex);

    if (!objectMatch) {
      console.warn(`Could not extract object info from new file ${filePath}`);
      return;
    }

    const objectType = objectMatch[1].toLowerCase();
    const objectNumber = objectMatch[2];

    // Get the base path for indexes
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );
    if (!upgradedObjectFolders || !upgradedObjectFolders.basePath) {
      return;
    }

    const basePath = upgradedObjectFolders.basePath;
    const indexPath = path.join(basePath, ".index");

    // Create a new index entry for this file
    createNewIndexEntry(filePath, objectType, objectNumber, indexPath);
  } catch (error) {
    console.error(`Error handling AL file creation for ${filePath}:`, error);
  }
}

/**
 * Create a new index entry for an AL file
 * @param {string} filePath - Path to the AL file
 * @param {string} objectType - Type of the AL object
 * @param {string} objectNumber - Number of the AL object
 * @param {string} indexPath - Path to the index directory
 */
function createNewIndexEntry(filePath, objectType, objectNumber, indexPath) {
  try {
    // Create object type folder if needed
    const objectTypeFolder = path.join(indexPath, objectType);
    if (!fs.existsSync(objectTypeFolder)) {
      fs.mkdirSync(objectTypeFolder, { recursive: true });
    }

    // Create object number folder if needed
    const objectNumberFolder = path.join(objectTypeFolder, objectNumber);
    if (!fs.existsSync(objectNumberFolder)) {
      fs.mkdirSync(objectNumberFolder, { recursive: true });
    }

    // Create info.json file
    const infoData = {
      originalPath: filePath,
      fileName: path.basename(filePath),
      objectType,
      objectNumber,
      indexedAt: new Date().toISOString(),
      referencedMigrationFiles: [],
    };

    fs.writeFileSync(
      path.join(objectNumberFolder, "info.json"),
      JSON.stringify(infoData, null, 2),
      "utf8"
    );

    console.log(`Created new index entry for ${filePath}`);
  } catch (error) {
    console.error(`Error creating index entry for ${filePath}:`, error);
  }
}

/**
 * Handle the deletion of an AL file
 * @param {string} filePath - Path to the deleted AL file
 */
function handleAlFileDelete(filePath) {
  try {
    // Get the base path for indexes
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );
    if (!upgradedObjectFolders || !upgradedObjectFolders.basePath) {
      return;
    }

    const basePath = upgradedObjectFolders.basePath;
    const indexPath = path.join(basePath, ".index");

    // We need to find the index entry for this file
    // Since we don't have the content anymore, we'll search through all index entries
    const objectTypeFolders = fs.readdirSync(indexPath);

    for (const objectType of objectTypeFolders) {
      const objectTypeFolder = path.join(indexPath, objectType);
      if (!fs.statSync(objectTypeFolder).isDirectory()) continue;

      const objectNumberFolders = fs.readdirSync(objectTypeFolder);

      for (const objectNumber of objectNumberFolders) {
        const objectNumberFolder = path.join(objectTypeFolder, objectNumber);
        if (!fs.statSync(objectNumberFolder).isDirectory()) continue;

        const infoFilePath = path.join(objectNumberFolder, "info.json");

        if (fs.existsSync(infoFilePath)) {
          try {
            const infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));

            if (infoData.originalPath === filePath) {
              // Found the index entry for this file - mark it as deleted
              infoData.deleted = true;
              infoData.deletedAt = new Date().toISOString();

              fs.writeFileSync(
                infoFilePath,
                JSON.stringify(infoData, null, 2),
                "utf8"
              );
              console.log(`Marked index entry for ${filePath} as deleted`);

              // No need to continue searching
              return;
            }
          } catch (error) {
            console.error(
              `Error processing index file ${infoFilePath}:`,
              error
            );
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error handling AL file deletion for ${filePath}:`, error);
  }
}

function registerfileEvents(context) {
  const disposable = fileEvents((fileInfo) => {
    createIndexFolder();
    updateFileIndex(fileInfo);
    postCorrections(fileInfo);
  });

  // Set up file watcher for real-time monitoring of AL files
  setupFileWatcher(context);

  if (context && context.subscriptions) {
    context.subscriptions.push(disposable);
  }
}

module.exports = {
  registerfileEvents,
};
