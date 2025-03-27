const vscode = require("vscode");
const { EXTENSION_ID } = require("../constants");
const fs = require("fs");
const path = require("path");

/**
 * Get a configuration value from the VS Code settings
 * @param {string} key - Configuration key name
 * @param {any} defaultValue - Default value if configuration is not found
 * @returns {any} - Configuration value
 */
function getConfigValue(key, defaultValue = null) {
  const config = vscode.workspace.getConfiguration(EXTENSION_ID);

  if (config.has(key)) {
    return config.get(key);
  }

  // Try to get the value from local settings.json if the key is documentationIds
  if (key === "documentationIds") {
    const localDocIds = getLocalDocumentationIds();
    if (localDocIds && localDocIds.length > 0) {
      return localDocIds;
    }
  }

  return defaultValue;
}

/**
 * Set a configuration value in VS Code settings
 * @param {string} key - Configuration key name
 * @param {any} value - Value to set
 * @returns {Promise<void>}
 */
async function setConfigValue(key, value) {
  const config = vscode.workspace.getConfiguration(EXTENSION_ID);
  await config.update(key, value, vscode.ConfigurationTarget.Workspace);
}

/**
 * Get merged documentation IDs from workspace settings and local settings.json
 * @returns {Array} Array of documentation ID objects
 */
function getMergedDocumentationIds() {
  // Get IDs from workspace settings
  const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
  const workspaceIds = config.get("documentationIds") || [];

  // Get IDs from local settings.json
  const localIds = getLocalDocumentationIds() || [];

  // Create a map to avoid duplicates (by ID)
  const idMap = new Map();

  // Add workspace IDs first
  workspaceIds.forEach((item) => {
    idMap.set(item.id, item);
  });

  // Add local IDs (will overwrite workspace IDs if they have the same ID)
  localIds.forEach((item) => {
    idMap.set(item.id, item);
  });

  // Convert back to array
  const result = Array.from(idMap.values());
  console.log("Final merged documentation IDs:", result);
  return result;
}

/**
 * Read documentation IDs from local settings.json file
 * @returns {Array|null} Array of documentation ID objects or null if not found
 */
function getLocalDocumentationIds() {
  try {
    // Try to find local settings.json in workspace folders
    if (
      !vscode.workspace.workspaceFolders ||
      vscode.workspace.workspaceFolders.length === 0
    ) {
      return null;
    }

    for (const folder of vscode.workspace.workspaceFolders) {
      const settingsPath = path.join(
        folder.uri.fsPath,
        ".vscode",
        "settings.json"
      );

      if (fs.existsSync(settingsPath)) {
        const settingsContent = fs.readFileSync(settingsPath, "utf8");
        const settings = JSON.parse(settingsContent);

        // Check if settings has our documentation IDs
        if (settings && settings["bc-al-upgradeassistant.documentationIds"]) {
          return settings["bc-al-upgradeassistant.documentationIds"];
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error reading local documentation IDs:", error);
    return null;
  }
}

module.exports = {
  getConfigValue,
  setConfigValue,
  getMergedDocumentationIds,
};
