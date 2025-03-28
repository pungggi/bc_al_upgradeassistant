const fs = require("fs");
const path = require("path");
const vscode = require("vscode"); // Added vscode for potential messages
const {
  getConfigValue,
  getSrcExtractionPath,
} = require("../utils/configManager"); // Added getSrcExtractionPath
const { findAppJsonFile } = require("../utils/appJsonReader"); // Added findAppJsonFile
const { readJsonFile } = require("../jsonUtils"); // Added readJsonFile
const { updateIndexAfterObjectChange } = require("./utils/indexManager");
const { findMigrationReferences } = require("../utils/migrationHelper");

/**
 * Process changes to an existing AL file
 * @param {string} filePath - Path to the changed AL file
 * @param {string} newContent - Content of the file after saving
 * @param {string} previousContent - Previous content of the file when opening
 */
async function handleAlFileChange(filePath, newContent, previousContent) {
  // Made async
  if (!filePath || !newContent) {
    console.error(
      `Invalid parameters for handleAlFileChange: missing filePath or newContent`
    );
    return;
  }

  try {
    // Extract object information from the AL file
    const objectTypeRegex =
      /\b(table|tableextension|page|pageextension|report|reportextension|codeunit|query|xmlport|enum|enumextension|profile|interface)\b\s+(\d+)\s+["']([^"']+)["']/i;
    const objectMatch = newContent.match(objectTypeRegex);
    if (!objectMatch) {
      console.warn(`Could not extract object info from ${filePath}`);
      return;
    }

    const objectType = objectMatch[1].toLowerCase();
    const objectNumber = objectMatch[2];

    //#region previous object
    if (!previousContent) {
      // Get the base path for indexes
      const upgradedObjectFolders = configManager.getConfigValue(
        "upgradedObjectFolders",
        null
      );

      if (!upgradedObjectFolders || !upgradedObjectFolders.basePath) {
        console.error(
          `Missing basePath in upgradedObjectFolders configuration`
        );
        return;
      }

      const indexPath = path.join(upgradedObjectFolders.basePath, ".index");
      createNewIndexEntry(filePath, objectType, objectNumber, indexPath);
      return;
    }

    const oldobjectMatch = previousContent.match(objectTypeRegex);
    if (!oldobjectMatch) {
      console.warn(`Could not extract previous object info from ${filePath}`);
      return;
    }

    const previousObjectType = oldobjectMatch[1].toLowerCase();
    const previousObjectId = oldobjectMatch[2];
    //#endregion

    // Get the base path for indexes
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );

    if (!upgradedObjectFolders || !upgradedObjectFolders.basePath) {
      console.error(`Missing basePath in upgradedObjectFolders configuration`);
      return;
    }

    const indexPath = path.join(upgradedObjectFolders.basePath, ".index");

    // Look for the previous index entry for this file
    const objectTypeFolder = path.join(indexPath, previousObjectType);
    const objectNumberFolder = path.join(objectTypeFolder, previousObjectId);
    const infoFilePath = path.join(objectNumberFolder, "info.json");

    // Check if the info file exists before reading
    if (!fs.existsSync(infoFilePath)) {
      // If no index exists for this object, create one
      createNewIndexEntry(filePath, objectType, objectNumber, indexPath);
      return;
    }

    // Read and parse the info file
    let infoData;
    try {
      infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));
    } catch (readError) {
      console.error(`Error reading info file ${infoFilePath}:`, readError);
      createNewIndexEntry(filePath, objectType, objectNumber, indexPath);
      return;
    }

    if (previousContent) {
      infoData = updateIndexAfterObjectChange(
        filePath,
        previousContent,
        newContent
      );
    }
    return infoData;
  } catch (error) {
    console.error(`Error updating index after object change:`, error);
  }

  // --- Add file copying logic ---
  await copyWorkspaceAlFileToExtractionPath(filePath);
  // --- End file copying logic ---
}

/**
 * Copies a workspace AL file to the configured srcExtractionPath.
 * @param {string} sourceFilePath - The path to the workspace AL file to copy.
 */
async function copyWorkspaceAlFileToExtractionPath(sourceFilePath) {
  try {
    const srcExtractionPath = await getSrcExtractionPath();
    if (!srcExtractionPath) {
      // Warning already shown by getSrcExtractionPath if prompting failed
      console.log(
        "Skipping workspace AL file copy: srcExtractionPath not available."
      );
      return;
    }

    const appJsonPath = findAppJsonFile();
    if (!appJsonPath) {
      console.warn(
        `Skipping workspace AL file copy: app.json not found in workspace for file ${sourceFilePath}`
      );
      return;
    }

    const projectRoot = path.dirname(appJsonPath);
    let appName = "UnknownApp";
    let appVersion = "1.0.0.0";

    try {
      const appJson = readJsonFile(appJsonPath); // Using imported utility
      appName = appJson.name || appName;
      appVersion = appJson.version || appVersion;
    } catch (err) {
      console.error(`Error reading app.json at ${appJsonPath}: ${err.message}`);
      // Proceed with defaults
    }

    const sanitizedAppName = appName.replace(/[<>:"/\\|?*]/g, "_");
    const relativePath = path.relative(projectRoot, sourceFilePath);

    // Ensure relativePath doesn't start with '..' if file is outside projectRoot (shouldn't happen with watcher)
    if (relativePath.startsWith("..")) {
      console.warn(
        `Skipping workspace AL file copy: File ${sourceFilePath} seems outside project root ${projectRoot}`
      );
      return;
    }

    const targetDir = path.join(
      srcExtractionPath,
      sanitizedAppName,
      appVersion,
      "src", // Add the 'src' subdirectory
      path.dirname(relativePath)
    );
    const targetFilePath = path.join(targetDir, path.basename(sourceFilePath));

    // Ensure target directory exists
    await fs.promises.mkdir(targetDir, { recursive: true });

    // Copy the file
    await fs.promises.copyFile(sourceFilePath, targetFilePath);

    console.log(`Copied workspace file ${relativePath} to ${targetFilePath}`);
  } catch (error) {
    console.error(
      `Error copying workspace AL file ${sourceFilePath} to extraction path:`,
      error
    );
    vscode.window.showErrorMessage(
      `Failed to copy AL file to extraction path: ${error.message}`
    );
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

    // Check if the info.json file already exists
    const infoFilePath = path.join(objectNumberFolder, "info.json");
    if (fs.existsSync(infoFilePath)) {
      console.log(`Index entry already exists for ${filePath}`);
      return;
    }

    // Find migration references for this object
    const migrationReferences = findMigrationReferences(
      indexPath,
      objectType,
      objectNumber
    );

    // Create info.json file
    const infoData = {
      originalPath: filePath,
      objectType,
      objectNumber,
      indexedAt: new Date().toISOString(),
      referencedMigrationFiles: migrationReferences,
    };

    fs.writeFileSync(infoFilePath, JSON.stringify(infoData, null, 2), "utf8");

    console.log(`Created new index entry for ${filePath}`);
  } catch (error) {
    console.error(`Error creating index entry for ${filePath}:`, error);
  }
}

module.exports = {
  handleAlFileChange,
  createNewIndexEntry,
  copyWorkspaceAlFileToExtractionPath, // Export the function
};
