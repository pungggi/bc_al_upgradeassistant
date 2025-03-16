const fs = require("fs");
const path = require("path");
const configManager = require("../utils/configManager");

/**
 * Process changes to an existing AL file
 * @param {string} filePath - Path to the changed AL file
 * @param {string} newContent - Content of the file after saving
 * @param {string} previousContent - Previous content of the file when opening
 */
function handleAlFileChange(filePath, newContent, previousContent) {
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
    // Check if previousContent exists before using it
    if (!previousContent) {
      console.log(
        `No previous content available for ${filePath}, treating as new file`
      );

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

    // Update relevant fields
    infoData.lastUpdated = new Date().toISOString();

    // Check if object number or type changed
    const objectInfoChanged =
      previousObjectType !== objectType || previousObjectId !== objectNumber;

    // If object info changed, update migration reference files
    if (objectInfoChanged) {
      // Update migration references for the changed object
      updateMigrationReferences(
        indexPath,
        infoData.referencedMigrationFiles,
        previousObjectType,
        previousObjectId,
        objectType,
        objectNumber
      );
    }

    // If the file path has changed, update that too
    if (infoData.originalPath !== filePath) {
      infoData.originalPath = filePath;
      infoData.fileName = path.basename(filePath);
    }

    // Write back the updated info
    fs.writeFileSync(infoFilePath, JSON.stringify(infoData, null, 2), "utf8");
    console.log(`Updated index info for ${filePath}`);
  } catch (error) {
    console.error(`Error handling AL file change for ${filePath}:`, error);
  }
}

/**
 * Updates migration reference files when an object's type or number changes
 * @param {string} indexPath - Path to the index directory
 * @param {Array<string>} migrationFiles - List of migration files that reference the object
 * @param {string} oldType - Previous object type
 * @param {string} oldNumber - Previous object number
 * @param {string} newType - New object type
 * @param {string} newNumber - New object number
 */
function updateMigrationReferences(
  indexPath,
  migrationFiles,
  oldType,
  oldNumber,
  newType,
  newNumber
) {
  if (
    !migrationFiles ||
    !Array.isArray(migrationFiles) ||
    migrationFiles.length === 0
  ) {
    return;
  }

  for (const migrationPath of migrationFiles) {
    if (!migrationPath || migrationPath === "orginFilePath") continue;

    const sourceFileName = path.basename(migrationPath);
    const referenceFileName = sourceFileName.replace(/\.txt$/, ".json");
    const referenceFilePath = path.join(indexPath, referenceFileName);

    if (!fs.existsSync(referenceFilePath)) continue;

    try {
      // Read the current reference file
      const referenceData = JSON.parse(
        fs.readFileSync(referenceFilePath, "utf8")
      );

      if (!referenceData.referencedWorkingObjects) {
        referenceData.referencedWorkingObjects = [];
      }

      // Remove the old reference
      const oldReference = { type: oldType, number: oldNumber };
      referenceData.referencedWorkingObjects.splice(
        referenceData.referencedWorkingObjects.indexOf(oldReference),
        1
      );

      // Add the new reference
      const newReference = { type: newType, number: newNumber };
      const exists = referenceData.referencedWorkingObjects.some(
        (ref) => ref.type === newType && ref.number === newNumber
      );

      if (!exists) {
        referenceData.referencedWorkingObjects.push(newReference);
      }

      // Write back to the file
      fs.writeFileSync(
        referenceFilePath,
        JSON.stringify(referenceData, null, 2),
        "utf8"
      );

      console.log(
        `Updated migration reference in ${referenceFileName}: changed ${oldType} ${oldNumber} to ${newType} ${newNumber}`
      );
    } catch (error) {
      console.error(
        `Error updating migration reference in ${referenceFilePath}:`,
        error
      );
    }
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

    // Create info.json file
    const infoData = {
      originalPath: filePath,
      fileName: path.basename(filePath),
      objectType,
      objectNumber,
      indexedAt: new Date().toISOString(),
      referencedMigrationFiles: [],
    };

    fs.writeFileSync(infoFilePath, JSON.stringify(infoData, null, 2), "utf8");

    console.log(`Created new index entry for ${filePath}`);
  } catch (error) {
    console.error(`Error creating index entry for ${filePath}:`, error);
  }
}

module.exports = {
  handleAlFileChange,
  updateMigrationReferences,
  createNewIndexEntry,
};
