const vscode = require("vscode");

/**
 * Get a configuration value from VSCode settings
 * @param {string} key - The setting key
 * @param {any} defaultValue - Default value if setting is not found
 * @returns {any} - The setting value or default
 */
function getConfigValue(key, defaultValue = null) {
  const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
  return config.get(key, defaultValue);
}

/**
 * Update a configuration value in VSCode settings
 * @param {string} key - The setting key to update
 * @param {any} value - The new value
 * @param {boolean} global - Whether to update global or workspace settings
 * @returns {Promise<void>}
 */
async function updateConfig(key, value, global = false) {
  const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
  const target = global
    ? vscode.ConfigurationTarget.Global
    : vscode.ConfigurationTarget.Workspace;

  await config.update(key, value, target);
}

module.exports = {
  getConfigValue,
  updateConfig,
};
