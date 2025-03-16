const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

/**
 * Master function to handle both object and file name changes
 * @param {string} oldFilePath Original file path
 * @param {string} newFilePath New file path
 * @param {number} oldObjectId Previous object ID
 * @param {number} newObjectId New object ID
 * @param {string} objectType Type of AL object
 * @returns {boolean} Success status
 */
function updateIndexReferences(
  oldFilePath,
  newFilePath,
  oldObjectId,
  newObjectId,
  objectType
) {
  try {
    const indexFiles = findIndexFiles(path.dirname(oldFilePath));
    if (!indexFiles || indexFiles.length === 0) return false;

    const objectUpdated = updateReferencesForObjectChange(
      indexFiles,
      oldObjectId,
      newObjectId,
      objectType
    );
    const fileUpdated = updateReferencesForFileNameChange(
      indexFiles,
      oldFilePath,
      newFilePath,
      newObjectId,
      objectType
    );

    return objectUpdated || fileUpdated;
  } catch (error) {
    vscode.window.showErrorMessage(`Error updating indexes: ${error.message}`);
    return false;
  }
}

/**
 * Updates object number references in index files
 * @param {string[]} indexFiles List of index file paths
 * @param {number} oldObjectId Previous object ID
 * @param {number} newObjectId New object ID
 * @param {string} objectType Type of AL object
 * @returns {boolean} Success status
 */
function updateReferencesForObjectChange(
  indexFiles,
  oldObjectId,
  newObjectId,
  objectType
) {
  if (oldObjectId === newObjectId) return false;

  let anyUpdated = false;

  for (const indexFile of indexFiles) {
    const indexData = readIndexFile(indexFile);
    if (!indexData) continue;

    let modified = false;

    for (let i = 0; i < indexData.entries.length; i++) {
      const entry = indexData.entries[i];
      if (entry.objectId === oldObjectId && entry.objectType === objectType) {
        indexData.entries[i].objectId = newObjectId;
        modified = true;
      }
    }

    if (modified) {
      writeIndexFile(indexFile, indexData);
      anyUpdated = true;
    }
  }

  return anyUpdated;
}

/**
 * Updates file path references in index files
 * @param {string[]} indexFiles List of index file paths
 * @param {string} oldFilePath Original file path
 * @param {string} newFilePath New file path
 * @param {number} objectId Object ID (already updated if needed)
 * @param {string} objectType Type of AL object
 * @returns {boolean} Success status
 */
function updateReferencesForFileNameChange(
  indexFiles,
  oldFilePath,
  newFilePath,
  objectId,
  objectType
) {
  if (normalizeFilePath(oldFilePath) === normalizeFilePath(newFilePath))
    return false;

  let anyUpdated = false;

  for (const indexFile of indexFiles) {
    const indexData = readIndexFile(indexFile);
    if (!indexData) continue;

    let modified = false;

    for (let i = 0; i < indexData.entries.length; i++) {
      const entry = indexData.entries[i];
      if (normalizeFilePath(entry.path) === normalizeFilePath(oldFilePath)) {
        indexData.entries[i].path = normalizeFilePath(newFilePath);
        modified = true;
      }
      if (entry.objectId === objectId && entry.objectType === objectType) {
        indexData.entries[i].path = normalizeFilePath(newFilePath);
        modified = true;
      }
    }

    if (modified) {
      writeIndexFile(indexFile, indexData);
      anyUpdated = true;
    }
  }

  return anyUpdated;
}

/**
 * Finds all relevant index files in workspace
 * @param {string} startDirectory Directory to start search from
 * @returns {string[]} List of index file paths
 */
function findIndexFiles(startDirectory) {
  const indexFiles = [];
  if (!fs.existsSync(startDirectory)) return indexFiles;

  const searchDirectory = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        searchDirectory(fullPath);
      } else if (entry.name.endsWith(".index")) {
        indexFiles.push(fullPath);
      }
    }
  };

  searchDirectory(startDirectory);
  return indexFiles;
}

/**
 * Reads and parses an index file
 * @param {string} indexFilePath Path to the index file
 * @returns {object|null} Parsed index data or null if invalid
 */
function readIndexFile(indexFilePath) {
  if (!fs.existsSync(indexFilePath)) return null;

  try {
    const content = fs.readFileSync(indexFilePath, "utf8");
    const indexData = JSON.parse(content);
    if (!indexData || !indexData.entries) return null;
    return indexData;
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to read index file ${indexFilePath}: ${error.message}`
    );
    return null;
  }
}

/**
 * Writes updated index data back to file
 * @param {string} indexFilePath Path to the index file
 * @param {object} indexData Index data to write
 * @returns {boolean} Success status
 */
function writeIndexFile(indexFilePath, indexData) {
  try {
    fs.writeFileSync(indexFilePath, JSON.stringify(indexData, null, 2), "utf8");
    return true;
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to update index file ${indexFilePath}: ${error.message}`
    );
    return false;
  }
}

/**
 * Normalizes file paths for consistent comparison
 * @param {string} filePath File path to normalize
 * @returns {string} Normalized path
 */
function normalizeFilePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

module.exports = {
  updateIndexReferences,
  updateReferencesForObjectChange,
  updateReferencesForFileNameChange,
};
