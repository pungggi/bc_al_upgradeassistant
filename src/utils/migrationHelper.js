const fs = require("fs");
const path = require("path");
const configManager = require("./configManager");

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
      const referenceData = JSON.parse(
        fs.readFileSync(referenceFilePath, "utf8")
      );
      if (!referenceData.referencedWorkingObjects) {
        referenceData.referencedWorkingObjects = [];
      }

      const oldReference = { type: oldType, number: oldNumber };
      referenceData.referencedWorkingObjects.splice(
        referenceData.referencedWorkingObjects.indexOf(oldReference),
        1
      );

      const newReference = { type: newType, number: newNumber };
      const exists = referenceData.referencedWorkingObjects.some(
        (ref) => ref.type === newType && ref.number === newNumber
      );

      if (!exists) {
        referenceData.referencedWorkingObjects.push(newReference);
      }

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
 * Find migration files that reference an object
 * @param {string} indexPath - Path to the index directory
 * @param {string} objectType - Type of the AL object
 * @param {string} objectNumber - Number of the AL object
 * @returns {Array} - Array of migration file paths
 */
function findMigrationReferences(indexPath, objectType, objectNumber) {
  if (!fs.existsSync(indexPath)) {
    return [];
  }

  const referencedFiles = [];

  try {
    // Get all JSON files in the index directory
    const files = fs
      .readdirSync(indexPath)
      .filter((file) => file.endsWith(".json"));

    for (const file of files) {
      let filePath = path.join(indexPath, file);

      try {
        const referenceData = JSON.parse(fs.readFileSync(filePath, "utf8"));

        // Check if this reference file contains our object
        if (
          referenceData.referencedWorkingObjects &&
          Array.isArray(referenceData.referencedWorkingObjects)
        ) {
          const hasReference = referenceData.referencedWorkingObjects.some(
            (ref) => ref.type === objectType && ref.number == objectNumber
          );

          if (hasReference) {
            const upgradedObjectFolders = configManager.getConfigValue(
              "upgradedObjectFolders",
              null
            );
            filePath =
              upgradedObjectFolders[objectType.replace("extension", "")];
            filePath = path.join(upgradedObjectFolders.basePath, filePath);
            referencedFiles.push(
              path.join(filePath, file.replace(/\.json$/, ".txt"))
            );
          }
        }
      } catch (error) {
        console.error(`Error reading reference file ${filePath}:`, error);
      }
    }

    return referencedFiles;
  } catch (error) {
    console.error(`Error finding migration references:`, error);
    return [];
  }
}

module.exports = {
  updateMigrationReferences,
  findMigrationReferences,
};
