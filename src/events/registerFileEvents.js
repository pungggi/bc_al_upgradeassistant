const fs = require("fs");
const path = require("path");
const configManager = require("../utils/configManager");
const { fileEvents } = require("../utils/alFileSaver");

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
 * @param {string} [fileInfo.path] - The full path to the AL file to process
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

// function findReferencingMigrationFiles(objectType, objectNumber) {
//   try {
//     const upgradedObjectFolders = configManager.getConfigValue(
//       "upgradedObjectFolders",
//       null
//     );

//     if (!upgradedObjectFolders || !upgradedObjectFolders.basePath) {
//       console.warn("Base path not configured for upgraded objects");
//       return [];
//     }

//     // TODO Find all migration files that reference this object

//     const referencingFiles = [];

//     return referencingFiles;
//   } catch (error) {
//     console.error(
//       `Error finding referencing migration files for ${objectType} ${objectNumber}:`,
//       error
//     );
//     return [];
//   }
// }

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
      /\b(table|tableextension|page|pageextension|report|reportextension|codeunit|query|xmlport|enum|enumextension|profile|interface)\b\s+(\d+)/i;
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
      referencedMigrationFiles: [orginFilePath],
    };

    // Save file info to index
    fs.writeFileSync(
      path.join(objectNumberFolder, "info.json"),
      JSON.stringify(fileInfo, null, 2),
      "utf8"
    );

    console.log(`Indexed ${objectType} ${objectNumber} from ${filePath}`);
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
}

function registerfileEvents(context) {
  const disposable = fileEvents((fileInfo) => {
    createIndexFolder();
    updateFileIndex(fileInfo);
  });

  if (context && context.subscriptions) {
    context.subscriptions.push(disposable);
  }
}

module.exports = {
  registerfileEvents,
};
