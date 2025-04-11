const configManager = require("./configManager");
const path = require("path");

/**
 * Get the locations of upgraded objects by type
 * @returns {Object|null} Object with location information or null if not available
 */
function getUpgradedObjectFoldersByType() {
  return configManager.getConfigValue("upgradedObjectFolders", null);
}

/**
 * Get the location for a specific object type
 * @param {string} objectType - The object type to get location for (e.g., "Table", "Page")
 * @returns {string|null} The path where objects of this type are stored, or null if not found
 */
function getLocationForObjectType(objectType) {
  const locations = getUpgradedObjectFoldersByType();
  if (!locations) return null;

  const basePath = locations["basePath"];
  if (!basePath) return null;

  // Early return if exact match found
  if (locations[objectType]) {
    return path.join(basePath, locations[objectType]);
  }

  // Try to find a matching pattern (e.g. "tableextension" -> "table")
  for (const locationType in locations) {
    if (
      locationType !== "basePath" &&
      (objectType.includes(locationType) || locationType.includes(objectType))
    ) {
      return path.join(basePath, locations[locationType]);
    }
  }

  // If no matching folder found, return basePath
  return basePath;
}

module.exports = {
  getUpgradedObjectFoldersByType,
  getLocationForObjectType,
};
