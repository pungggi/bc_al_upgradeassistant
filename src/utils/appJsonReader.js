const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { readJsonFile } = require("../jsonUtils");

/**
 * Find app.json file in the workspace
 * @returns {string|null} Path to app.json or null if not found
 */
function findAppJsonFile() {
  if (!vscode.workspace.workspaceFolders) {
    return null;
  }

  // Try to find app.json in each workspace folder
  for (const folder of vscode.workspace.workspaceFolders) {
    const appJsonPath = path.join(folder.uri.fsPath, "app.json");
    if (fs.existsSync(appJsonPath)) {
      return appJsonPath;
    }
  }

  // If not found in root, try to find it in subdirectories (limited depth)
  for (const folder of vscode.workspace.workspaceFolders) {
    const folderPath = folder.uri.fsPath;

    // Common project patterns
    const commonPaths = [
      path.join(folderPath, "src", "app.json"),
      path.join(folderPath, "app", "app.json"),
      path.join(folderPath, "AL", "app.json"),
    ];

    for (const possiblePath of commonPaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    }
  }

  return null;
}

/**
 * Read app.json and extract ID ranges
 * @returns {Array<{from: number, to: number}>} Array of ID range objects
 */
function getIdRanges() {
  try {
    const appJsonPath = findAppJsonFile();
    if (!appJsonPath) {
      console.warn("No app.json file found in workspace");
      return [];
    }

    const appJson = readJsonFile(appJsonPath);

    // Extract idRanges from app.json
    if (!appJson.idRanges || !Array.isArray(appJson.idRanges)) {
      console.warn("No idRanges found in app.json");
      return [];
    }

    // Validate and convert ranges
    return appJson.idRanges
      .map((range) => ({
        from: parseInt(range.from, 10),
        to: parseInt(range.to, 10),
      }))
      .filter(
        (range) =>
          !isNaN(range.from) && !isNaN(range.to) && range.from <= range.to
      );
  } catch (error) {
    console.error("Error reading ID ranges from app.json:", error);
    return [];
  }
}

/**
 * Check if an ID is within any of the app's ID ranges
 * @param {number} id - ID to check
 * @param {Array<{from: number, to: number}>} ranges - Array of ID ranges
 * @returns {boolean} True if ID is within any range
 */
function isIdInRanges(id, ranges) {
  if (!ranges || ranges.length === 0) return true; // If no ranges defined, include all

  return ranges.some((range) => id >= range.from && id <= range.to);
}

module.exports = {
  findAppJsonFile,
  getIdRanges,
  isIdInRanges,
};
