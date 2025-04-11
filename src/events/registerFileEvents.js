const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const {
  getConfigValue,
  getSrcExtractionPath,
} = require("../utils/configManager"); // Added getSrcExtractionPath
const { findAppJsonFile } = require("../utils/appJsonReader"); // Added findAppJsonFile
const { readJsonFile } = require("../jsonUtils"); // Added readJsonFile
const { initializeFieldCache } = require("../utils/cacheHelper"); // Import field cache initializer
const { fileEvents } = require("../utils/alFileSaver");
const { postCorrections } = require("./utils/postCorrections");
const {
  createNewIndexEntry,
  handleAlFileChange,
  copyWorkspaceAlFileToExtractionPath, // Import the copy function
} = require("./handleAlFileChange");

const fileContentCache = new Map();

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
    const upgradedObjectFolders = getConfigValue(
      // Use destructured function
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

    // Cache all currently open AL files
    for (const document of vscode.workspace.textDocuments) {
      if (document.fileName.endsWith(".al")) {
        fileContentCache.set(document.fileName, document.getText());
      }
    }

    // Subscribe to document open events to initialize cache
    const documentOpenSubscription = vscode.workspace.onDidOpenTextDocument(
      (document) => {
        if (document.fileName.endsWith(".al")) {
          fileContentCache.set(document.fileName, document.getText());
        }
      }
    );

    // Handle changes to .al files
    alFileWatcher.onDidChange(async (uri) => {
      try {
        // Get the current file content
        const document = await vscode.workspace.openTextDocument(uri);
        const newContent = document.getText();

        // Get previous content from cache
        const previousContent = fileContentCache.get(uri.fsPath) || "";

        // Process the changed file with both contents
        handleAlFileChange(uri.fsPath, newContent, previousContent, context); // Pass context

        // Update cache with new content
        fileContentCache.set(uri.fsPath, newContent);
      } catch (error) {
        console.error(`Error handling file change for ${uri.fsPath}:`, error);
      }
    });

    // Handle creation of new .al files
    alFileWatcher.onDidCreate(async (uri) => {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();

        // Add to cache
        fileContentCache.set(uri.fsPath, content);

        // Process the new file
        handleAlFileCreate(uri.fsPath, content, context); // Pass context
      } catch (error) {
        console.error(`Error handling file creation for ${uri.fsPath}:`, error);
      }
    });

    // Handle deletion of .al files
    alFileWatcher.onDidDelete((uri) => {
      try {
        // Get previous content before removing from cache
        fileContentCache.get(uri.fsPath) || "";

        // Remove from cache
        fileContentCache.delete(uri.fsPath);

        // Process the deleted file
        handleAlFileDelete(uri.fsPath, context); // Pass context
      } catch (error) {
        console.error(`Error handling file deletion for ${uri.fsPath}:`, error);
      }
    });

    if (context && context.subscriptions) {
      context.subscriptions.push(alFileWatcher, documentOpenSubscription);
    }
  } catch (error) {
    console.error("Error setting up file watcher:", error);
  }
}

/**
 * Process the creation of a new AL file
 * @param {string} filePath - Path to the new AL file
 * @param {string} content - Content of the file
 * @param {vscode.ExtensionContext} context - Extension context
 */
async function handleAlFileCreate(filePath, content, context) {
  // Added context
  // Made async
  try {
    // --- Add file copying logic ---
    await copyWorkspaceAlFileToExtractionPath(filePath);
    // --- End file copying logic ---

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
    const upgradedObjectFolders = getConfigValue(
      // Use destructured function
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

    // Trigger field cache update
    if (context) {
      console.log(
        `[HandleCreate] Triggering field cache update for new file: ${filePath}`
      );
      await initializeFieldCache(context);
    } else {
      console.warn(
        `[HandleCreate] Cannot trigger field cache update for ${filePath}: context not provided.`
      );
    }
  } catch (error) {
    console.error(`Error handling AL file creation for ${filePath}:`, error);
  }
}

/**
 * Handle the deletion of an AL file
 * @param {string} filePath - Path to the deleted AL file
 * @param {vscode.ExtensionContext} context - Extension context
 */
async function handleAlFileDelete(filePath, context) {
  // Added context
  // Made async
  try {
    // --- Add file deletion logic ---
    await deleteWorkspaceAlFileFromExtractionPath(filePath);
    // --- End file deletion logic ---

    // Get the base path for indexes
    const upgradedObjectFolders = getConfigValue("upgradedObjectFolders", null); // Already correct here
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
              // Delete the info.json file
              fs.unlinkSync(infoFilePath);
              console.log(`Removed index entry for ${filePath}`);

              // Try to clean up empty folders
              try {
                if (fs.readdirSync(objectNumberFolder).length === 0) {
                  fs.rmdirSync(objectNumberFolder);
                }
                if (fs.readdirSync(objectTypeFolder).length === 0) {
                  fs.rmdirSync(objectTypeFolder);
                }
              } catch (cleanupError) {
                console.error("Error cleaning up folders:", cleanupError);
              }

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

  // --- Trigger Field Cache Update ---
  // Symbol cache refresh is handled by the .app watcher or manual command now
  if (context) {
    console.log(
      `[HandleDelete] Triggering field cache update for deleted file: ${filePath}`
    );
    await initializeFieldCache(context); // Trigger worker update
  } else {
    console.warn(
      `[HandleDelete] Cannot trigger field cache update for ${filePath}: context not provided.`
    );
  }
  // --- End Trigger ---
}

/**
 * Deletes a workspace AL file from the configured srcExtractionPath.
 * @param {string} sourceFilePath - The path to the workspace AL file that was deleted.
 */
async function deleteWorkspaceAlFileFromExtractionPath(sourceFilePath) {
  try {
    const srcExtractionPath = await getSrcExtractionPath();
    if (!srcExtractionPath) {
      console.log(
        "Skipping workspace AL file deletion: srcExtractionPath not available."
      );
      return;
    }

    // We need app.json details to construct the path, even for deletion
    const appJsonPath = findAppJsonFile();
    if (!appJsonPath) {
      // If app.json isn't found, we can't reliably determine the target path
      console.warn(
        `Skipping workspace AL file deletion: app.json not found in workspace for file ${sourceFilePath}`
      );
      return;
    }

    const projectRoot = path.dirname(appJsonPath);
    let appName = "UnknownApp";
    let appVersion = "1.0.0.0";

    try {
      const appJson = readJsonFile(appJsonPath);
      appName = appJson.name || appName;
      appVersion = appJson.version || appVersion;
    } catch (err) {
      // Log error but still try to construct path with defaults
      console.error(
        `Error reading app.json at ${appJsonPath} during delete operation: ${err.message}`
      );
    }

    const sanitizedAppName = appName.replace(/[<>:"/\\|?*]/g, "_");
    const relativePath = path.relative(projectRoot, sourceFilePath);

    if (relativePath.startsWith("..")) {
      console.warn(
        `Skipping workspace AL file deletion: File ${sourceFilePath} seems outside project root ${projectRoot}`
      );
      return;
    }

    const targetDir = path.join(
      srcExtractionPath,
      sanitizedAppName,
      appVersion,
      "src",
      path.dirname(relativePath)
    );
    const targetFilePath = path.join(targetDir, path.basename(sourceFilePath));

    // Check if the file exists before attempting deletion
    if (fs.existsSync(targetFilePath)) {
      await fs.promises.unlink(targetFilePath);
      console.log(
        `Deleted workspace file ${relativePath} from ${targetFilePath}`
      );

      // Optional: Clean up empty directories - this can be complex and might need refinement
      // try {
      //   let currentDir = targetDir;
      //   const baseSrcDir = path.join(srcExtractionPath, sanitizedAppName, appVersion, 'src');
      //   while (currentDir !== baseSrcDir && fs.readdirSync(currentDir).length === 0) {
      //     fs.rmdirSync(currentDir);
      //     console.log(`Removed empty directory: ${currentDir}`);
      //     currentDir = path.dirname(currentDir);
      //   }
      // } catch (cleanupError) {
      //   console.error(`Error cleaning up empty directories after deleting ${targetFilePath}:`, cleanupError);
      // }
    } else {
      console.log(
        `Skipped deletion: File ${targetFilePath} not found in extraction path.`
      );
    }
  } catch (error) {
    console.error(
      `Error deleting workspace AL file ${sourceFilePath} from extraction path:`,
      error
    );
    // Don't necessarily show error message to user for deletion failure, could be noisy
  }
}

function setupTxtFileWatcher(context) {
  try {
    const upgradedObjectFolders = getConfigValue(
      // Use destructured function
      "upgradedObjectFolders",
      null
    );
    if (!upgradedObjectFolders || !upgradedObjectFolders.basePath) {
      console.warn("Base path not configured for upgraded objects");
      return;
    }

    const basePath = upgradedObjectFolders.basePath;

    // Add direct rename event listener
    const renameSubscription = vscode.workspace.onDidRenameFiles((event) => {
      for (const { oldUri, newUri } of event.files) {
        // Skip non-txt files
        if (!oldUri.fsPath.endsWith(".txt") || !newUri.fsPath.endsWith(".txt"))
          continue;

        // Skip files outside our base path
        if (
          !oldUri.fsPath.startsWith(basePath) ||
          !newUri.fsPath.startsWith(basePath)
        )
          continue;

        const oldFilename = path.basename(oldUri.fsPath);
        const newFilename = path.basename(newUri.fsPath);

        // Process the rename
        handleTxtFileRename(basePath, oldFilename, newFilename);
      }
    });

    if (context && context.subscriptions) {
      context.subscriptions.push(renameSubscription);
    }
  } catch (error) {
    console.error("Error setting up .txt file watcher:", error);
  }
}

/**
 * Handles .txt file rename by updating corresponding index files
 * @param {string} basePath - The base path for upgraded objects
 * @param {string} oldFilename - Original file name
 * @param {string} newFilename - New file name
 */
function handleTxtFileRename(basePath, oldFilename, newFilename) {
  const indexPath = path.join(basePath, ".index");
  const oldJsonPath = path.join(
    indexPath,
    oldFilename.replace(/\.txt$/, ".json")
  );
  const newJsonPath = path.join(
    indexPath,
    newFilename.replace(/\.txt$/, ".json")
  );

  // If no index file exists, nothing to do
  if (!fs.existsSync(oldJsonPath)) return;

  try {
    // Read and write in a single operation
    const jsonContent = fs.readFileSync(oldJsonPath, "utf8");
    fs.writeFileSync(newJsonPath, jsonContent);
    fs.unlinkSync(oldJsonPath);
    console.log(`Renamed index file from ${oldFilename} to ${newFilename}`);
  } catch (error) {
    console.error("Error handling .json file rename:", error);
  }
}

function registerfileEvents(context) {
  const disposable = fileEvents((fileInfo) => {
    updateFileIndex(fileInfo);
    createIndexFolder();
    postCorrections(fileInfo);
  });

  // Set up file watchers for real-time monitoring
  setupFileWatcher(context);
  setupTxtFileWatcher(context);

  if (context && context.subscriptions) {
    context.subscriptions.push(disposable);
  }
}

const createIndexFolder = () => {
  try {
    const upgradedObjectFolders = getConfigValue(
      // Use destructured function
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
};

module.exports = {
  registerfileEvents,
  syncWorkspaceToExtractionPath, // Export the new function
};

/**
 * Recursively finds all .al files within a directory
 * @param {string} dirPath - The directory to start searching from.
 * @param {string[]} arrayOfFiles - Accumulator for file paths.
 * @returns {Promise<string[]>} - A promise resolving to an array of new .al file paths.
 */
async function findAllAlFiles(dirPath, arrayOfFiles = []) {
  try {
    const files = await fs.promises.readdir(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      try {
        const stat = await fs.promises.stat(fullPath);
        if (stat.isDirectory()) {
          await findAllAlFiles(fullPath, arrayOfFiles);
        } else if (path.extname(file).toLowerCase() === ".al") {
          arrayOfFiles.push(fullPath);
        }
      } catch (statError) {
        console.warn(`Could not stat ${fullPath}: ${statError.message}`);
      }
    }
  } catch (readDirError) {
    console.warn(
      `Could not read directory ${dirPath}: ${readDirError.message}`
    );
  }
  return arrayOfFiles;
}

/**
 * Performs an initial scan of the workspace project and copies all .al files
 * to the configured srcExtractionPath.
 */
async function syncWorkspaceToExtractionPath() {
  try {
    const srcExtractionPath = await getSrcExtractionPath();
    if (!srcExtractionPath) {
      console.log(
        "Initial sync skipped: srcExtractionPath not available or extraction disabled."
      );
      return;
    }

    const appJsonPath = findAppJsonFile();
    if (!appJsonPath) {
      console.warn("Initial sync skipped: app.json not found in workspace.");
      return;
    }

    const projectRoot = path.dirname(appJsonPath);

    const alFiles = await findAllAlFiles(projectRoot);
    console.log(`Found ${alFiles.length} .al files to sync.`);

    if (alFiles.length === 0) {
      console.log("No .al files found in the project root. Sync complete.");
      return;
    }

    // Use Promise.all for concurrent copying
    const copyPromises = alFiles.map((filePath) =>
      copyWorkspaceAlFileToExtractionPath(filePath).catch((err) => {
        // Catch individual copy errors so one failure doesn't stop others
        console.error(`Failed to copy ${filePath}: ${err.message}`);
      })
    );

    await Promise.all(copyPromises);
  } catch (error) {
    console.error("Error during initial sync of workspace AL files:", error);
    vscode.window.showErrorMessage(
      `Failed initial AL file sync: ${error.message}`
    );
  }
}
