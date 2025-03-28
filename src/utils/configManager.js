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
  getSrcExtractionPath, // Added export
};

/**
 * Prompt the user to select a folder for source extraction.
 * Copied from symbolCache.js
 * @returns {Promise<string|null>} The selected folder path or null if cancelled.
 */
async function promptForSrcPath() {
  const options = {
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select folder for source extraction",
  };

  const result = await vscode.window.showOpenDialog(options);
  if (result && result.length > 0) {
    return result[0].fsPath;
  }
  vscode.window.showWarningMessage("Source extraction path not selected.");
  return null;
}

/**
 * Gets the configured source extraction path, prompting the user if necessary.
 * Saves the selected path to settings if prompted.
 * @returns {Promise<string|null>} The source extraction path or null if disabled or not provided.
 */
async function getSrcExtractionPath() {
  const enableSrcExtraction = getConfigValue("enableSrcExtraction", false);
  if (!enableSrcExtraction) {
    console.log("Source extraction is disabled in settings.");
    return null;
  }

  let srcExtractionPath = getConfigValue("srcExtractionPath", "");

  if (!srcExtractionPath) {
    vscode.window.showInformationMessage(
      "The 'srcExtractionPath' setting is not configured. Please select a folder to store extracted source code."
    );
    srcExtractionPath = await promptForSrcPath();

    if (!srcExtractionPath) {
      vscode.window.showWarningMessage(
        "Source extraction path not provided. Cannot copy workspace AL files."
      );
      return null;
    } else {
      // Save the selected path for future use (user scope)
      try {
        const config = vscode.workspace.getConfiguration(EXTENSION_ID);
        await config.update(
          "srcExtractionPath",
          srcExtractionPath,
          vscode.ConfigurationTarget.Global // Use Global scope for path consistency
        );
        vscode.window.showInformationMessage(
          `Source extraction path saved to global settings: ${srcExtractionPath}`
        );
      } catch (err) {
        console.warn(
          `Failed to save srcExtractionPath setting: ${err.message}`
        );
        vscode.window.showWarningMessage(
          `Could not save source extraction path setting: ${err.message}`
        );
        // Proceed with the path even if saving failed
      }
    }
  }

  // Final check if the path exists and is a directory
  try {
    const stats = fs.statSync(srcExtractionPath);
    if (!stats.isDirectory()) {
      vscode.window.showErrorMessage(
        `Configured srcExtractionPath is not a valid directory: ${srcExtractionPath}`
      );
      return null;
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      vscode.window.showErrorMessage(
        `Configured srcExtractionPath does not exist: ${srcExtractionPath}`
      );
    } else {
      vscode.window.showErrorMessage(
        `Error accessing srcExtractionPath (${srcExtractionPath}): ${err.message}`
      );
    }
    return null;
  }

  return srcExtractionPath;
}
