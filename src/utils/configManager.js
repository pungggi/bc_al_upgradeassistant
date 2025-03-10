const vscode = require("vscode");
const { EXTENSION_ID } = require("../constants");

/**
 * Get a configuration value from the VS Code settings
 * @param {string} key - Configuration key name
 * @param {any} defaultValue - Default value if configuration is not found
 * @returns {any} - Configuration value
 */
function getConfigValue(key, defaultValue = null) {
  const config = vscode.workspace.getConfiguration(EXTENSION_ID);
  return config.get(key, defaultValue);
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

module.exports = {
  getConfigValue,
  setConfigValue,
};
